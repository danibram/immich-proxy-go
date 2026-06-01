package handlers

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// DownloadAssets initiates a ZIP download job and returns job ID for progress tracking
func (h *ShareHandler) DownloadAssets(w http.ResponseWriter, r *http.Request) {
	// Parse request body to get asset IDs
	var req struct {
		AssetIDs []string `json:"assetIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate we have at least 2 assets (otherwise use single download)
	if len(req.AssetIDs) < 2 {
		http.Error(w, "At least 2 assets required for bulk download", http.StatusBadRequest)
		return
	}

	// Validate all asset IDs are UUIDs
	for _, assetID := range req.AssetIDs {
		if !middleware.IsValidUUID(assetID) {
			http.Error(w, "Invalid asset ID format", http.StatusBadRequest)
			return
		}
	}

	link, creds, _, err := h.loadShareLinkFromRequest(r)
	if err != nil {
		h.handleError(w, err)
		return
	}

	if !h.allowDownload(link) {
		if !h.config.Options.AllowDownload {
			http.Error(w, "Downloads are disabled", http.StatusForbidden)
		} else {
			http.Error(w, "Downloads are disabled for this share", http.StatusForbidden)
		}
		return
	}

	if h.rejectIfExpired(w, link) {
		return
	}

	key, password, keyType := creds.key, creds.password, creds.keyType

	// For album shares, fetch full album details (includes all assets)
	if link.Type == "ALBUM" && link.Album != nil && link.Album.ID != "" {
		album, err := h.client.GetAlbumWithKeyType(link.Album.ID, key, password, keyType)
		if err != nil {
			h.logger.Warn("failed to fetch album for zip", zap.Error(err))
		} else {
			link.Album = album
		}
	}

	// Build a map of asset ID to asset info for quick lookup
	assetMap := make(map[string]*immich.Asset)
	for i := range link.Assets {
		assetMap[link.Assets[i].ID] = &link.Assets[i]
	}
	if link.Album != nil {
		for i := range link.Album.Assets {
			assetMap[link.Album.Assets[i].ID] = &link.Album.Assets[i]
		}
	}

	// Filter to only valid asset IDs
	var validAssetIDs []string
	for _, assetID := range req.AssetIDs {
		if asset, ok := assetMap[assetID]; ok && !asset.IsTrashed {
			validAssetIDs = append(validAssetIDs, assetID)
		}
	}

	if len(validAssetIDs) == 0 {
		http.Error(w, "No valid assets to download", http.StatusBadRequest)
		return
	}

	// Determine zip filename from album name
	zipFilename := "immich-download.zip"
	if link.Album != nil && link.Album.AlbumName != "" {
		safeName := sanitizeFilename(link.Album.AlbumName)
		if safeName != "" {
			zipFilename = safeName + ".zip"
		}
	}

	// Enforce max concurrent download jobs (disk-fill DoS protection).
	// Zero disables the cap for operators who explicitly opt out.
	if cap := h.config.Security.MaxConcurrentDownloadJobs; cap > 0 {
		if downloadJobManager.activeJobCount() >= cap {
			http.Error(w, "Too many active download jobs, try again later", http.StatusTooManyRequests)
			return
		}
	}

	// Create job, bound to the share key that created it.
	job := downloadJobManager.Create(len(validAssetIDs), zipFilename, key)

	h.logger.Info("starting zip job",
		zap.String("jobId", job.ID),
		zap.Int("assets", len(validAssetIDs)),
		zap.String("keyType", string(keyType)))

	// Process in background
	go h.processDownloadJob(job, validAssetIDs, assetMap, key, password, keyType)

	// Return job ID immediately
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"jobId": job.ID})
}

// processDownloadJob generates the ZIP file in the background
func (h *ShareHandler) processDownloadJob(job *DownloadJob, assetIDs []string, assetMap map[string]*immich.Asset, key, password string, keyType immich.KeyType) {
	// Create temp file
	tmpFile, err := os.CreateTemp("", "immich-download-*.zip")
	if err != nil {
		h.logger.Error("failed to create temp file", zap.Error(err))
		downloadJobManager.SetFailed(job.ID, "Failed to create temporary file")
		return
	}
	tmpPath := tmpFile.Name()

	// Create ZIP writer
	zipWriter := zip.NewWriter(tmpFile)
	usedFilenames := make(map[string]int)

	// Download each asset
	for i, assetID := range assetIDs {
		asset := assetMap[assetID]

		// Get original file
		resp, err := h.client.GetOriginalWithKeyType(assetID, key, password, keyType)
		if err != nil {
			h.logger.Warn("failed to get original", zap.Error(err), zap.String("assetId", assetID))
			continue
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			continue
		}

		// Determine filename
		filename := asset.OriginalFileName
		if filename == "" {
			filename = assetID + getExtensionForMimeType(asset.OriginalMimeType)
		}
		filename = getUniqueFilename(filename, usedFilenames)

		// Create ZIP entry
		zipEntry, err := zipWriter.Create(filename)
		if err != nil {
			resp.Body.Close()
			h.logger.Error("failed to create zip entry", zap.Error(err))
			continue
		}

		// Copy file to ZIP
		_, err = io.Copy(zipEntry, resp.Body)
		resp.Body.Close()
		if err != nil {
			h.logger.Error("failed to write to zip", zap.Error(err))
			continue
		}

		// Update progress
		downloadJobManager.UpdateProgress(job.ID, i+1)
	}

	// Finalize ZIP
	if err := zipWriter.Close(); err != nil {
		h.logger.Error("failed to close zip", zap.Error(err))
		tmpFile.Close()
		os.Remove(tmpPath)
		downloadJobManager.SetFailed(job.ID, "Failed to finalize ZIP")
		return
	}
	tmpFile.Close()

	// Mark as ready
	downloadJobManager.SetReady(job.ID, tmpPath)
	h.logger.Info("zip job completed", zap.String("jobId", job.ID), zap.Int("files", len(usedFilenames)))

	// Schedule cleanup after 10 minutes
	go func() {
		time.Sleep(10 * time.Minute)
		downloadJobManager.Delete(job.ID)
	}()
}

// GetDownloadJobStatus returns the status of a download job
func (h *ShareHandler) GetDownloadJobStatus(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "jobID")
	if jobID == "" {
		http.Error(w, "Job ID required", http.StatusBadRequest)
		return
	}
	if !isValidJobID(jobID) {
		http.Error(w, "Invalid job ID format", http.StatusBadRequest)
		return
	}

	job := downloadJobManager.Get(jobID)
	// Return a generic 404 whether the job does not exist OR belongs to
	// another share. We intentionally do not distinguish between the two
	// so that an attacker cannot enumerate job IDs across shares.
	if job == nil || !jobBelongsToShare(job, middleware.GetShareKey(r.Context())) {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

// DownloadJobFile serves the completed ZIP file
func (h *ShareHandler) DownloadJobFile(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "jobID")
	if jobID == "" {
		http.Error(w, "Job ID required", http.StatusBadRequest)
		return
	}
	if !isValidJobID(jobID) {
		http.Error(w, "Invalid job ID format", http.StatusBadRequest)
		return
	}

	job := downloadJobManager.Get(jobID)
	if job == nil || !jobBelongsToShare(job, middleware.GetShareKey(r.Context())) {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}

	if job.Status != "ready" {
		http.Error(w, "Job not ready", http.StatusConflict)
		return
	}

	// Serve the file. Filename is sanitized in DownloadAssets via
	// sanitizeFilename but we double-check here because it appears in
	// Content-Disposition which must not contain CR/LF or double quotes.
	safeName := sanitizeFilename(job.Filename)
	if safeName == "" {
		safeName = "immich-download.zip"
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, safeName))
	w.Header().Set("Cache-Control", "no-store")

	http.ServeFile(w, r, job.FilePath)
}
