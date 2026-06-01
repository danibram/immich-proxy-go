package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"
)

func TestInjectPostHogFlag(t *testing.T) {
	html := "<!DOCTYPE html><html><head><title>x</title></head><body></body></html>"

	enabled := injectPostHogFlag(html, true)
	if !strings.Contains(enabled, `<meta name="ipp-posthog-enabled" content="true">`) {
		t.Fatalf("enabled injection missing: %s", enabled)
	}

	disabled := injectPostHogFlag(html, false)
	if !strings.Contains(disabled, `<meta name="ipp-posthog-enabled" content="false">`) {
		t.Fatalf("disabled injection missing: %s", disabled)
	}
}

func TestStaticHandlerDisablesCacheWhenTTLIsZero(t *testing.T) {
	dir := t.TempDir()
	assetsDir := filepath.Join(dir, "assets")
	if err := os.Mkdir(assetsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetsDir, "app.js"), []byte("console.log('ok')"), 0o644); err != nil {
		t.Fatal(err)
	}

	handler := NewStaticHandler(dir, nil, false, 0, zap.NewNop())
	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); !strings.Contains(got, "no-store") {
		t.Fatalf("expected no-store cache header, got %q", got)
	}
}
