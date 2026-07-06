package handlers

import (
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
