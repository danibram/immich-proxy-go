package config

import (
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Immich    ImmichConfig    `mapstructure:"immich"`
	Proxy     ProxyConfig     `mapstructure:"proxy"`
	Options   OptionsConfig   `mapstructure:"options"`
	Security  SecurityConfig  `mapstructure:"security"`
	Analytics AnalyticsConfig `mapstructure:"analytics"`
}

type ImmichConfig struct {
	URL string `mapstructure:"url"`
}

type ProxyConfig struct {
	Port      int    `mapstructure:"port"`
	PublicURL string `mapstructure:"public_url"`
}

type OptionsConfig struct {
	AllowDownload bool `mapstructure:"allow_download"`
	ShowMetadata  bool `mapstructure:"show_metadata"`
	CacheTTL      int  `mapstructure:"cache_ttl"`
}

type SecurityConfig struct {
	// RateLimit is the number of requests per minute for general endpoints
	RateLimit int `mapstructure:"rate_limit"`
	// PasswordRateLimit is the number of password attempts per minute
	PasswordRateLimit int `mapstructure:"password_rate_limit"`
	// MaxUploadSize is the maximum upload size in MB
	MaxUploadSize int64 `mapstructure:"max_upload_size"`
	// AllowedOrigins is a list of allowed CORS origins (empty = same origin only)
	AllowedOrigins []string `mapstructure:"allowed_origins"`
	// EnableHSTS enables HTTP Strict Transport Security header
	EnableHSTS bool `mapstructure:"enable_hsts"`
	// CookieSecret is used for signing cookies (auto-generated if empty)
	CookieSecret string `mapstructure:"cookie_secret"`
	// HotlinkProtection blocks direct URL access to images/videos (must be loaded via web app)
	HotlinkProtection bool `mapstructure:"hotlink_protection"`
	// TrustProxyHeaders enables trusting X-Forwarded-For / X-Real-IP /
	// X-Forwarded-Proto headers. MUST only be true when the proxy is run
	// behind a reverse proxy that sets / strips those headers, otherwise
	// clients can spoof their IP to bypass per-IP rate limits.
	TrustProxyHeaders bool `mapstructure:"trust_proxy_headers"`
	// ForceSecureCookies, when true, always marks auth cookies with the
	// Secure attribute regardless of the request scheme. Useful behind a
	// reverse proxy that terminates TLS.
	ForceSecureCookies bool `mapstructure:"force_secure_cookies"`
	// MaxConcurrentDownloadJobs caps simultaneous ZIP download jobs to
	// prevent disk-fill DoS. 0 disables the cap.
	MaxConcurrentDownloadJobs int `mapstructure:"max_concurrent_download_jobs"`
}

type AnalyticsConfig struct {
	PostHog PostHogConfig `mapstructure:"posthog"`
}

// PostHogConfig is injected into index.html at runtime when the proxy serves the SPA.
type PostHogConfig struct {
	Enabled                 bool   `mapstructure:"enabled"`
	APIKey                  string `mapstructure:"api_key"`
	Host                    string `mapstructure:"host"`
	DisableSessionRecording bool   `mapstructure:"disable_session_recording"`
	Autocapture             bool   `mapstructure:"autocapture"`
}

func Load(configPath string) (*Config, error) {
	v := viper.New()

	// Set defaults
	v.SetDefault("immich.url", "http://localhost:2283")
	v.SetDefault("proxy.port", 3000)
	v.SetDefault("proxy.public_url", "")
	v.SetDefault("options.allow_download", true)
	v.SetDefault("options.show_metadata", true)
	v.SetDefault("options.cache_ttl", 3600)

	// Security defaults
	v.SetDefault("security.rate_limit", 1000)          // 1000 requests per minute
	v.SetDefault("security.password_rate_limit", 5)    // 5 password attempts per minute
	v.SetDefault("security.max_upload_size", 100)      // 100 MB max upload
	v.SetDefault("security.allowed_origins", []string{}) // Empty = same origin only
	v.SetDefault("security.enable_hsts", false)
	v.SetDefault("security.cookie_secret", "")
	v.SetDefault("security.hotlink_protection", false)      // Disable by default for compatibility
	v.SetDefault("security.trust_proxy_headers", false)     // Safe default: don't trust spoofable headers
	v.SetDefault("security.force_secure_cookies", false)    // Opt-in for behind-TLS-proxy deployments
	v.SetDefault("security.max_concurrent_download_jobs", 5)

	v.SetDefault("analytics.posthog.enabled", false)
	v.SetDefault("analytics.posthog.api_key", "")
	v.SetDefault("analytics.posthog.host", "https://us.i.posthog.com")
	v.SetDefault("analytics.posthog.disable_session_recording", true)
	v.SetDefault("analytics.posthog.autocapture", false)

	// Environment variables
	v.SetEnvPrefix("IPP")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	// Also support legacy env vars
	v.BindEnv("immich.url", "IMMICH_URL")
	v.BindEnv("proxy.port", "IPP_PORT", "PORT")
	v.BindEnv("proxy.public_url", "PUBLIC_BASE_URL", "PUBLIC_URL")
	v.BindEnv("security.cookie_secret", "IPP_COOKIE_SECRET", "COOKIE_SECRET")

	// Config file
	if configPath != "" {
		v.SetConfigFile(configPath)
	} else {
		v.SetConfigName("config")
		v.SetConfigType("yaml")
		v.AddConfigPath(".")
		v.AddConfigPath("/app")
	}

	// Read config file (optional)
	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			// Only return error if it's not a "file not found" error
			// Config file is optional - env vars can be used instead
			return nil, err
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, err
	}

	// PostHog is config-file only (no IPP_ANALYTICS_POSTHOG_* env overrides).
	if err := applyAnalyticsFromConfigFile(&cfg, v); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func defaultAnalyticsConfig() AnalyticsConfig {
	return AnalyticsConfig{
		PostHog: PostHogConfig{
			Enabled:                 false,
			APIKey:                  "",
			Host:                    "https://us.i.posthog.com",
			DisableSessionRecording: true,
			Autocapture:             false,
		},
	}
}

func applyAnalyticsFromConfigFile(cfg *Config, v *viper.Viper) error {
	configFile := v.ConfigFileUsed()
	if configFile == "" {
		cfg.Analytics = defaultAnalyticsConfig()
		return nil
	}

	fv := viper.New()
	fv.SetConfigFile(configFile)
	fv.SetDefault("analytics.posthog.enabled", false)
	fv.SetDefault("analytics.posthog.api_key", "")
	fv.SetDefault("analytics.posthog.host", "https://us.i.posthog.com")
	fv.SetDefault("analytics.posthog.disable_session_recording", true)
	fv.SetDefault("analytics.posthog.autocapture", false)

	if err := fv.ReadInConfig(); err != nil {
		return err
	}

	var section struct {
		Analytics AnalyticsConfig `mapstructure:"analytics"`
	}
	if err := fv.Unmarshal(&section); err != nil {
		return err
	}

	cfg.Analytics = section.Analytics
	if cfg.Analytics.PostHog.Host == "" {
		cfg.Analytics.PostHog.Host = "https://us.i.posthog.com"
	}
	return nil
}
