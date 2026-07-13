package handlers

import (
	"fmt"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/danibram/immich-proxy-go/internal/config"
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
	if size == string(config.QualityFullsize) {
		if h.config.Options.ZoomQuality() != config.QualityFullsize {
			http.Error(w, "Full-size viewing is disabled", http.StatusForbidden)
			return
		}
		link, creds, droppedStalePassword, err := h.loadShareLinkFromRequest(r)
		if err != nil {
			h.handleError(w, err)
			return
		}
		if h.rejectIfExpired(w, link) {
			return
		}
		if droppedStalePassword {
			clearSharePasswordCookie(w, r)
		}
		// Immich's allowDownload flag is also its full-resolution disclosure
		// gate. The proxy's download UI switch is deliberately irrelevant to
		// zoom: operators may hide downloads while still allowing full-size view.
		if !link.AllowDownload {
			http.Error(w, "Full-size viewing is disabled for this share", http.StatusForbidden)
			return
		}
		// A stale password cookie on a now-public share may have been dropped
		// while loading the link; use the normalized credentials for the image.
		key, password, keyType = creds.key, creds.password, creds.keyType
	} else if err := h.authorizeShareRequest(r); err != nil {
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

	cacheControl := ""
	if size != string(config.QualityFullsize) {
		cacheControl = thumbnailCacheControl(r, resp.StatusCode, h.config.Options)
	}
	h.proxyResponseWithCache(w, resp, cacheControl)
}

// GetThumbnailExt serves /thumbnail.{ext} — the same passthrough as
// GetThumbnail, but with a file extension in the path. The extension exists
// purely so CDNs with extension-based cache eligibility (Cloudflare's default
// setup caches .webp/.jpg but marks extensionless API paths DYNAMIC) treat the
// URL as a cacheable image and honour the origin Cache-Control emitted by
// thumbnailCacheControl. The extension is advisory only: Immich's Content-Type
// header wins, and the response bytes are identical to the legacy route.
func (h *ShareHandler) GetThumbnailExt(w http.ResponseWriter, r *http.Request) {
	if !isAllowedThumbnailExt(chi.URLParam(r, "ext")) {
		http.NotFound(w, r)
		return
	}
	h.GetThumbnail(w, r)
}

// ServeSingleImage exposes the sole image in an INDIVIDUAL share as raw image
// bytes at /share/{key}/raw (and /s/{slug}/raw). It is intentionally outside
// the SPA/API hotlink guard so the URL can be used in an <img>, while still
// enforcing the share password, expiry, membership, and Immich permissions.
func (h *ShareHandler) ServeSingleImage(w http.ResponseWriter, r *http.Request) {
	link, creds, droppedStalePassword, err := h.loadShareLinkFromRequest(r)
	if err != nil {
		h.handleError(w, err)
		return
	}
	if h.rejectIfExpired(w, link) {
		return
	}
	if droppedStalePassword {
		clearSharePasswordCookie(w, r)
	}
	if link.Type != "INDIVIDUAL" || len(link.Assets) != 1 || link.Assets[0].Type != "IMAGE" {
		http.NotFound(w, r)
		return
	}

	assetID := link.Assets[0].ID
	if !middleware.IsValidUUID(assetID) {
		http.NotFound(w, r)
		return
	}
	quality := config.QualityPreview
	if link.AllowDownload && h.config.Options.ZoomQuality() == config.QualityFullsize {
		quality = config.QualityFullsize
	}
	resp, err := h.client.GetThumbnailWithKeyType(assetID, creds.key, creds.password, string(quality), creds.keyType)
	if err != nil {
		h.logger.Error("failed to get single-share image", zap.Error(err))
		http.Error(w, "Failed to get image", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()
	if h.handledUpstreamMediaError(w, resp) {
		return
	}

	cacheControl := ""
	if quality != config.QualityFullsize {
		cacheControl = thumbnailCacheControl(r, resp.StatusCode, h.config.Options)
	}
	h.proxyResponseWithCache(w, resp, cacheControl)
}

// isAllowedThumbnailExt allows only the extensions Immich actually produces
// for resized thumbnails (webp for size=thumbnail, jpg for size=preview).
// Anything else — notably .heic, which Cloudflare's default cache list
// excludes — is rejected so URLs never advertise formats we don't serve.
func isAllowedThumbnailExt(ext string) bool {
	return ext == "webp" || ext == "jpg"
}

// thumbnailCacheControl decides how a thumbnail may be cached:
//   - PUBLIC share (no password): "public, max-age" so a CDN (Cloudflare) can
//     edge-cache it and spare Immich the repeat traffic.
//   - PASSWORD-PROTECTED share: "private, max-age" so only the authenticated
//     visitor's own browser caches it — shared caches must not, or they would
//     serve it to visitors who never entered the password.
//   - otherwise: "" (the no-store default).
func thumbnailCacheControl(r *http.Request, statusCode int, opts config.OptionsConfig) string {
	if statusCode != http.StatusOK {
		return ""
	}
	if middleware.GetPassword(r.Context()) == "" {
		if opts.ShareMediaCacheTTL > 0 {
			return fmt.Sprintf("public, max-age=%d", opts.ShareMediaCacheTTL)
		}
		return ""
	}
	if opts.ProtectedMediaCacheTTL > 0 {
		return fmt.Sprintf("private, max-age=%d", opts.ProtectedMediaCacheTTL)
	}
	return ""
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

	quality := h.config.Options.DownloadQuality()
	var resp *http.Response
	if quality == config.QualityOriginal {
		resp, err = h.client.GetOriginalWithKeyType(assetID, creds.key, creds.password, creds.keyType)
	} else {
		asset, assetErr := h.client.GetAssetWithKeyType(assetID, creds.key, creds.password, creds.keyType)
		if assetErr != nil {
			h.handleError(w, assetErr)
			return
		}
		// Video has no meaningful preview/fullsize download tier; preserve the
		// original playable bytes while image downloads obey the configured cap.
		if asset.Type == "IMAGE" {
			resp, err = h.client.GetThumbnailWithKeyType(assetID, creds.key, creds.password, string(quality), creds.keyType)
			if err == nil {
				forceQualityAttachmentDisposition(resp, asset.OriginalFileName)
			}
		} else {
			resp, err = h.client.GetOriginalWithKeyType(assetID, creds.key, creds.password, creds.keyType)
		}
	}
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
	if quality == config.QualityOriginal {
		forceAttachmentDisposition(resp)
	}

	h.proxyResponse(w, resp)
}

// forceQualityAttachmentDisposition gives a converted preview/fullsize image
// a filename whose extension matches the bytes returned by Immich.
func forceQualityAttachmentDisposition(resp *http.Response, originalName string) {
	if resp == nil {
		return
	}
	contentType := strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
	ext := getExtensionForMimeType(contentType)
	if ext == "" {
		ext = ".jpg"
	}
	base := strings.TrimSuffix(filepath.Base(originalName), filepath.Ext(originalName))
	base = sanitizeFilename(base)
	if base == "" {
		base = "photo"
	}
	resp.Header.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{
		"filename": base + ext,
	}))
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
