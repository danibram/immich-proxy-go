package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/danibram/immich-proxy-go/internal/config"
	"go.uber.org/zap"
)

func TestInjectPostHogConfig(t *testing.T) {
	html := "<!DOCTYPE html><html><head><title>x</title></head><body></body></html>"

	cfg := config.PostHogConfig{
		Enabled:                 true,
		APIKey:                  "phc_test",
		Host:                    "https://eu.i.posthog.com",
		DisableSessionRecording: true,
		Autocapture:             false,
	}
	enabled := injectPostHogConfig(html, cfg)
	for _, want := range []string{
		`<meta name="ipp-posthog-enabled" content="true">`,
		`<meta name="ipp-posthog-api-key" content="phc_test">`,
		`<meta name="ipp-posthog-host" content="https://eu.i.posthog.com">`,
		`<meta name="ipp-posthog-disable-session-recording" content="true">`,
		`<meta name="ipp-posthog-autocapture" content="false">`,
	} {
		if !strings.Contains(enabled, want) {
			t.Fatalf("enabled injection missing %q in:\n%s", want, enabled)
		}
	}

	disabled := injectPostHogConfig(html, config.PostHogConfig{Enabled: false})
	if !strings.Contains(disabled, `<meta name="ipp-posthog-enabled" content="false">`) {
		t.Fatalf("disabled injection missing: %s", disabled)
	}
}

func TestInjectPostHogConfigEscapesHTML(t *testing.T) {
	html := "<!DOCTYPE html><html><head></head><body></body></html>"
	cfg := config.PostHogConfig{
		Enabled: true,
		APIKey:  `phc_"<&>`,
		Host:    "https://eu.i.posthog.com",
	}
	out := injectPostHogConfig(html, cfg)
	if strings.Contains(out, `content="phc_"<&>"`) {
		t.Fatalf("api key must be HTML-escaped: %s", out)
	}
	if !strings.Contains(out, `content="phc_&#34;&lt;&amp;&gt;"`) {
		t.Fatalf("expected escaped api key in: %s", out)
	}
}

func TestInjectPostHogConfigDefaultHost(t *testing.T) {
	html := "<!DOCTYPE html><html><head></head><body></body></html>"
	out := injectPostHogConfig(html, config.PostHogConfig{})
	if !strings.Contains(out, `<meta name="ipp-posthog-host" content="https://us.i.posthog.com">`) {
		t.Fatalf("expected default host: %s", out)
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

	handler := NewStaticHandler(dir, nil, config.PostHogConfig{}, 0, zap.NewNop())
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
