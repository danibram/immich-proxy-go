package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestShareIndexHead_PublicShareEmitsOpenGraph verifies a public share's shell
// is enriched with OpenGraph/Twitter meta (album name + cover), so links
// unfurl in chat apps. The cover URL is the share's /raw endpoint (the former
// /og-cover endpoint was merged into it).
func TestShareIndexHead_PublicShareEmitsOpenGraph(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()
	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/valid-key/og-head", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	body := rec.Body.String()
	for _, want := range []string{
		`property="og:title" content="Test Album"`,
		`property="og:type" content="website"`,
		`property="og:image"`,
		`/raw`,
		`name="twitter:card" content="summary_large_image"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("expected OG head to contain %q, got:\n%s", want, body)
		}
	}
	if strings.Contains(body, "og-cover") {
		t.Errorf("og:image must point at /raw, not the removed /og-cover, got:\n%s", body)
	}
}

// TestShareIndexHead_PasswordProtectedLeaksNothing is the security-critical
// case: an unfurl bot (no password cookie) must not learn a protected album's
// name or cover from its URL.
func TestShareIndexHead_PasswordProtectedLeaksNothing(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()
	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/password-protected/og-head", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	body := rec.Body.String()
	if strings.TrimSpace(body) != "" {
		t.Errorf("password-protected share must emit no OG meta, got:\n%s", body)
	}
	if strings.Contains(body, "Protected Album") {
		t.Error("protected album name leaked into OG meta")
	}
}

// TestServeSingleImage_AlbumCover covers the album-cover resolution of /raw
// (formerly /og-cover): a public ALBUM share serves its cover thumbnail with
// a public cache header for unfurl services; a password-protected one refuses
// without leaking bytes.
func TestServeSingleImage_AlbumCover(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()
	_, router := setupTestHandler(t, mockServer)

	t.Run("public album share serves the cover", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/share/valid-key/raw", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "image/") {
			t.Errorf("expected an image content-type, got %q", ct)
		}
		// Historical /og-cover default: a public share's cover may be cached
		// by unfurl services / CDNs even without a configured media TTL.
		if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=3600" {
			t.Errorf("expected public cover cache header, got %q", cc)
		}
	})

	t.Run("password-protected share refuses without auth", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/share/password-protected/raw", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 for protected share cover, got %d", rec.Code)
		}
		if strings.HasPrefix(rec.Header().Get("Content-Type"), "image/") {
			t.Error("protected share cover must not serve image bytes without auth")
		}
	})
}
