package handlers

import (
	"encoding/json"
	"net/http"
	"regexp"
	"sync"

	"go.uber.org/zap"
)

// Upload-check lets the client discover which files already exist in the
// album owner's library BEFORE spending bandwidth: it probes Immich with the
// checksum header and an intentionally-invalid multipart (see
// immich.CheckAssetExistsByChecksum) so no bytes and no assets are ever
// created by a probe.
const (
	// maxUploadCheckFiles caps a single request; the client batches per
	// selection, and 500 covers any sane batch while bounding the fan-out.
	maxUploadCheckFiles = 500
	// uploadCheckProbeConcurrency bounds parallel probes against Immich so a
	// 500-file check cannot stampede the upstream.
	uploadCheckProbeConcurrency = 8
	// maxUploadCheckBody bounds the JSON body (500 entries of name+checksum
	// fit comfortably in 256 KiB).
	maxUploadCheckBody = 256 * 1024
)

// SHA-1 as lowercase/uppercase hex (40 chars) or standard base64 of 20 bytes
// (28 chars, "=" padded) — the two encodings Immich accepts.
var (
	sha1HexPattern    = regexp.MustCompile(`^[0-9a-fA-F]{40}$`)
	sha1Base64Pattern = regexp.MustCompile(`^[A-Za-z0-9+/]{27}=$`)
)

func isValidSha1Checksum(checksum string) bool {
	return sha1HexPattern.MatchString(checksum) || sha1Base64Pattern.MatchString(checksum)
}

type uploadCheckFile struct {
	Name     string `json:"name"`
	Checksum string `json:"checksum"`
}

type uploadCheckRequest struct {
	Files []uploadCheckFile `json:"files"`
}

type uploadCheckResult struct {
	Name     string `json:"name"`
	Checksum string `json:"checksum"`
	Exists   bool   `json:"exists"`
	AssetID  string `json:"assetId,omitempty"`
}

type uploadCheckResponse struct {
	Results []uploadCheckResult `json:"results"`
}

// UploadCheck answers which of the submitted {name, checksum} pairs already
// exist in the share owner's library. Requires an upload-enabled share (same
// gate as UploadAsset). Two upstream strategies, capability-detected and
// cached (see immich.BulkCheckAssetsByChecksum):
//
//  1. Native: one POST /api/assets/bulk-upload-check answers the whole list —
//     works once the upstream Immich accepts shared-link auth on that route
//     (pending upstream PR; current servers reject it with 401/403).
//  2. Fallback: per-checksum probes via POST /api/assets with the
//     x-immich-checksum header (bounded fan-out).
//
// Failures fail OPEN (exists=false): the client will upload with the
// checksum header, and Immich dedupes there anyway.
func (h *ShareHandler) UploadCheck(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadCheckBody)

	link, creds, _, err := h.loadShareLinkFromRequest(r)
	if err != nil {
		h.handleError(w, err)
		return
	}
	if h.rejectIfExpired(w, link) {
		return
	}
	if !link.AllowUpload {
		http.Error(w, "Uploads are not allowed for this shared link", http.StatusForbidden)
		return
	}

	var req uploadCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}
	if len(req.Files) > maxUploadCheckFiles {
		http.Error(w, "Too many files in one check (max 500)", http.StatusBadRequest)
		return
	}
	for _, f := range req.Files {
		if !isValidSha1Checksum(f.Checksum) {
			http.Error(w, "Invalid checksum: expected SHA-1 as 40-char hex or base64", http.StatusBadRequest)
			return
		}
	}

	results := make([]uploadCheckResult, len(req.Files))
	for i, f := range req.Files {
		results[i] = uploadCheckResult{Name: f.Name, Checksum: f.Checksum}
	}

	if len(req.Files) > 0 && h.tryNativeBulkCheck(creds, req.Files, results) {
		writeUploadCheckResponse(w, h, results)
		return
	}

	sem := make(chan struct{}, uploadCheckProbeConcurrency)
	var wg sync.WaitGroup
	for i, f := range req.Files {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, f uploadCheckFile) {
			defer wg.Done()
			defer func() { <-sem }()

			result := uploadCheckResult{Name: f.Name, Checksum: f.Checksum}
			existence, err := h.client.CheckAssetExistsByChecksum(creds.key, creds.password, f.Checksum, creds.keyType)
			if err != nil {
				// Fail open: report not-found so the client uploads normally;
				// the checksum header on the upload still dedupes upstream.
				h.logger.Info("upload-check probe failed; reporting as not found",
					zap.String("name", f.Name), zap.Error(err))
			} else if existence.Exists {
				result.Exists = true
				result.AssetID = existence.AssetID
			}
			results[i] = result
		}(i, f)
	}
	wg.Wait()

	writeUploadCheckResponse(w, h, results)
}

func writeUploadCheckResponse(w http.ResponseWriter, h *ShareHandler, results []uploadCheckResult) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(uploadCheckResponse{Results: results}); err != nil {
		h.logger.Error("failed to encode upload-check response", zap.Error(err))
	}
}

// tryNativeBulkCheck answers the whole request through Immich's native
// POST /api/assets/bulk-upload-check when the upstream accepts shared-link
// auth on it, filling `results` in place. Returns false when the caller must
// run the per-checksum probe fallback — because the upstream provably lacks
// support (decision cached upstream of this call) or because the attempt
// failed transiently (nothing cached; detection retries next request).
func (h *ShareHandler) tryNativeBulkCheck(creds shareCredentials, files []uploadCheckFile, results []uploadCheckResult) bool {
	checksums := make([]string, len(files))
	for i, f := range files {
		checksums[i] = f.Checksum
	}

	outcome, err := h.client.BulkCheckAssetsByChecksum(creds.key, creds.password, creds.keyType, checksums)
	if err != nil {
		h.logger.Info("upload-check: native bulk-upload-check attempt failed; falling back to checksum probes (decision not cached)",
			zap.Error(err))
		return false
	}
	if outcome.Detected {
		// Once per cache window — the e2e suite asserts this line appears
		// exactly once while multiple upload-check requests are served.
		if outcome.Supported {
			h.logger.Info("upload-check: upstream supports shared-link bulk-upload-check; using native endpoint (decision cached)")
		} else {
			h.logger.Info("upload-check: upstream rejected shared-link bulk-upload-check; falling back to checksum probes (decision cached)",
				zap.Int("status", outcome.StatusCode))
		}
	}
	if !outcome.Supported {
		h.logger.Debug("upload-check: using checksum-probe fallback (cached decision)", zap.Int("files", len(files)))
		return false
	}

	h.logger.Debug("upload-check: answered via native bulk-upload-check", zap.Int("files", len(files)))
	for i := range results {
		if outcome.Existence[i].Exists {
			results[i].Exists = true
			results[i].AssetID = outcome.Existence[i].AssetID
		}
	}
	return true
}
