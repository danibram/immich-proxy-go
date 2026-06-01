package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// GetSharedLink returns information about a shared link
// For album shares, it automatically fetches the full album details to avoid a second request
func (h *ShareHandler) GetSharedLink(w http.ResponseWriter, r *http.Request) {
	link, creds, err := h.loadShareLinkFromRequest(r)
	if err != nil {
		h.handleError(w, err)
		return
	}

	if h.rejectIfExpired(w, link) {
		return
	}

	// For album shares, fetch full album details (includes all assets)
	// This saves the frontend from making a second request
	if link.Type == "ALBUM" && link.Album != nil && link.Album.ID != "" {
		album, err := h.client.GetAlbumWithKeyType(link.Album.ID, creds.key, creds.password, creds.keyType)
		if err != nil {
			h.logger.Warn("failed to fetch album details", zap.Error(err), zap.String("albumId", link.Album.ID))
			// Continue with partial album data from shared link
		} else {
			link.Album = album
		}
	}

	// Filter out trashed assets
	link.Assets = h.filterValidAssets(link.Assets)
	if link.Album != nil {
		link.Album.Assets = h.filterValidAssets(link.Album.Assets)
	}

	effectiveShowMetadata := applyEffectiveShareOptions(link, h.config.Options)

	// Strip sensitive/internal fields before exposing to the public.
	// This removes: password, token, owner email/name, user IDs,
	// Immich filesystem paths, device IDs, checksums, GPS coordinates,
	// and face-recognition people (when metadata is disabled).
	sanitizeSharedLink(link, effectiveShowMetadata)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(link)
}

// GetAlbum returns album information
func (h *ShareHandler) GetAlbum(w http.ResponseWriter, r *http.Request) {
	albumID := chi.URLParam(r, "albumID")

	// Validate UUID format
	if !middleware.IsValidUUID(albumID) {
		http.Error(w, "Invalid album ID format", http.StatusBadRequest)
		return
	}

	link, creds, err := h.loadShareLinkFromRequest(r)
	if err != nil {
		h.handleError(w, err)
		return
	}

	if h.rejectIfExpired(w, link) {
		return
	}

	// Verify the album belongs to this shared link
	if link.Album == nil || link.Album.ID != albumID {
		http.Error(w, "Album not found in shared link", http.StatusNotFound)
		return
	}

	album, err := h.client.GetAlbumWithKeyType(albumID, creds.key, creds.password, creds.keyType)
	if err != nil {
		h.handleError(w, err)
		return
	}

	// Filter out trashed assets
	album.Assets = h.filterValidAssets(album.Assets)

	effectiveShowMetadata := applyEffectiveShareOptions(link, h.config.Options)

	// Strip sensitive/internal fields before exposing to the public.
	sanitizeAlbumResponse(album, effectiveShowMetadata)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(album)
}
