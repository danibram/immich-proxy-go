package middleware

import (
	"net/http"
	"net/url"
	"strings"
)

// HotlinkProtection creates a middleware that blocks direct URL access to assets.
// It checks the Sec-Fetch-* headers to ensure requests come from the web app.
// This helps prevent:
// - Direct URL sharing of images
// - Hotlinking from other websites
// - Bypassing the web interface
//
// Note: This is not a security guarantee as headers can be spoofed,
// but it prevents casual direct access.
func HotlinkProtection(publicURL string) func(http.Handler) http.Handler {
	// Extract the host from public URL for referer checking
	var allowedHost string
	if publicURL != "" {
		// Remove protocol
		host := strings.TrimPrefix(publicURL, "https://")
		host = strings.TrimPrefix(host, "http://")
		// Remove path
		if idx := strings.Index(host, "/"); idx != -1 {
			host = host[:idx]
		}
		allowedHost = host
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Check Sec-Fetch-Dest header (modern browsers)
			// When browser loads image via <img> or fetch(), it sets Sec-Fetch-Dest: image
			// When user navigates directly to URL, it sets Sec-Fetch-Dest: document
			secFetchDest := r.Header.Get("Sec-Fetch-Dest")
			secFetchSite := r.Header.Get("Sec-Fetch-Site")

			// If we have Sec-Fetch headers, use them for validation
			if secFetchDest != "" {
				// Only allow specific destination types
				allowedDests := map[string]bool{
					"image": true,
					"video": true,
					"audio": true,
					"empty": true, // fetch() requests
				}

				// Block disallowed destinations (document, script, iframe, etc.)
				if !allowedDests[secFetchDest] {
					http.Error(w, "Direct access not allowed", http.StatusForbidden)
					return
				}

				// For allowed destinations, verify the site context
				// Sec-Fetch-Site: none means direct access or bookmarks - block it
				if secFetchSite == "none" || secFetchSite == "" {
					http.Error(w, "Direct access not allowed", http.StatusForbidden)
					return
				}

				// Allow same-origin, same-site, and cross-site (for embedded images)
				if secFetchSite == "same-origin" || secFetchSite == "same-site" || secFetchSite == "cross-site" {
					next.ServeHTTP(w, r)
					return
				}

				// Unknown Sec-Fetch-Site value - block for safety
				http.Error(w, "Invalid request context", http.StatusForbidden)
				return
			}

			// Fallback: Check Referer header for older browsers (no Sec-Fetch support)
			referer := r.Header.Get("Referer")
			if referer != "" {
				// If we don't have a public URL configured, we can't validate referer
				if allowedHost == "" {
					http.Error(w, "Cannot validate request origin", http.StatusForbidden)
					return
				}

				// Parse the Referer as a URL and compare hosts exactly.
				// Using strings.Contains here is unsafe because
				// "photos.example.com.evil.com" contains "photos.example.com"
				// and would be accepted as legitimate.
				if refURL, err := url.Parse(referer); err == nil {
					refHost := refURL.Host
					if refHost != "" && hostMatches(refHost, allowedHost) {
						next.ServeHTTP(w, r)
						return
					}
				}

				// Referer from different site - block
				http.Error(w, "Hotlinking not allowed", http.StatusForbidden)
				return
			}

			// No Sec-Fetch-Dest and no Referer - likely direct access or old browser
			// Block by default when we can't determine the source
			http.Error(w, "Direct access not allowed", http.StatusForbidden)
		})
	}
}

// hostMatches performs a case-insensitive exact host comparison between two
// host[:port] values. It rejects tricks like a trailing attacker-controlled
// suffix (photos.example.com.evil.com) that would fool substring matching.
func hostMatches(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}
