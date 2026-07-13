package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"go.uber.org/zap"
)

// shareCredentials holds request-scoped values needed for Immich API calls.
type shareCredentials struct {
	key      string
	password string
	keyType  immich.KeyType
}

// loadShareLinkFromRequest fetches the shared link for the current request context.
func (h *ShareHandler) loadShareLinkFromRequest(r *http.Request) (*immich.SharedLink, shareCredentials, bool, error) {
	return h.loadShareLink(r.Context(), middleware.GetPassword(r.Context()))
}

// loadShareLink fetches the shared link using context key/slug and the given password.
func (h *ShareHandler) loadShareLink(ctx context.Context, password string) (*immich.SharedLink, shareCredentials, bool, error) {
	key := middleware.GetShareKey(ctx)
	keyType := h.getKeyType(ctx)

	link, droppedStalePassword, err := h.client.GetSharedLinkWithKeyTypeDroppedStalePassword(key, password, keyType)
	if droppedStalePassword {
		password = ""
	}
	creds := shareCredentials{key: key, password: password, keyType: keyType}

	if err != nil {
		return nil, creds, droppedStalePassword, err
	}
	return link, creds, droppedStalePassword, nil
}

// rejectIfExpired writes an HTTP error when the link has expired. Returns true if rejected.
func (h *ShareHandler) rejectIfExpired(w http.ResponseWriter, link *immich.SharedLink) bool {
	if errMsg, statusCode := h.validateSharedLink(link); errMsg != "" {
		http.Error(w, errMsg, statusCode)
		return true
	}
	return false
}

// allowDownload reports whether proxy config and link flags both permit download.
func (h *ShareHandler) allowDownload(link *immich.SharedLink) bool {
	return h.config.Options.AllowDownload && link.AllowDownload
}

// validateSharedLink validates common shared link conditions (expiration, etc.)
// Returns an error message and status code if validation fails, or empty string if OK
func (h *ShareHandler) validateSharedLink(link *immich.SharedLink) (string, int) {
	// Check if the shared link has expired
	if link.ExpiresAt != nil && link.ExpiresAt.Before(time.Now()) {
		return "Shared link has expired", http.StatusGone
	}

	return "", 0
}

// filterValidAssets returns only assets that are not trashed
func (h *ShareHandler) filterValidAssets(assets []immich.Asset) []immich.Asset {
	valid := make([]immich.Asset, 0, len(assets))
	for _, asset := range assets {
		if !asset.IsTrashed {
			valid = append(valid, asset)
		}
	}
	return valid
}

// getKeyType converts middleware.KeyType to immich.KeyType
func (h *ShareHandler) getKeyType(ctx context.Context) immich.KeyType {
	kt := middleware.GetKeyType(ctx)
	if kt == middleware.KeyTypeSlug {
		return immich.KeyTypeSlug
	}
	return immich.KeyTypeKey
}

// proxyResponse copies the response from Immich to the client, marking it
// uncacheable (the default for private share content).
func (h *ShareHandler) proxyResponse(w http.ResponseWriter, resp *http.Response) {
	h.proxyResponseWithCache(w, resp, "")
}

// proxyResponseWithCache is like proxyResponse but lets the caller advertise a
// specific Cache-Control (e.g. "public, max-age=…" for a PUBLIC share's
// thumbnails). An empty cacheControl keeps the safe no-store default. Callers
// must only pass a public directive when the content is genuinely public —
// otherwise a CDN would serve it to visitors who lack the share password.
func (h *ShareHandler) proxyResponseWithCache(w http.ResponseWriter, resp *http.Response, cacheControl string) {
	// Allowlist of headers to copy from upstream (safe headers only)
	// This prevents leaking sensitive info and hop-by-hop header issues
	allowedHeaders := map[string]bool{
		"Content-Type":        true,
		"Content-Length":      true,
		"Content-Disposition": true,
		"Content-Encoding":    true,
		"Content-Range":       true,
		"Accept-Ranges":       true,
		"Last-Modified":       true,
		"Etag":                true,
	}

	for key, values := range resp.Header {
		// Only copy allowed headers (case-insensitive check via http.CanonicalHeaderKey)
		if allowedHeaders[key] {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
	}

	if cacheControl != "" {
		// Overrides the NoCache middleware for cacheable content.
		w.Header().Set("Cache-Control", cacheControl)
		w.Header().Del("Pragma")
		w.Header().Del("Expires")
	} else {
		// Share content should NOT be cached by proxies/browsers by default.
		// NoCache middleware already sets these headers, but we reinforce here.
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, private")
		w.Header().Set("Pragma", "no-cache")
	}

	w.WriteHeader(resp.StatusCode)
	// The media client has no total timeout (a long video must be allowed to
	// stream for minutes), so the copy itself guards against a hung upstream:
	// if no bytes are delivered for mediaIdleTimeout the stream is aborted.
	copyWithIdleTimeout(w, resp.Body, mediaIdleTimeout)
}

// mediaIdleTimeout is how long a media stream may go without delivering a
// single byte before the proxy gives up on it. Generous on purpose: it only
// needs to catch genuinely wedged connections, never slow-but-alive ones.
const mediaIdleTimeout = 60 * time.Second

// copyWithIdleTimeout streams src to dst, aborting when no bytes have been
// delivered for the given idle duration. Progress — not wall clock — is the
// health signal, so a multi-minute video download is fine while a wedged
// upstream (or client) is reclaimed after one idle window. The abort works by
// closing src, which unblocks the pending Read with an error.
func copyWithIdleTimeout(dst io.Writer, src io.ReadCloser, idle time.Duration) error {
	watchdog := time.AfterFunc(idle, func() { src.Close() })
	defer watchdog.Stop()

	buf := make([]byte, 64*1024)
	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			if _, writeErr := dst.Write(buf[:n]); writeErr != nil {
				return writeErr
			}
			// Re-arm only after the bytes reached the client: a stalled
			// client write counts as lack of progress too.
			watchdog.Reset(idle)
		}
		if readErr != nil {
			if readErr == io.EOF {
				return nil
			}
			return readErr
		}
	}
}

// handleError handles errors from the Immich client
func (h *ShareHandler) handleError(w http.ResponseWriter, err error) {
	switch err {
	case immich.ErrSharedLinkNotFound:
		http.Error(w, "Shared link not found or expired", http.StatusNotFound)
	case immich.ErrPasswordRequired:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]bool{"passwordRequired": true})
	case immich.ErrAssetNotFound:
		http.Error(w, "Asset not found", http.StatusNotFound)
	default:
		h.logger.Error("immich client error", zap.Error(err))
		if errors.Is(err, immich.ErrUpstreamUnavailable) {
			http.Error(w, "Unable to reach Immich upstream", http.StatusBadGateway)
		} else if stringsContainsStatus404(err) {
			http.Error(w, "Not found", http.StatusNotFound)
		} else {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
	}
}

func stringsContainsStatus404(err error) bool {
	return err != nil && strings.Contains(err.Error(), "status code 404")
}
