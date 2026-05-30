package handlers

import (
	"strings"
	"testing"
)

func TestInjectPostHogFlag(t *testing.T) {
	html := "<!DOCTYPE html><html><head><title>x</title></head><body></body></html>"

	enabled := injectPostHogFlag(html, true)
	if !strings.Contains(enabled, `window.__IPP_POSTHOG_ENABLED__=true`) {
		t.Fatalf("enabled injection missing: %s", enabled)
	}

	disabled := injectPostHogFlag(html, false)
	if !strings.Contains(disabled, `window.__IPP_POSTHOG_ENABLED__=false`) {
		t.Fatalf("disabled injection missing: %s", disabled)
	}
}
