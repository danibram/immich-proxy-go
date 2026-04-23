package middleware

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"
)

func TestRateLimiter_AllowsRequestsUnderLimit(t *testing.T) {
	logger := zap.NewNop()
	rl := NewRateLimiter(10, time.Minute, logger)

	// Make 10 requests - all should be allowed
	for i := 0; i < 10; i++ {
		if !rl.Allow("192.168.1.1") {
			t.Errorf("request %d should have been allowed", i+1)
		}
	}
}

func TestRateLimiter_BlocksRequestsOverLimit(t *testing.T) {
	logger := zap.NewNop()
	rl := NewRateLimiter(5, time.Minute, logger)

	// Make 5 requests - all should be allowed
	for i := 0; i < 5; i++ {
		if !rl.Allow("192.168.1.1") {
			t.Errorf("request %d should have been allowed", i+1)
		}
	}

	// 6th request should be blocked
	if rl.Allow("192.168.1.1") {
		t.Error("6th request should have been blocked")
	}
}

func TestRateLimiter_DifferentIPsHaveSeparateLimits(t *testing.T) {
	logger := zap.NewNop()
	rl := NewRateLimiter(2, time.Minute, logger)

	// IP1: use up all tokens
	rl.Allow("192.168.1.1")
	rl.Allow("192.168.1.1")

	// IP1 should be blocked
	if rl.Allow("192.168.1.1") {
		t.Error("IP1 should be blocked after limit")
	}

	// IP2 should still be allowed
	if !rl.Allow("192.168.1.2") {
		t.Error("IP2 should be allowed (different IP)")
	}
}

func TestRateLimiter_ResetsAfterWindow(t *testing.T) {
	logger := zap.NewNop()
	// Use a very short window for testing
	rl := NewRateLimiter(2, 100*time.Millisecond, logger)

	// Use up all tokens
	rl.Allow("192.168.1.1")
	rl.Allow("192.168.1.1")

	// Should be blocked
	if rl.Allow("192.168.1.1") {
		t.Error("should be blocked after limit")
	}

	// Wait for window to reset
	time.Sleep(150 * time.Millisecond)

	// Should be allowed again
	if !rl.Allow("192.168.1.1") {
		t.Error("should be allowed after window reset")
	}
}

func TestRateLimiter_Middleware(t *testing.T) {
	logger := zap.NewNop()
	rl := NewRateLimiter(2, time.Minute, logger)

	handler := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))

	// First 2 requests should succeed
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("GET", "/test", nil)
		req.RemoteAddr = "192.168.1.1:12345"
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("request %d: expected status 200, got %d", i+1, rec.Code)
		}
	}

	// 3rd request should be rate limited
	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "192.168.1.1:12345"
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("expected status 429, got %d", rec.Code)
	}

	// Check Retry-After header
	if rec.Header().Get("Retry-After") == "" {
		t.Error("expected Retry-After header to be set")
	}
}

func TestRateLimiter_XForwardedFor(t *testing.T) {
	logger := zap.NewNop()
	rl := NewRateLimiter(2, time.Minute, logger)

	// These cases exercise behaviour BEHIND a trusted reverse proxy, so
	// the operator has opted in to trusting these headers.
	TrustProxyHeaders = true
	defer func() { TrustProxyHeaders = false }()

	handler := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Use X-Forwarded-For header
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("X-Forwarded-For", "10.0.0.1, 192.168.1.1")
		req.RemoteAddr = "127.0.0.1:12345" // This should be ignored
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("request %d: expected status 200, got %d", i+1, rec.Code)
		}
	}

	// 3rd request with same X-Forwarded-For should be blocked
	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Forwarded-For", "10.0.0.1, 192.168.1.1")
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("expected status 429 for X-Forwarded-For IP, got %d", rec.Code)
	}
}

func TestRateLimiter_XRealIP(t *testing.T) {
	logger := zap.NewNop()
	rl := NewRateLimiter(1, time.Minute, logger)

	TrustProxyHeaders = true
	defer func() { TrustProxyHeaders = false }()

	handler := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// First request
	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Real-IP", "10.0.0.1")
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}

	// 2nd request should be blocked
	req = httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Real-IP", "10.0.0.1")
	req.RemoteAddr = "127.0.0.1:12345"
	rec = httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("expected status 429 for X-Real-IP, got %d", rec.Code)
	}
}

func TestRateLimiter_ConcurrentAccess(t *testing.T) {
	logger := zap.NewNop()
	rl := NewRateLimiter(100, time.Minute, logger)

	var wg sync.WaitGroup
	allowed := make(chan bool, 200)

	// Launch 200 concurrent requests from 2 IPs
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ip := "192.168.1.1"
			if i%2 == 0 {
				ip = "192.168.1.2"
			}
			allowed <- rl.Allow(ip)
		}(i)
	}

	wg.Wait()
	close(allowed)

	// Count allowed requests
	count := 0
	for a := range allowed {
		if a {
			count++
		}
	}

	// Should allow exactly 200 requests (100 per IP)
	if count != 200 {
		t.Errorf("expected 200 allowed requests, got %d", count)
	}
}

func TestGetClientIP(t *testing.T) {
	tests := []struct {
		name        string
		xff         string
		xri         string
		remoteAddr  string
		trustProxy  bool
		expected    string
	}{
		// With trust_proxy_headers enabled, X-Forwarded-For and
		// X-Real-IP are honored.
		{
			name:       "X-Forwarded-For single IP (trusted)",
			xff:        "10.0.0.1",
			remoteAddr: "127.0.0.1:12345",
			trustProxy: true,
			expected:   "10.0.0.1",
		},
		{
			name:       "X-Forwarded-For multiple IPs (trusted)",
			xff:        "10.0.0.1, 192.168.1.1, 172.16.0.1",
			remoteAddr: "127.0.0.1:12345",
			trustProxy: true,
			expected:   "10.0.0.1",
		},
		{
			name:       "X-Real-IP takes precedence over RemoteAddr (trusted)",
			xri:        "10.0.0.2",
			remoteAddr: "127.0.0.1:12345",
			trustProxy: true,
			expected:   "10.0.0.2",
		},
		{
			name:       "X-Forwarded-For takes precedence over X-Real-IP (trusted)",
			xff:        "10.0.0.1",
			xri:        "10.0.0.2",
			remoteAddr: "127.0.0.1:12345",
			trustProxy: true,
			expected:   "10.0.0.1",
		},
		// With trust_proxy_headers disabled (default, safest), those
		// headers are IGNORED and RemoteAddr is used. This is the
		// security-critical behaviour: a client cannot spoof its IP
		// via X-Forwarded-For to bypass rate limits.
		{
			name:       "X-Forwarded-For is IGNORED when trust_proxy_headers is off",
			xff:        "10.0.0.1",
			remoteAddr: "127.0.0.1:12345",
			trustProxy: false,
			expected:   "127.0.0.1",
		},
		{
			name:       "X-Real-IP is IGNORED when trust_proxy_headers is off",
			xri:        "10.0.0.2",
			remoteAddr: "127.0.0.1:12345",
			trustProxy: false,
			expected:   "127.0.0.1",
		},
		{
			name:       "RemoteAddr fallback",
			remoteAddr: "192.168.1.1:12345",
			expected:   "192.168.1.1",
		},
		{
			name:       "RemoteAddr without port",
			remoteAddr: "192.168.1.1",
			expected:   "192.168.1.1",
		},
		{
			name:       "RemoteAddr IPv6 with port",
			remoteAddr: "[::1]:12345",
			expected:   "::1",
		},
	}

	// Reset flag at end of test.
	defer func() { TrustProxyHeaders = false }()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			TrustProxyHeaders = tt.trustProxy
			req := httptest.NewRequest("GET", "/test", nil)
			if tt.xff != "" {
				req.Header.Set("X-Forwarded-For", tt.xff)
			}
			if tt.xri != "" {
				req.Header.Set("X-Real-IP", tt.xri)
			}
			req.RemoteAddr = tt.remoteAddr

			got := getClientIP(req)
			if got != tt.expected {
				t.Errorf("expected '%s', got '%s'", tt.expected, got)
			}
		})
	}
}

// TestRateLimiter_XForwardedForCannotBypassLimitByDefault is the core
// security guarantee of the getClientIP change: when trust_proxy_headers
// is disabled (the safe default), an attacker setting a different
// X-Forwarded-For on each request MUST NOT bypass the per-IP limiter.
//
// Before this fix, the password endpoint (5 attempts/min) could be
// brute-forced at thousands of attempts per second simply by rotating
// the X-Forwarded-For value.
func TestRateLimiter_XForwardedForCannotBypassLimitByDefault(t *testing.T) {
	TrustProxyHeaders = false // default / safe
	defer func() { TrustProxyHeaders = false }()

	logger := zap.NewNop()
	rl := NewRateLimiter(3, time.Minute, logger)

	handler := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Send 10 requests with different spoofed XFF values but the SAME
	// RemoteAddr. All should count against the same bucket because we
	// do not trust the header.
	allowed := 0
	for i := 0; i < 10; i++ {
		req := httptest.NewRequest("POST", "/validate-password", nil)
		req.RemoteAddr = "203.0.113.5:12345" // same attacker
		req.Header.Set("X-Forwarded-For", // rotating spoof
			[]string{"1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4", "5.5.5.5",
				"6.6.6.6", "7.7.7.7", "8.8.8.8", "9.9.9.9", "10.10.10.10"}[i])
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code == http.StatusOK {
			allowed++
		}
	}

	if allowed != 3 {
		t.Errorf("X-Forwarded-For spoofing bypassed the rate limit: %d/10 allowed, want 3", allowed)
	}
}

func TestStrictRateLimit(t *testing.T) {
	logger := zap.NewNop()

	// Create strict rate limiter (like for password endpoints)
	middleware := StrictRateLimit(3, time.Minute, logger)

	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// First 3 requests should succeed
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest("POST", "/validate-password", nil)
		req.RemoteAddr = "192.168.1.1:12345"
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("request %d: expected status 200, got %d", i+1, rec.Code)
		}
	}

	// 4th request should be rate limited
	req := httptest.NewRequest("POST", "/validate-password", nil)
	req.RemoteAddr = "192.168.1.1:12345"
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("expected status 429, got %d", rec.Code)
	}
}
