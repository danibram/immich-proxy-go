package config

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/spf13/viper"
)

// DefaultPostHogHost is the ingest URL used when host is omitted in config.yaml.
const DefaultPostHogHost = "https://us.i.posthog.com"

// PostHogCSP holds PostHog-related CSP allowlist origins (no credentials).
type PostHogCSP struct {
	Active      bool
	APIOrigin   string
	AssetsOrigin string
}

// Active reports whether PostHog should run (enabled with a non-empty API key).
func (p PostHogConfig) Active() bool {
	return p.Enabled && strings.TrimSpace(p.APIKey) != ""
}

// Normalize fills in default host when empty.
func (p *PostHogConfig) Normalize() {
	if strings.TrimSpace(p.Host) == "" {
		p.Host = DefaultPostHogHost
	}
}

// Origins returns CSP-safe API and assets origins for the configured host.
// Cloud hosts use the *-assets.i.posthog.com pattern; other hosts use the API origin for both.
func (p PostHogConfig) Origins() (api, assets string) {
	host := strings.TrimSpace(p.Host)
	if host == "" {
		host = DefaultPostHogHost
	}
	u, err := url.Parse(host)
	if err != nil || u.Host == "" {
		return DefaultPostHogHost, defaultPostHogAssetsOrigin()
	}
	api = strings.TrimSuffix(u.Scheme+"://"+u.Host, "/")
	if strings.HasSuffix(u.Host, ".i.posthog.com") {
		region := strings.TrimSuffix(u.Host, ".i.posthog.com")
		assets = fmt.Sprintf("%s://%s-assets.i.posthog.com", u.Scheme, region)
		return api, assets
	}
	return api, api
}

// CSPDirective builds CSP allowlist data for security middleware.
func (p PostHogConfig) CSPDirective() PostHogCSP {
	p.Normalize()
	api, assets := p.Origins()
	return PostHogCSP{
		Active:       p.Active(),
		APIOrigin:    api,
		AssetsOrigin: assets,
	}
}

func defaultPostHogAssetsOrigin() string {
	_, assets := PostHogConfig{Host: DefaultPostHogHost}.Origins()
	return assets
}

func setPostHogViperDefaults(v *viper.Viper) {
	v.SetDefault("analytics.posthog.enabled", false)
	v.SetDefault("analytics.posthog.api_key", "")
	v.SetDefault("analytics.posthog.host", DefaultPostHogHost)
	v.SetDefault("analytics.posthog.disable_session_recording", true)
	v.SetDefault("analytics.posthog.autocapture", false)
}

func defaultPostHogConfig() PostHogConfig {
	return PostHogConfig{
		Enabled:                 false,
		APIKey:                  "",
		Host:                    DefaultPostHogHost,
		DisableSessionRecording: true,
		Autocapture:             false,
	}
}
