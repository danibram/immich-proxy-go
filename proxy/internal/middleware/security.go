package middleware

import (
	"fmt"
	"net/http"

	"github.com/danibram/immich-proxy-go/internal/config"
)

// SecurityHeaders adds security headers to all responses
func SecurityHeaders(next http.Handler) http.Handler {
	return SecurityHeadersWithConfig(SecureHeadersConfig{})(next)
}

// SecureHeadersConfig allows configuring security headers
type SecureHeadersConfig struct {
	EnableHSTS bool
	HSTSMaxAge int
	PostHog    config.PostHogCSP
}

// SecurityHeadersWithConfig creates a security headers middleware with custom config
func SecurityHeadersWithConfig(cfg SecureHeadersConfig) func(http.Handler) http.Handler {
	csp := BuildContentSecurityPolicy(cfg.PostHog)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("X-XSS-Protection", "1; mode=block")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
			w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
			w.Header().Set("Content-Security-Policy", csp)

			if cfg.EnableHSTS {
				maxAge := cfg.HSTSMaxAge
				if maxAge == 0 {
					maxAge = 31536000
				}
				w.Header().Set("Strict-Transport-Security",
					fmt.Sprintf("max-age=%d; includeSubDomains", maxAge))
			}

			next.ServeHTTP(w, r)
		})
	}
}

// BuildContentSecurityPolicy returns the CSP header value.
// When PostHog is active, script-src includes 'unsafe-inline' (required by posthog-js).
func BuildContentSecurityPolicy(posthog config.PostHogCSP) string {
	scriptSrc := "'self'"
	connectSrc := "'self'"
	imgSrc := "'self' data: blob:"

	if posthog.Active {
		scriptSrc = fmt.Sprintf("'self' %s %s 'unsafe-inline'", posthog.APIOrigin, posthog.AssetsOrigin)
		connectSrc = fmt.Sprintf("'self' %s %s", posthog.APIOrigin, posthog.AssetsOrigin)
		imgSrc = fmt.Sprintf("'self' data: blob: %s %s", posthog.APIOrigin, posthog.AssetsOrigin)
	}

	return fmt.Sprintf(
		"default-src 'self'; "+
			"script-src %s; "+
			"style-src 'self' 'unsafe-inline'; "+
			"img-src %s; "+
			"media-src 'self' blob:; "+
			"font-src 'self'; "+
			"connect-src %s; "+
			"frame-ancestors 'none'; "+
			"base-uri 'self'; "+
			"form-action 'self'",
		scriptSrc, imgSrc, connectSrc,
	)
}
