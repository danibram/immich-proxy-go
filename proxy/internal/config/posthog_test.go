package config

import "testing"

func TestPostHogConfig_Active(t *testing.T) {
	if (PostHogConfig{Enabled: true}).Active() {
		t.Fatal("expected inactive without api key")
	}
	if !(PostHogConfig{Enabled: true, APIKey: "phc_x"}).Active() {
		t.Fatal("expected active with api key")
	}
	if (PostHogConfig{Enabled: false, APIKey: "phc_x"}).Active() {
		t.Fatal("expected inactive when disabled")
	}
}

func TestPostHogConfig_OriginsEU(t *testing.T) {
	api, assets := PostHogConfig{Host: "https://eu.i.posthog.com"}.Origins()
	if api != "https://eu.i.posthog.com" || assets != "https://eu-assets.i.posthog.com" {
		t.Fatalf("got api=%s assets=%s", api, assets)
	}
}

func TestPostHogConfig_CSPDirectiveInactive(t *testing.T) {
	csp := PostHogConfig{Enabled: true}.CSPDirective()
	if csp.Active {
		t.Fatal("expected inactive CSP when api key missing")
	}
}

func TestPostHogConfig_CSPDirectiveActive(t *testing.T) {
	csp := PostHogConfig{
		Enabled: true,
		APIKey:  "phc_x",
		Host:    "https://eu.i.posthog.com",
	}.CSPDirective()
	if !csp.Active {
		t.Fatal("expected active")
	}
	if csp.APIOrigin != "https://eu.i.posthog.com" || csp.AssetsOrigin != "https://eu-assets.i.posthog.com" {
		t.Fatalf("unexpected origins: %+v", csp)
	}
}
