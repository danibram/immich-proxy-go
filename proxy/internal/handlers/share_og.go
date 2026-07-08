package handlers

import (
	"fmt"
	"html"
	"io"
	"net/http"
	"strings"

	"github.com/danibram/immich-proxy-go/internal/middleware"
)

// ShareIndexHead builds the per-share <head> content (OpenGraph / Twitter card
// meta) injected into the SPA shell so shared links unfurl nicely in chat apps.
//
// It only emits tags when the shared link loads WITHOUT interactive input —
// i.e. a public share, or one already unlocked via the request's password
// cookie. An unfurl bot carries no cookie, so a password-protected album's
// name and cover never leak from its URL: loadShareLink returns
// password-required and this returns "" (the plain shell is served).
func (h *ShareHandler) ShareIndexHead(r *http.Request) string {
	link, _, _, err := h.loadShareLinkFromRequest(r)
	if err != nil || link == nil {
		return ""
	}
	if _, statusCode := h.validateSharedLink(link); statusCode != 0 {
		return "" // expired
	}

	title := ""
	description := ""
	hasCover := false
	if link.Album != nil {
		title = link.Album.AlbumName
		description = link.Album.Description
		hasCover = link.Album.AlbumThumbnailAssetID != "" || len(link.Album.Assets) > 0
	}
	if title == "" {
		title = "Shared Album"
	}
	if description == "" {
		description = "Shared album"
	}

	base := absoluteBaseURL(r, h.config.Proxy.PublicURL)
	shareURL := base + shareBasePath(r)

	var b strings.Builder
	meta := func(property, content string) {
		b.WriteString(fmt.Sprintf(`<meta property="%s" content="%s">`+"\n", property, html.EscapeString(content)))
	}
	named := func(name, content string) {
		b.WriteString(fmt.Sprintf(`<meta name="%s" content="%s">`+"\n", name, html.EscapeString(content)))
	}

	meta("og:type", "website")
	meta("og:site_name", "Immich Public Proxy")
	meta("og:title", title)
	meta("og:description", description)
	meta("og:url", shareURL)
	named("twitter:title", title)
	named("twitter:description", description)

	if hasCover {
		coverURL := base + shareBasePath(r) + "/og-cover"
		meta("og:image", coverURL)
		named("twitter:card", "summary_large_image")
		named("twitter:image", coverURL)
	} else {
		named("twitter:card", "summary")
	}

	return b.String()
}

// ServeOGImage streams the album cover thumbnail for a shared link. It lives
// outside the hotlink-protected /api group because the clients here are unfurl
// bots (Slack, WhatsApp, …) that send no Sec-Fetch headers. It 404s for
// password-protected or invalid shares, so nothing leaks from a bare URL.
func (h *ShareHandler) ServeOGImage(w http.ResponseWriter, r *http.Request) {
	link, creds, _, err := h.loadShareLinkFromRequest(r)
	if err != nil || link == nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	if _, statusCode := h.validateSharedLink(link); statusCode != 0 {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	assetID := ""
	if link.Album != nil {
		assetID = link.Album.AlbumThumbnailAssetID
		if assetID == "" && len(link.Album.Assets) > 0 {
			assetID = link.Album.Assets[0].ID
		}
	}
	if assetID == "" && len(link.Assets) > 0 {
		assetID = link.Assets[0].ID
	}
	if !middleware.IsValidUUID(assetID) {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	resp, err := h.client.GetThumbnailWithKeyType(assetID, creds.key, creds.password, "thumbnail", creds.keyType)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	// A public share's cover may be cached by unfurl services / CDNs.
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, resp.Body)
}

// shareBasePath returns the "/share/{key}" or "/s/{key}" prefix of the request
// path, stripping any deeper SPA route.
func shareBasePath(r *http.Request) string {
	segments := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/"), "/", 3)
	if len(segments) >= 2 {
		return "/" + segments[0] + "/" + segments[1]
	}
	return r.URL.Path
}

// absoluteBaseURL prefers the configured public URL (correct behind a reverse
// proxy) and otherwise reconstructs the origin from the request.
func absoluteBaseURL(r *http.Request, publicURL string) string {
	if publicURL != "" {
		return strings.TrimRight(publicURL, "/")
	}
	scheme := "https"
	if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") != "https" {
		scheme = "http"
	}
	return scheme + "://" + r.Host
}
