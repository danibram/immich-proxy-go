package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestShareIndexHead_PublicShareEmitsOpenGraph verifies a public share's shell
// is enriched with OpenGraph/Twitter meta (album name + cover), so links
// unfurl in chat apps.
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
		`/og-cover`,
		`name="twitter:card" content="summary_large_image"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("expected OG head to contain %q, got:\n%s", want, body)
		}
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

// TestServeOGImage covers the cover-image endpoint: served for a public share,
// 404 for a password-protected one.
func TestServeOGImage(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()
	_, router := setupTestHandler(t, mockServer)

	t.Run("public share serves the cover", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/share/valid-key/og-cover", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "image/") {
			t.Errorf("expected an image content-type, got %q", ct)
		}
	})

	t.Run("password-protected share 404s", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/share/password-protected/og-cover", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("expected 404 for protected share cover, got %d", rec.Code)
		}
	})
}
