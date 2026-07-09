package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/danibram/immich-proxy-go/internal/immich"
	"go.uber.org/zap"
)

// Allowed Content-Type prefixes for uploads
var allowedUploadPrefixes = []string{
	"image/",              // All image types (jpeg, png, heic, raw, etc.)
	"video/",              // All video types (mp4, mov, webm, etc.)
	"multipart/form-data", // For form uploads
}

// isAllowedContentType checks if the content type is allowed for uploads
func isAllowedContentType(contentType string) bool {
	// Extract base content type (without parameters like boundary)
	baseType := contentType
	if idx := strings.Index(contentType, ";"); idx != -1 {
		baseType = strings.TrimSpace(contentType[:idx])
	}
	baseType = strings.ToLower(baseType)

	// Check against allowed prefixes
	for _, prefix := range allowedUploadPrefixes {
		if strings.HasPrefix(baseType, prefix) {
			return true
		}
	}
	return false
}

// UploadAsset handles file uploads via shared link
func (h *ShareHandler) UploadAsset(w http.ResponseWriter, r *http.Request) {
	// Apply upload size limit. We *always* wrap the body so a
	// mis-configured or 0/negative max_upload_size cannot be used to DoS
	// this process with an unbounded upload. If the operator wants truly
	// unlimited uploads they can set a very large number; the hard
	// fallback here is a generous 1 GiB which still beats unbounded.
	const fallbackMaxBytes int64 = 1024 * 1024 * 1024
	maxSize := h.config.Security.MaxUploadSize * 1024 * 1024 // MB -> bytes
	if maxSize <= 0 {
		maxSize = fallbackMaxBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSize)

	link, creds, _, err := h.loadShareLinkFromRequest(r)
	if err != nil {
		h.handleError(w, err)
		return
	}

	if !link.AllowUpload {
		http.Error(w, "Uploads are not allowed for this shared link", http.StatusForbidden)
		return
	}

	// Get album ID if this is an album share
	var albumID string
	if link.Type == "ALBUM" && link.Album != nil {
		albumID = link.Album.ID
	}

	// Get and validate content type
	contentType := r.Header.Get("Content-Type")
	if contentType == "" {
		http.Error(w, "Content-Type header required", http.StatusBadRequest)
		return
	}

	// Validate content type is an allowed image/video type
	if !isAllowedContentType(contentType) {
		http.Error(w, "Invalid file type. Only images and videos are allowed", http.StatusUnsupportedMediaType)
		return
	}

	// Upload the asset
	uploadResp, err := h.client.UploadAssetWithKeyType(creds.key, creds.password, contentType, r.Body, creds.keyType)
	if err != nil {
		// Check if it's a size limit error
		if err.Error() == "http: request body too large" {
			http.Error(w, fmt.Sprintf("File too large. Maximum size is %d MB", h.config.Security.MaxUploadSize), http.StatusRequestEntityTooLarge)
			return
		}
		// The uploader went away mid-stream (stall-watchdog abort, closed
		// tab, dropped wifi). Routine on bad networks — log as info so real
		// upstream failures stay visible in the error stream.
		if r.Context().Err() != nil || errors.Is(err, context.Canceled) {
			h.logger.Info("upload aborted by client", zap.Error(err))
			return
		}
		h.logger.Error("failed to upload asset", zap.Error(err))
		http.Error(w, "Failed to upload asset", http.StatusInternalServerError)
		return
	}
	defer uploadResp.Body.Close()

	// Read the upload response to get the asset ID
	uploadBody, err := io.ReadAll(uploadResp.Body)
	if err != nil {
		h.logger.Error("failed to read upload response", zap.Error(err))
		http.Error(w, "Failed to read upload response", http.StatusInternalServerError)
		return
	}

	// If upload was successful and we have an album ID, make sure the asset
	// lands in the album. Immich v3+ auto-associates shared-link uploads
	// with the album, so the explicit add is only needed on v2 — on v3 it
	// just burns a round-trip and answers 403 for every photo.
	if uploadResp.StatusCode == http.StatusCreated && albumID != "" {
		var uploadResult immich.UploadResponse
		if err := json.Unmarshal(uploadBody, &uploadResult); err == nil && uploadResult.ID != "" {
			if h.client.SupportsSharedLinkLogin(creds.key, creds.keyType) {
				// v3 marker (shared-links/login route) present: skip the add.
				h.logger.Debug("skipping album add: Immich v3+ auto-associates shared-link uploads",
					zap.String("assetId", uploadResult.ID), zap.String("albumId", albumID))
			} else if err := h.client.AddAssetToAlbumWithKeyType(albumID, uploadResult.ID, creds.key, creds.password, creds.keyType); err != nil {
				var addErr *immich.AlbumAddError
				if errors.As(err, &addErr) && addErr.StatusCode == http.StatusForbidden {
					// Safety net when version detection was unavailable: a 403
					// here means Immich v3 already auto-added the upload to the
					// album (verified in prod — the asset appears seconds
					// later). Not a failure, so don't warn.
					h.logger.Debug("album add returned 403; Immich v3 auto-associates shared-link uploads",
						zap.String("assetId", uploadResult.ID), zap.String("albumId", albumID))
				} else {
					h.logger.Warn("failed to add asset to album", zap.Error(err), zap.String("assetId", uploadResult.ID))
					// Continue anyway - the upload was successful
				}
			}
		}
	}

	// Return the original upload response
	for k, v := range uploadResp.Header {
		for _, vv := range v {
			w.Header().Add(k, vv)
		}
	}
	w.WriteHeader(uploadResp.StatusCode)
	w.Write(uploadBody)
}
