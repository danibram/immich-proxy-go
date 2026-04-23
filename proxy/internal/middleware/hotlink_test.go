package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHotlinkProtection(t *testing.T) {
	// Create a simple handler that returns 200 OK
	okHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	tests := []struct {
		name           string
		publicURL      string
		secFetchDest   string
		secFetchSite   string
		referer        string
		expectedStatus int
		description    string
	}{
		// Same-origin requests from web app (should be allowed)
		{
			name:           "image_same_origin",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "image",
			secFetchSite:   "same-origin",
			expectedStatus: http.StatusOK,
			description:    "Image loaded via <img> from same origin",
		},
		{
			name:           "video_same_origin",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "video",
			secFetchSite:   "same-origin",
			expectedStatus: http.StatusOK,
			description:    "Video loaded via <video> from same origin",
		},
		{
			name:           "fetch_same_origin",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "empty",
			secFetchSite:   "same-origin",
			expectedStatus: http.StatusOK,
			description:    "fetch() API call from same origin",
		},
		{
			name:           "audio_same_origin",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "audio",
			secFetchSite:   "same-origin",
			expectedStatus: http.StatusOK,
			description:    "Audio loaded via <audio> from same origin",
		},

		// Same-site requests (should be allowed)
		{
			name:           "image_same_site",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "image",
			secFetchSite:   "same-site",
			expectedStatus: http.StatusOK,
			description:    "Image from same site (subdomain)",
		},

		// Cross-site requests (CORS, should be allowed for images loaded by browser)
		{
			name:           "image_cross_site",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "image",
			secFetchSite:   "cross-site",
			expectedStatus: http.StatusOK,
			description:    "Image loaded cross-site (embedded in another page)",
		},

		// Direct navigation (should be blocked)
		{
			name:           "document_direct_access",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "document",
			secFetchSite:   "none",
			expectedStatus: http.StatusForbidden,
			description:    "Direct URL access in browser address bar",
		},
		{
			name:           "document_same_origin",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "document",
			secFetchSite:   "same-origin",
			expectedStatus: http.StatusForbidden,
			description:    "Navigation from same origin (clicking link)",
		},

		// No headers (curl, old browsers) - should be blocked
		{
			name:           "no_headers",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "",
			secFetchSite:   "",
			referer:        "",
			expectedStatus: http.StatusForbidden,
			description:    "No Sec-Fetch headers, no Referer (curl/wget)",
		},

		// Referer fallback for older browsers
		{
			name:           "referer_same_host",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "",
			secFetchSite:   "",
			referer:        "https://photos.example.com/s/abc123",
			expectedStatus: http.StatusOK,
			description:    "No Sec-Fetch but valid Referer from same host",
		},
		{
			name:           "referer_different_host",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "",
			secFetchSite:   "",
			referer:        "https://evil.com/steal-images",
			expectedStatus: http.StatusForbidden,
			description:    "Referer from different host (hotlinking attempt)",
		},

		// Edge cases
		{
			name:           "image_no_site_header",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "image",
			secFetchSite:   "none",
			expectedStatus: http.StatusForbidden,
			description:    "Image with Sec-Fetch-Site: none (suspicious)",
		},
		{
			name:           "empty_public_url_with_referer",
			publicURL:      "",
			secFetchDest:   "",
			secFetchSite:   "",
			referer:        "https://photos.example.com/page",
			expectedStatus: http.StatusForbidden,
			description:    "No public URL configured, can't validate referer",
		},

		// Script/iframe attempts (should be blocked)
		{
			name:           "script_same_origin",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "script",
			secFetchSite:   "same-origin",
			expectedStatus: http.StatusForbidden,
			description:    "Script request (not allowed)",
		},
		{
			name:           "iframe_cross_site",
			publicURL:      "https://photos.example.com",
			secFetchDest:   "iframe",
			secFetchSite:   "cross-site",
			expectedStatus: http.StatusForbidden,
			description:    "Iframe embedding (not allowed)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create middleware
			middleware := HotlinkProtection(tt.publicURL)
			handler := middleware(okHandler)

			// Create request
			req := httptest.NewRequest("GET", "/api/assets/123/thumbnail", nil)
			if tt.secFetchDest != "" {
				req.Header.Set("Sec-Fetch-Dest", tt.secFetchDest)
			}
			if tt.secFetchSite != "" {
				req.Header.Set("Sec-Fetch-Site", tt.secFetchSite)
			}
			if tt.referer != "" {
				req.Header.Set("Referer", tt.referer)
			}

			// Execute request
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			// Check status
			if rr.Code != tt.expectedStatus {
				t.Errorf("%s: expected status %d, got %d", tt.description, tt.expectedStatus, rr.Code)
			}
		})
	}
}

func TestHotlinkProtection_PublicURLParsing(t *testing.T) {
	tests := []struct {
		name        string
		publicURL   string
		referer     string
		shouldAllow bool
	}{
		{
			name:        "https_url",
			publicURL:   "https://photos.example.com",
			referer:     "https://photos.example.com/page",
			shouldAllow: true,
		},
		{
			name:        "http_url",
			publicURL:   "http://localhost:3000",
			referer:     "http://localhost:3000/share/abc",
			shouldAllow: true,
		},
		{
			name:        "url_with_path",
			publicURL:   "https://photos.example.com/proxy",
			referer:     "https://photos.example.com/other",
			shouldAllow: true,
		},
		{
			name:        "url_with_port",
			publicURL:   "https://photos.example.com:8443",
			referer:     "https://photos.example.com:8443/share/abc",
			shouldAllow: true,
		},
		{
			// SECURITY: previously this returned true because we used
			// strings.Contains. The new url.Parse + exact host match
			// correctly rejects attacker-suffixed hosts.
			name:        "partial_match_blocked",
			publicURL:   "https://photos.example.com",
			referer:     "https://photos.example.com.evil.com/attack",
			shouldAllow: false,
		},
		{
			// Attacker puts the real host in the PATH rather than the
			// host portion - would defeat a contains() check, must not
			// defeat our exact-host match.
			name:        "real_host_in_path_blocked",
			publicURL:   "https://photos.example.com",
			referer:     "https://evil.example.net/photos.example.com/attack",
			shouldAllow: false,
		},
		{
			// Attacker puts the real host in a query parameter value.
			name:        "real_host_in_query_blocked",
			publicURL:   "https://photos.example.com",
			referer:     "https://evil.example.net/?x=photos.example.com",
			shouldAllow: false,
		},
		{
			// Userinfo-style URL: "user@photos.example.com" inside an
			// attacker-controlled URL. The actual host is evil.example.
			name:        "userinfo_host_trick_blocked",
			publicURL:   "https://photos.example.com",
			referer:     "https://photos.example.com@evil.example/attack",
			shouldAllow: false,
		},
	}

	okHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware := HotlinkProtection(tt.publicURL)
			handler := middleware(okHandler)

			req := httptest.NewRequest("GET", "/api/test", nil)
			// No Sec-Fetch headers, only Referer
			req.Header.Set("Referer", tt.referer)

			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			if tt.shouldAllow && rr.Code != http.StatusOK {
				t.Errorf("Expected request to be allowed, got status %d", rr.Code)
			}
			if !tt.shouldAllow && rr.Code != http.StatusForbidden {
				t.Errorf("Expected request to be blocked, got status %d", rr.Code)
			}
		})
	}
}

func TestHotlinkProtection_RealWorldScenarios(t *testing.T) {
	okHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	middleware := HotlinkProtection("https://photos.example.com")
	handler := middleware(okHandler)

	scenarios := []struct {
		name           string
		setupRequest   func(*http.Request)
		expectedStatus int
	}{
		{
			name: "chrome_img_tag_load",
			setupRequest: func(r *http.Request) {
				// Chrome loading image via <img> tag
				r.Header.Set("Sec-Fetch-Dest", "image")
				r.Header.Set("Sec-Fetch-Mode", "no-cors")
				r.Header.Set("Sec-Fetch-Site", "same-origin")
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "chrome_fetch_api",
			setupRequest: func(r *http.Request) {
				// Chrome fetch() API call
				r.Header.Set("Sec-Fetch-Dest", "empty")
				r.Header.Set("Sec-Fetch-Mode", "cors")
				r.Header.Set("Sec-Fetch-Site", "same-origin")
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "chrome_address_bar",
			setupRequest: func(r *http.Request) {
				// Chrome direct URL in address bar
				r.Header.Set("Sec-Fetch-Dest", "document")
				r.Header.Set("Sec-Fetch-Mode", "navigate")
				r.Header.Set("Sec-Fetch-Site", "none")
				r.Header.Set("Sec-Fetch-User", "?1")
			},
			expectedStatus: http.StatusForbidden,
		},
		{
			name: "firefox_video_tag",
			setupRequest: func(r *http.Request) {
				// Firefox loading video
				r.Header.Set("Sec-Fetch-Dest", "video")
				r.Header.Set("Sec-Fetch-Mode", "no-cors")
				r.Header.Set("Sec-Fetch-Site", "same-origin")
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "curl_no_headers",
			setupRequest: func(r *http.Request) {
				// curl with no special headers
				r.Header.Set("User-Agent", "curl/7.79.1")
			},
			expectedStatus: http.StatusForbidden,
		},
		{
			name: "curl_spoofed_referer",
			setupRequest: func(r *http.Request) {
				// curl trying to spoof referer
				r.Header.Set("User-Agent", "curl/7.79.1")
				r.Header.Set("Referer", "https://photos.example.com/share/abc")
			},
			expectedStatus: http.StatusOK, // Passes because we can't detect spoofing
		},
		{
			name: "hotlink_from_external_site",
			setupRequest: func(r *http.Request) {
				// External site trying to embed image
				r.Header.Set("Sec-Fetch-Dest", "image")
				r.Header.Set("Sec-Fetch-Mode", "no-cors")
				r.Header.Set("Sec-Fetch-Site", "cross-site")
				r.Header.Set("Referer", "https://evil-site.com/blog")
			},
			expectedStatus: http.StatusOK, // Allowed because browser correctly identifies it as image load
		},
		{
			name: "bookmark_direct_access",
			setupRequest: func(r *http.Request) {
				// User clicking a bookmarked image URL
				r.Header.Set("Sec-Fetch-Dest", "document")
				r.Header.Set("Sec-Fetch-Mode", "navigate")
				r.Header.Set("Sec-Fetch-Site", "none")
			},
			expectedStatus: http.StatusForbidden,
		},
	}

	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/assets/123/thumbnail", nil)
			scenario.setupRequest(req)

			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			if rr.Code != scenario.expectedStatus {
				t.Errorf("%s: expected status %d, got %d", scenario.name, scenario.expectedStatus, rr.Code)
			}
		})
	}
}
