package handlers

import (
	"net/http"

	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// GetThumbnail proxies thumbnail requests
func (h *ShareHandler) GetThumbnail(w http.ResponseWriter, r *http.Request) {
	key := middleware.GetShareKey(r.Context())
	password := middleware.GetPassword(r.Context())
	keyType := h.getKeyType(r.Context())
	assetID := chi.URLParam(r, "assetID")
	size := r.URL.Query().Get("size")

	// Validate UUID format
	if !middleware.IsValidUUID(assetID) {
		http.Error(w, "Invalid asset ID format", http.StatusBadRequest)
		return
	}

	// Validate size parameter
	if !middleware.IsValidThumbnailSize(size) {
		http.Error(w, "Invalid size parameter", http.StatusBadRequest)
		return
	}

	// Note: We trust Immich to validate that this asset belongs to the shared link
	// The share key query param ensures Immich only returns assets from the share
	// Doing IDOR validation here would require fetching the full album which is expensive

	resp, err := h.client.GetThumbnailWithKeyType(assetID, key, password, size, keyType)
	if err != nil {
		h.logger.Error("failed to get thumbnail", zap.Error(err))
		http.Error(w, "Failed to get thumbnail", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// Check if Immich returned an error (asset not in share, etc)
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusForbidden {
		http.Error(w, "Asset not found", http.StatusNotFound)
		return
	}

	h.proxyResponse(w, resp)
}

// GetOriginal proxies original file requests
func (h *ShareHandler) GetOriginal(w http.ResponseWriter, r *http.Request) {
	assetID := chi.URLParam(r, "assetID")

	// Validate UUID format
	if !middleware.IsValidUUID(assetID) {
		http.Error(w, "Invalid asset ID format", http.StatusBadRequest)
		return
	}

	link, creds, err := h.loadShareLinkFromRequest(r)
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

	// Note: We trust Immich to validate that this asset belongs to the shared link
	// The share key query param ensures Immich only returns assets from the share

	resp, err := h.client.GetOriginalWithKeyType(assetID, creds.key, creds.password, creds.keyType)
	if err != nil {
		h.logger.Error("failed to get original", zap.Error(err))
		http.Error(w, "Failed to get original file", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// Check if Immich returned an error (asset not in share, etc)
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusForbidden {
		http.Error(w, "Asset not found", http.StatusNotFound)
		return
	}

	h.proxyResponse(w, resp)
}

// GetVideo proxies video playback requests
func (h *ShareHandler) GetVideo(w http.ResponseWriter, r *http.Request) {
	key := middleware.GetShareKey(r.Context())
	password := middleware.GetPassword(r.Context())
	keyType := h.getKeyType(r.Context())
	assetID := chi.URLParam(r, "assetID")

	// Validate UUID format
	if !middleware.IsValidUUID(assetID) {
		http.Error(w, "Invalid asset ID format", http.StatusBadRequest)
		return
	}

	// Note: We trust Immich to validate that this asset belongs to the shared link
	// The share key query param ensures Immich only returns assets from the share

	resp, err := h.client.GetVideoWithKeyType(assetID, key, password, keyType)
	if err != nil {
		h.logger.Error("failed to get video", zap.Error(err))
		http.Error(w, "Failed to get video", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// Check if Immich returned an error (asset not in share, etc)
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusForbidden {
		http.Error(w, "Asset not found", http.StatusNotFound)
		return
	}

	h.proxyResponse(w, resp)
}
