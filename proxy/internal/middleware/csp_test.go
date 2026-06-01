package middleware

import (
	"strings"
	"testing"

	"github.com/danibram/immich-proxy-go/internal/config"
)

func TestBuildContentSecurityPolicy_PostHogDisabled(t *testing.T) {
	csp := BuildContentSecurityPolicy(config.PostHogCSP{})
	if strings.Contains(csp, "posthog.com") {
		t.Fatalf("CSP must not allow PostHog when disabled: %s", csp)
	}
	if !strings.Contains(csp, "script-src 'self';") {
		t.Fatalf("expected strict script-src, got: %s", csp)
	}
}

func TestBuildContentSecurityPolicy_PostHogEU(t *testing.T) {
	csp := BuildContentSecurityPolicy(config.PostHogCSP{
		Active:       true,
		APIOrigin:    "https://eu.i.posthog.com",
		AssetsOrigin: "https://eu-assets.i.posthog.com",
	})
	for _, want := range []string{
		"https://eu.i.posthog.com",
		"https://eu-assets.i.posthog.com",
		"'unsafe-inline'",
	} {
		if !strings.Contains(csp, want) {
			t.Fatalf("CSP missing %q: %s", want, csp)
		}
	}
}

func TestBuildContentSecurityPolicy_EnabledWithoutKeyInactive(t *testing.T) {
	// CSP is built from PostHogCSP; callers must set Active via PostHogConfig.Active()
	csp := BuildContentSecurityPolicy(config.PostHogCSP{Active: false})
	if strings.Contains(csp, "posthog.com") {
		t.Fatalf("inactive CSP must not mention posthog: %s", csp)
	}
}
