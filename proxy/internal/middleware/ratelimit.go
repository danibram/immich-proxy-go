package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

// RateLimiter implements a simple in-memory rate limiter using token bucket algorithm
type RateLimiter struct {
	mu             sync.RWMutex
	visitors       map[string]*visitor
	rate           int           // requests per window
	window         time.Duration // time window
	logger         *zap.Logger
	trustProxyHdrs bool // if true, honor X-Forwarded-For / X-Real-IP
}

// TrustProxyHeaders controls whether getClientIP honors X-Forwarded-For /
// X-Real-IP. It is a package-level toggle because several middlewares (rate
// limit, future IP-based checks) share the same resolver. main.go is expected
// to set this once at startup based on security.trust_proxy_headers.
//
// Safe default: false. When false, only r.RemoteAddr is used, preventing
// malicious clients from spoofing an IP via headers and bypassing per-IP
// rate limits.
var TrustProxyHeaders bool

type visitor struct {
	tokens    int
	lastReset time.Time
}

// NewRateLimiter creates a new rate limiter
// rate: number of requests allowed per window
// window: time window duration
func NewRateLimiter(rate int, window time.Duration, logger *zap.Logger) *RateLimiter {
	rl := &RateLimiter{
		visitors: make(map[string]*visitor),
		rate:     rate,
		window:   window,
		logger:   logger,
	}

	// Start cleanup goroutine
	go rl.cleanup()

	return rl
}

// cleanup removes old entries periodically
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(rl.window * 2)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		for ip, v := range rl.visitors {
			if now.Sub(v.lastReset) > rl.window*2 {
				delete(rl.visitors, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// getVisitor returns the visitor for the given IP, creating one if necessary
func (rl *RateLimiter) getVisitor(ip string) *visitor {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	v, exists := rl.visitors[ip]
	if !exists {
		v = &visitor{
			tokens:    rl.rate,
			lastReset: time.Now(),
		}
		rl.visitors[ip] = v
	}

	// Reset tokens if window has passed
	if time.Since(v.lastReset) > rl.window {
		v.tokens = rl.rate
		v.lastReset = time.Now()
	}

	return v
}

// Allow checks if the request should be allowed
func (rl *RateLimiter) Allow(ip string) bool {
	v := rl.getVisitor(ip)

	rl.mu.Lock()
	defer rl.mu.Unlock()

	if v.tokens > 0 {
		v.tokens--
		return true
	}

	return false
}

// Limit returns a middleware that rate limits requests by IP
func (rl *RateLimiter) Limit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := getClientIP(r)

		if !rl.Allow(ip) {
			rl.logger.Warn("rate limit exceeded",
				zap.String("ip", ip),
				zap.String("path", r.URL.Path),
			)
			w.Header().Set("Retry-After", "60")
			http.Error(w, "Too many requests", http.StatusTooManyRequests)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// StrictLimit returns a middleware with stricter rate limiting (for sensitive endpoints)
func StrictRateLimit(rate int, window time.Duration, logger *zap.Logger) func(http.Handler) http.Handler {
	rl := NewRateLimiter(rate, window, logger)
	return rl.Limit
}

// getClientIP extracts the client IP from the request.
//
// SECURITY: X-Forwarded-For and X-Real-IP are only trusted when
// TrustProxyHeaders is true. Those headers can be trivially set by any HTTP
// client; if honored unconditionally they allow an attacker to rotate
// "identities" per request and bypass per-IP rate limits (including the
// password brute-force limiter). Only enable when the proxy sits behind a
// trusted reverse proxy that rewrites those headers.
func getClientIP(r *http.Request) string {
	if TrustProxyHeaders {
		// Check X-Forwarded-For header (may contain multiple IPs)
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			// Take the first IP (original client)
			for i := 0; i < len(xff); i++ {
				if xff[i] == ',' {
					return strings.TrimSpace(xff[:i])
				}
			}
			return strings.TrimSpace(xff)
		}

		// Check X-Real-IP header
		if xri := r.Header.Get("X-Real-IP"); xri != "" {
			return strings.TrimSpace(xri)
		}
	}

	// Fall back to RemoteAddr
	// RemoteAddr is in the format "IP:port", so we need to extract just the IP.
	// IPv6 addresses are wrapped in brackets: "[::1]:12345".
	ip := r.RemoteAddr
	if len(ip) == 0 {
		return ""
	}
	if ip[0] == '[' {
		if end := strings.LastIndex(ip, "]"); end != -1 {
			return ip[1:end]
		}
	}
	for i := len(ip) - 1; i >= 0; i-- {
		if ip[i] == ':' {
			return ip[:i]
		}
	}

	return ip
}
