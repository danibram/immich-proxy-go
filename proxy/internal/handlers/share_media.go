package handlers

import (
	"fmt"
	"mime"
	"net/http"

	"github.com/danibram/immich-proxy-go/internal/immich"
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

	// Immich v3 does not enforce shared-link passwords on media endpoints,
	// so the proxy authorizes here. The verdict is cached per share (see
	// share_authz_cache.go), keeping scroll performance intact.
	if err := h.authorizeShareRequest(r); err != nil {
		h.handleError(w, err)
		return
	}

	resp, err := h.client.GetThumbnailWithKeyType(assetID, key, password, size, keyType)
	if err != nil {
		h.logger.Error("failed to get thumbnail", zap.Error(err))
		http.Error(w, "Failed to get thumbnail", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if h.handledUpstreamMediaError(w, resp) {
		return
	}

	// Let a CDN (e.g. Cloudflare) cache thumbnails of PUBLIC shares so Immich
	// is not re-hit on every gallery view. Only when there is no password on
	// the request: a password-protected share must never be publicly cached,
	// or the CDN would serve it to visitors who never entered the password.
	cacheControl := ""
	if ttl := h.config.Options.ShareMediaCacheTTL; ttl > 0 &&
		resp.StatusCode == http.StatusOK &&
		middleware.GetPassword(r.Context()) == "" {
		cacheControl = fmt.Sprintf("public, max-age=%d", ttl)
	}

	h.proxyResponseWithCache(w, resp, cacheControl)
}

// handledUpstreamMediaError writes a clean, non-leaking response for a
// non-success upstream media response and reports whether it did so. Media
// handlers must never forward Immich's raw error bodies (they leak internal
// phrasing such as "no asset.view access") or its inconsistent status codes
// (400/403/404 all mean the same thing: the asset is not in this share).
// 200 and 206 (ranged playback/downloads) pass through untouched.
func (h *ShareHandler) handledUpstreamMediaError(w http.ResponseWriter, resp *http.Response) bool {
	switch resp.StatusCode {
	case http.StatusOK, http.StatusPartialContent:
		return false
	case http.StatusUnauthorized:
		h.handleError(w, immich.ErrPasswordRequired)
		return true
	default:
		http.Error(w, "Asset not found", http.StatusNotFound)
		return true
	}
}

// GetOriginal proxies original file requests
func (h *ShareHandler) GetOriginal(w http.ResponseWriter, r *http.Request) {
	assetID := chi.URLParam(r, "assetID")

	// Validate UUID format
	if !middleware.IsValidUUID(assetID) {
		http.Error(w, "Invalid asset ID format", http.StatusBadRequest)
		return
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

	// Note: We trust Immich to validate that this asset belongs to the shared link
	// The share key query param ensures Immich only returns assets from the share

	resp, err := h.client.GetOriginalWithKeyType(assetID, creds.key, creds.password, creds.keyType)
	if err != nil {
		h.logger.Error("failed to get original", zap.Error(err))
		http.Error(w, "Failed to get original file", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if h.handledUpstreamMediaError(w, resp) {
		return
	}

	// Immich serves originals with Content-Disposition: inline, which makes
	// browsers RENDER a single downloaded photo in a tab instead of saving
	// it. Nothing displays /original inline (the viewer uses thumbnails and
	// video has its own playback route), so force a real download while
	// preserving the upstream filename.
	forceAttachmentDisposition(resp)

	h.proxyResponse(w, resp)
}

// forceAttachmentDisposition rewrites an upstream Content-Disposition header
// to attachment, keeping the filename parameter when present.
func forceAttachmentDisposition(resp *http.Response) {
	header := resp.Header.Get("Content-Disposition")
	params := map[string]string{}
	if header != "" {
		if _, parsed, err := mime.ParseMediaType(header); err == nil {
			params = parsed
		}
	}
	resp.Header.Set("Content-Disposition", mime.FormatMediaType("attachment", params))
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

	// Same as thumbnails: Immich v3 does not enforce shared-link passwords
	// on media endpoints, so the proxy must.
	if err := h.authorizeShareRequest(r); err != nil {
		h.handleError(w, err)
		return
	}

	resp, err := h.client.GetVideoWithKeyType(assetID, key, password, keyType)
	if err != nil {
		h.logger.Error("failed to get video", zap.Error(err))
		http.Error(w, "Failed to get video", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if h.handledUpstreamMediaError(w, resp) {
		return
	}

	h.proxyResponse(w, resp)
}
