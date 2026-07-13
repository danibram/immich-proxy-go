package handlers

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/danibram/immich-proxy-go/internal/config"
	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

const downloadWorkerLimit = 4

var downloadRetryDelays = []time.Duration{0, 100 * time.Millisecond, 400 * time.Millisecond}

type downloadTask struct {
	index   int
	assetID string
}

type stagedDownload struct {
	path     string
	filename string
}

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

	if len(validAssetIDs) != len(req.AssetIDs) {
		http.Error(w, "One or more requested assets are unavailable", http.StatusBadRequest)
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
	// Stage every upstream asset before creating the ZIP. This makes the job
	// atomic: a ready job always contains every requested file, never a
	// plausible-looking archive with silent omissions.
	stagingDir, err := os.MkdirTemp("", "immich-download-stage-*")
	if err != nil {
		h.logger.Error("failed to create download staging directory", zap.Error(err))
		downloadJobManager.SetFailed(job.ID, "Failed to prepare download")
		return
	}
	defer os.RemoveAll(stagingDir)

	staged := make([]stagedDownload, len(assetIDs))
	tasks := make(chan downloadTask, len(assetIDs))
	for i, assetID := range assetIDs {
		tasks <- downloadTask{index: i, assetID: assetID}
	}
	close(tasks)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var completed atomic.Int32
	var firstFailure error
	var failureOnce sync.Once
	workerCount := min(downloadWorkerLimit, len(assetIDs))
	var workers sync.WaitGroup
	workers.Add(workerCount)
	for range workerCount {
		go func() {
			defer workers.Done()
			for task := range tasks {
				if ctx.Err() != nil {
					return
				}
				asset := assetMap[task.assetID]
				result, err := h.stageDownloadAsset(ctx, stagingDir, task.index, asset, key, password, keyType)
				if err != nil {
					failureOnce.Do(func() {
						firstFailure = err
						cancel()
					})
					continue
				}
				staged[task.index] = result
				progress := int(completed.Add(1))
				downloadJobManager.UpdateProgress(job.ID, progress)
			}
		}()
	}
	workers.Wait()

	if firstFailure != nil {
		h.logger.Warn("zip job failed while staging assets", zap.String("jobId", job.ID), zap.Error(firstFailure))
		downloadJobManager.SetFailed(job.ID, "Could not prepare every requested file")
		return
	}

	// Only allocate the public job artifact after the complete staged set is
	// present. ZIP STORE avoids wasting CPU recompressing photos and videos.
	tmpFile, err := os.CreateTemp("", "immich-download-*.zip")
	if err != nil {
		h.logger.Error("failed to create zip file", zap.Error(err))
		downloadJobManager.SetFailed(job.ID, "Failed to create ZIP")
		return
	}
	tmpPath := tmpFile.Name()
	keepZIP := false
	defer func() {
		_ = tmpFile.Close()
		if !keepZIP {
			_ = os.Remove(tmpPath)
		}
	}()

	zipWriter := zip.NewWriter(tmpFile)
	usedFilenames := make(map[string]int)
	for _, item := range staged {
		filename := getUniqueFilename(item.filename, usedFilenames)
		header := &zip.FileHeader{Name: filename, Method: zip.Store}
		entry, err := zipWriter.CreateHeader(header)
		if err != nil {
			_ = zipWriter.Close()
			h.logger.Error("failed to create zip entry", zap.Error(err), zap.String("filename", filename))
			downloadJobManager.SetFailed(job.ID, "Failed to finalize ZIP")
			return
		}
		file, err := os.Open(item.path)
		if err != nil {
			_ = zipWriter.Close()
			h.logger.Error("failed to reopen staged asset", zap.Error(err))
			downloadJobManager.SetFailed(job.ID, "Failed to finalize ZIP")
			return
		}
		_, copyErr := io.Copy(entry, file)
		closeErr := file.Close()
		if copyErr != nil || closeErr != nil {
			_ = zipWriter.Close()
			h.logger.Error("failed to write complete zip entry", zap.Error(copyErr), zap.String("filename", filename))
			downloadJobManager.SetFailed(job.ID, "Failed to finalize ZIP")
			return
		}
	}

	if err := zipWriter.Close(); err != nil {
		h.logger.Error("failed to close zip", zap.Error(err))
		downloadJobManager.SetFailed(job.ID, "Failed to finalize ZIP")
		return
	}
	if err := tmpFile.Close(); err != nil {
		h.logger.Error("failed to flush zip", zap.Error(err))
		downloadJobManager.SetFailed(job.ID, "Failed to finalize ZIP")
		return
	}
	keepZIP = true

	// Mark as ready
	downloadJobManager.SetReady(job.ID, tmpPath)
	h.logger.Info("zip job completed", zap.String("jobId", job.ID), zap.Int("files", len(usedFilenames)))

	// Schedule cleanup after 10 minutes
	go func() {
		time.Sleep(10 * time.Minute)
		downloadJobManager.Delete(job.ID)
	}()
}

// stageDownloadAsset fetches one original into a private temp file. Transport
// failures, 408/429, and 5xx responses are retried; permanent 4xx responses
// fail immediately. A caller never sees this partial file.
func (h *ShareHandler) stageDownloadAsset(
	ctx context.Context,
	stagingDir string,
	index int,
	asset *immich.Asset,
	key, password string,
	keyType immich.KeyType,
) (stagedDownload, error) {
	if asset == nil {
		return stagedDownload{}, fmt.Errorf("asset %d is missing from the authorized share", index)
	}

	var lastErr error
	for attempt, delay := range downloadRetryDelays {
		if delay > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return stagedDownload{}, ctx.Err()
			case <-timer.C:
			}
		}
		if ctx.Err() != nil {
			return stagedDownload{}, ctx.Err()
		}

		quality := h.config.Options.DownloadQuality()
		var resp *http.Response
		var err error
		if asset.Type == "IMAGE" && quality != config.QualityOriginal {
			resp, err = h.client.GetThumbnailWithKeyType(asset.ID, key, password, string(quality), keyType)
		} else {
			resp, err = h.client.GetOriginalWithKeyType(asset.ID, key, password, keyType)
		}
		if err != nil {
			lastErr = err
			continue
		}

		if resp.StatusCode != http.StatusOK {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64*1024))
			_ = resp.Body.Close()
			lastErr = fmt.Errorf("asset %s returned HTTP %d", asset.ID, resp.StatusCode)
			if !isRetryableDownloadStatus(resp.StatusCode) {
				return stagedDownload{}, lastErr
			}
			continue
		}

		path := filepath.Join(stagingDir, fmt.Sprintf("%06d-%s", index, asset.ID))
		file, createErr := os.Create(path)
		if createErr != nil {
			_ = resp.Body.Close()
			return stagedDownload{}, createErr
		}
		_, copyErr := io.Copy(file, resp.Body)
		bodyCloseErr := resp.Body.Close()
		fileCloseErr := file.Close()
		if copyErr != nil || bodyCloseErr != nil || fileCloseErr != nil {
			_ = os.Remove(path)
			lastErr = fmt.Errorf("asset %s stream failed on attempt %d", asset.ID, attempt+1)
			continue
		}

		filename := asset.OriginalFileName
		if asset.Type == "IMAGE" && quality != config.QualityOriginal {
			contentType := resp.Header.Get("Content-Type")
			ext := getExtensionForMimeType(contentType)
			if ext == "" {
				ext = ".jpg"
			}
			base := strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))
			if base == "" {
				base = asset.ID
			}
			filename = base + ext
		}
		if filename == "" {
			filename = filenameFromContentDisposition(resp.Header.Get("Content-Disposition"))
		}
		if filename == "" {
			mimeType := asset.OriginalMimeType
			if mimeType == "" {
				mimeType = resp.Header.Get("Content-Type")
			}
			filename = asset.ID + getExtensionForMimeType(mimeType)
		}
		filename = sanitizeFilename(filename)
		if filename == "" {
			filename = asset.ID
		}
		return stagedDownload{path: path, filename: filename}, nil
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("asset %s could not be downloaded", asset.ID)
	}
	return stagedDownload{}, lastErr
}

func isRetryableDownloadStatus(status int) bool {
	return status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= 500
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
