package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danibram/immich-proxy-go/internal/config"
	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/danibram/immich-proxy-go/internal/sharecookie"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func TestGetOriginal_UsesConfiguredPreviewQualityForImages(t *testing.T) {
	var requestedSize string
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/shared-links/me":
			_ = json.NewEncoder(w).Encode(immich.SharedLink{Type: "INDIVIDUAL", AllowDownload: true})
		case r.URL.Path == "/api/assets/"+testAssetID1:
			_ = json.NewEncoder(w).Encode(immich.Asset{ID: testAssetID1, Type: "IMAGE", OriginalFileName: "summer.heic"})
		case r.URL.Path == "/api/assets/"+testAssetID1+"/thumbnail":
			requestedSize = r.URL.Query().Get("size")
			w.Header().Set("Content-Type", "image/jpeg")
			_, _ = w.Write([]byte("preview"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer mockServer.Close()

	_, router := setupTestHandlerWithOptions(t, mockServer, config.OptionsConfig{
		AllowDownload:      true,
		MaxDownloadQuality: config.QualityPreview,
	})
	req := httptest.NewRequest("GET", "/api/share/valid-key/asset/"+testAssetID1+"/original", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || requestedSize != "preview" {
		t.Fatalf("status=%d requested size=%q", rec.Code, requestedSize)
	}
	if got := rec.Header().Get("Content-Disposition"); got != "attachment; filename=summer.jpg" {
		t.Fatalf("Content-Disposition = %q", got)
	}
}

func TestGetThumbnail_FullsizeRequiresConfigAndImmichPermission(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, defaultRouter := setupTestHandler(t, mockServer)
	req := httptest.NewRequest("GET", "/api/share/valid-key/asset/"+testAssetID1+"/thumbnail?size=fullsize", nil)
	rec := httptest.NewRecorder()
	defaultRouter.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("default quality status = %d, want 403", rec.Code)
	}

	_, fullRouter := setupTestHandlerWithOptions(t, mockServer, config.OptionsConfig{
		AllowDownload:  false,
		MaxZoomQuality: config.QualityFullsize,
	})
	req = httptest.NewRequest("GET", "/api/share/valid-key/asset/"+testAssetID1+"/thumbnail?size=fullsize", nil)
	rec = httptest.NewRecorder()
	fullRouter.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("permitted fullsize status = %d, want 200", rec.Code)
	}

	req = httptest.NewRequest("GET", "/api/share/no-download/asset/"+testAssetID1+"/thumbnail?size=fullsize", nil)
	rec = httptest.NewRecorder()
	fullRouter.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("Immich-denied fullsize status = %d, want 403", rec.Code)
	}
}

func TestServeSingleImage(t *testing.T) {
	var requestedSize string
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/shared-links/me":
			_ = json.NewEncoder(w).Encode(immich.SharedLink{
				Type:          "INDIVIDUAL",
				AllowDownload: true,
				Assets:        []immich.Asset{{ID: testAssetID1, Type: "IMAGE"}},
			})
		case "/api/assets/" + testAssetID1 + "/thumbnail":
			requestedSize = r.URL.Query().Get("size")
			w.Header().Set("Content-Type", "image/jpeg")
			_, _ = w.Write([]byte("raw-image"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer mockServer.Close()

	_, router := setupTestHandlerWithOptions(t, mockServer, config.OptionsConfig{
		MaxZoomQuality: config.QualityFullsize,
	})
	req := httptest.NewRequest("GET", "/api/share/individual-key/raw", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "raw-image" || requestedSize != "fullsize" {
		t.Fatalf("status=%d body=%q size=%q", rec.Code, rec.Body.String(), requestedSize)
	}
}

func TestGetThumbnail_Success(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/valid-key/asset/"+testAssetID1+"/thumbnail", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}

	contentType := rec.Header().Get("Content-Type")
	if contentType != "image/jpeg" {
		t.Errorf("expected content-type 'image/jpeg', got '%s'", contentType)
	}
}

func TestGetThumbnail_PasswordRequired(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/password-protected/asset/"+testAssetID1+"/thumbnail", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rec.Code)
	}
}

func TestGetOriginal_Success(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/valid-key/asset/"+testAssetID1+"/original", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}
}

func TestGetOriginal_DownloadDisabled(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	client := immich.NewClient(mockServer.URL)
	cfg := &config.Config{
		Options: config.OptionsConfig{
			AllowDownload: false,
		},
	}
	logger := zap.NewNop()
	handler := NewShareHandler(client, cfg, logger, "test-secret-key-12345")

	r := chi.NewRouter()
	r.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Get("/asset/{assetID}/original", handler.GetOriginal)
	})

	req := httptest.NewRequest("GET", "/api/share/valid-key/asset/"+testAssetID1+"/original", nil)
	rec := httptest.NewRecorder()

	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", rec.Code)
	}
}

// TestForceAttachmentDisposition guards the single-download UX: Immich sends
// Content-Disposition: inline for originals, which makes browsers render the
// photo in a tab instead of saving it. The proxy must rewrite it to
// attachment while keeping the filename.
func TestForceAttachmentDisposition(t *testing.T) {
	cases := []struct {
		name     string
		upstream string
		want     string
	}{
		{"inline with filename", `inline; filename="photo.jpg"`, `attachment; filename=photo.jpg`},
		{"inline with encoded filename", `inline; filename*=UTF-8''photo.png`, `attachment; filename=photo.png`},
		{"missing header", ``, `attachment`},
		{"unparsable header", `;;;`, `attachment`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := &http.Response{Header: http.Header{}}
			if tc.upstream != "" {
				resp.Header.Set("Content-Disposition", tc.upstream)
			}
			forceAttachmentDisposition(resp)
			if got := resp.Header.Get("Content-Disposition"); got != tc.want {
				t.Errorf("forceAttachmentDisposition(%q) = %q, want %q", tc.upstream, got, tc.want)
			}
		})
	}
}

// TestGetThumbnail_EnforcesPasswordWhenUpstreamDoesNot pins the proxy-side
// authorization added for Immich v3, whose media endpoints return 200 with
// just a share key even when the link is password-protected. The proxy must
// reject unauthenticated media requests itself, and must cache the verdict so
// galleries do not pay one shared-links/me lookup per tile.
func TestGetThumbnail_EnforcesPasswordWhenUpstreamDoesNot(t *testing.T) {
	const password = "secret123"
	var linkCalls, mediaCalls int

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/shared-links/login":
			w.WriteHeader(http.StatusNotFound) // v2-style login absent; irrelevant here
		case r.URL.Path == "/api/shared-links/me":
			linkCalls++
			if r.URL.Query().Get("password") != password {
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"message":"Password required"}`))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"id":"link-1","key":"leaky","type":"ALBUM","allowDownload":true,"showMetadata":true,"assets":[]}`))
		case strings.HasSuffix(r.URL.Path, "/thumbnail"):
			// Immich v3 leak: media served with key alone, no password check.
			mediaCalls++
			w.Header().Set("Content-Type", "image/jpeg")
			w.Write([]byte("jpeg-bytes"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	_, router := setupTestHandler(t, srv)

	// Without the password the proxy must block, even though upstream would
	// happily serve the thumbnail. Repeated requests hit the cached verdict.
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest("GET", "/api/share/leaky/asset/"+testAssetID1+"/thumbnail", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("request %d: expected 401 without password, got %d", i, rec.Code)
		}
	}
	if mediaCalls != 0 {
		t.Errorf("upstream media must never be fetched without authorization, got %d calls", mediaCalls)
	}
	if linkCalls != 1 {
		t.Errorf("expected 1 authorization lookup (verdict cached), got %d", linkCalls)
	}

	// With the correct signed password cookie the thumbnail flows through.
	linkCalls = 0
	req := httptest.NewRequest("GET", "/api/share/leaky/asset/"+testAssetID1+"/thumbnail", nil)
	req.AddCookie(&http.Cookie{
		Name:  "immich-share-password",
		Value: sharecookie.Sign(middleware.CookieSecret, password),
	})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with valid password cookie, got %d: %s", rec.Code, rec.Body.String())
	}
	if mediaCalls != 1 {
		t.Errorf("expected upstream media fetch after authorization, got %d", mediaCalls)
	}
}

// TestGetThumbnailExt_ExtensionIsAdvisory pins the CDN-friendly extensioned
// route: /thumbnail.webp and /thumbnail.jpg must be byte- and header-identical
// to the underlying GetThumbnail handler (the extension only exists so
// Cloudflare's default extension-based cache list makes the URL
// edge-cacheable). The extensionless ROUTE was removed from the router in
// this version — the test router keeps a direct handler seam as the baseline.
func TestGetThumbnailExt_ExtensionIsAdvisory(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandlerWithOptions(t, mockServer, config.OptionsConfig{
		AllowDownload:      true,
		ShowMetadata:       true,
		ShareMediaCacheTTL: 3600,
	})

	get := func(t *testing.T, path string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("GET", path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	baseline := get(t, "/api/share/valid-key/asset/"+testAssetID1+"/thumbnail?size=thumbnail")
	if baseline.Code != http.StatusOK {
		t.Fatalf("baseline handler: expected 200, got %d", baseline.Code)
	}

	for _, ext := range []string{"webp", "jpg"} {
		t.Run(ext, func(t *testing.T) {
			rec := get(t, "/api/share/valid-key/asset/"+testAssetID1+"/thumbnail."+ext+"?size=thumbnail")
			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d", rec.Code)
			}
			if got, want := rec.Body.String(), baseline.Body.String(); got != want {
				t.Errorf("body differs from baseline handler: got %q, want %q", got, want)
			}
			// Content-Type comes from Immich's response, never from the
			// extension: the extension is advisory for CDNs, the header wins.
			if got, want := rec.Header().Get("Content-Type"), baseline.Header().Get("Content-Type"); got != want {
				t.Errorf("Content-Type differs from baseline handler: got %q, want %q", got, want)
			}
			if got, want := rec.Header().Get("Cache-Control"), baseline.Header().Get("Cache-Control"); got != want {
				t.Errorf("Cache-Control differs from baseline handler: got %q, want %q", got, want)
			}
		})
	}
}

// TestGetThumbnailExt_InvalidExtension rejects extensions the proxy never
// serves. Notably .heic must 404: iPhone originals are HEIC, and advertising
// that extension would both lie about the payload and fall outside
// Cloudflare's default cacheable-extension list.
func TestGetThumbnailExt_InvalidExtension(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	for _, ext := range []string{"heic", "png", "exe", "jpeg", "webp2"} {
		req := httptest.NewRequest("GET", "/api/share/valid-key/asset/"+testAssetID1+"/thumbnail."+ext, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("thumbnail.%s: expected 404, got %d", ext, rec.Code)
		}
	}
}

// TestGetThumbnailExt_PasswordProtected mirrors the legacy-route auth tests on
// the extensioned route: no password → 401, valid signed password cookie →
// 200 with the private (browser-only) cache header. The extension changes CDN
// cache *eligibility*, never the Cache-Control *directives*, so protected
// thumbnails stay out of shared caches.
func TestGetThumbnailExt_PasswordProtected(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandlerWithOptions(t, mockServer, config.OptionsConfig{
		AllowDownload:          true,
		ShowMetadata:           true,
		ProtectedMediaCacheTTL: 1800,
	})

	t.Run("blocked without password", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/share/password-protected/asset/"+testAssetID1+"/thumbnail.webp", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 without password, got %d", rec.Code)
		}
	})

	t.Run("served privately with password", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/share/password-protected/asset/"+testAssetID1+"/thumbnail.webp", nil)
		req.AddCookie(&http.Cookie{
			Name:  "immich-share-password",
			Value: sharecookie.Sign(middleware.CookieSecret, "secret123"),
		})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 with password cookie, got %d: %s", rec.Code, rec.Body.String())
		}
		cc := rec.Header().Get("Cache-Control")
		if cc != "private, max-age=1800" {
			t.Errorf("expected private browser cache, got %q", cc)
		}
		if strings.Contains(cc, "public") {
			t.Error("protected thumbnail must never be publicly cacheable")
		}
	})
}

// TestGetThumbnail_PublicShareCacheHeaders covers the CDN caching model: with
// ShareMediaCacheTTL set, a public share's thumbnail is publicly cacheable so
// a CDN (Cloudflare) spares Immich the repeat traffic; a password-protected
// share's thumbnail must stay no-store or the CDN would serve it without the
// password.
func TestGetThumbnail_PublicShareCacheHeaders(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()
	_, router := setupTestHandlerWithOptions(t, mockServer, config.OptionsConfig{
		AllowDownload:      true,
		ShowMetadata:       true,
		ShareMediaCacheTTL: 3600,
	})

	t.Run("public share is publicly cacheable", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/share/valid-key/asset/"+testAssetID1+"/thumbnail", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		cc := rec.Header().Get("Cache-Control")
		if cc != "public, max-age=3600" {
			t.Errorf("expected public cache header, got %q", cc)
		}
	})

	t.Run("password-protected share is never publicly cached", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/share/password-protected/asset/"+testAssetID1+"/thumbnail", nil)
		req.AddCookie(&http.Cookie{
			Name:  "immich-share-password",
			Value: sharecookie.Sign(middleware.CookieSecret, "secret123"),
		})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 with password cookie, got %d: %s", rec.Code, rec.Body.String())
		}
		cc := rec.Header().Get("Cache-Control")
		if !strings.Contains(cc, "no-store") {
			t.Errorf("protected thumbnail must not be publicly cacheable, got %q", cc)
		}
	})
}

// TestGetThumbnail_ProtectedShareBrowserCache covers option-1 caching: with
// ProtectedMediaCacheTTL set, a password-protected share's thumbnail is
// marked private (the authenticated visitor's browser may cache it) but never
// public (shared caches / CDNs must not, or they'd serve it without the
// password).
func TestGetThumbnail_ProtectedShareBrowserCache(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()
	_, router := setupTestHandlerWithOptions(t, mockServer, config.OptionsConfig{
		AllowDownload:          true,
		ShowMetadata:           true,
		ProtectedMediaCacheTTL: 1800,
	})

	req := httptest.NewRequest("GET", "/api/share/password-protected/asset/"+testAssetID1+"/thumbnail", nil)
	req.AddCookie(&http.Cookie{
		Name:  "immich-share-password",
		Value: sharecookie.Sign(middleware.CookieSecret, "secret123"),
	})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	cc := rec.Header().Get("Cache-Control")
	if cc != "private, max-age=1800" {
		t.Errorf("expected private browser cache, got %q", cc)
	}
	if strings.Contains(cc, "public") {
		t.Error("protected thumbnail must never be publicly cacheable")
	}
}
