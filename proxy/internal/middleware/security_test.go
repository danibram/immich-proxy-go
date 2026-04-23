package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSecurityHeaders(t *testing.T) {
	// Create a simple handler to wrap
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Create test request
	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()

	// Execute
	handler.ServeHTTP(rec, req)

	// Verify status code
	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}

	// Test all security headers are set
	tests := []struct {
		header   string
		expected string
	}{
		{"X-Content-Type-Options", "nosniff"},
		{"X-Frame-Options", "DENY"},
		{"X-XSS-Protection", "1; mode=block"},
		{"Referrer-Policy", "strict-origin-when-cross-origin"},
		{"Permissions-Policy", "geolocation=(), microphone=(), camera=()"},
	}

	for _, tt := range tests {
		t.Run(tt.header, func(t *testing.T) {
			got := rec.Header().Get(tt.header)
			if got != tt.expected {
				t.Errorf("header %s: expected '%s', got '%s'", tt.header, tt.expected, got)
			}
		})
	}

	// Test CSP is set (just check it exists and has key directives)
	csp := rec.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Error("expected Content-Security-Policy header to be set")
	}

	// Verify CSP contains important directives
	cspDirectives := []string{
		"default-src 'self'",
		"script-src 'self'",
		"frame-ancestors 'none'",
	}
	for _, directive := range cspDirectives {
		if !containsString(csp, directive) {
			t.Errorf("CSP should contain '%s', got: %s", directive, csp)
		}
	}
}

func TestSecurityHeadersWithConfig_HSTS(t *testing.T) {
	// Test with HSTS enabled
	cfg := SecureHeadersConfig{
		EnableHSTS: true,
		HSTSMaxAge: 31536000,
	}

	handler := SecurityHeadersWithConfig(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	// Verify HSTS header is set
	hsts := rec.Header().Get("Strict-Transport-Security")
	if hsts == "" {
		t.Error("expected Strict-Transport-Security header to be set when HSTS is enabled")
	}

	if !containsString(hsts, "max-age=31536000") {
		t.Errorf("HSTS should contain max-age, got: %s", hsts)
	}
}

func TestSecurityHeadersWithConfig_NoHSTS(t *testing.T) {
	// Test with HSTS disabled
	cfg := SecureHeadersConfig{
		EnableHSTS: false,
	}

	handler := SecurityHeadersWithConfig(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	// Verify HSTS header is NOT set
	hsts := rec.Header().Get("Strict-Transport-Security")
	if hsts != "" {
		t.Errorf("expected no Strict-Transport-Security header when HSTS is disabled, got: %s", hsts)
	}
}

func TestSecurityHeaders_DoesNotBlockRequest(t *testing.T) {
	// Verify the middleware doesn't block or modify the request
	var receivedRequest bool

	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedRequest = true
		w.Write([]byte("OK"))
	}))

	req := httptest.NewRequest("POST", "/test", nil)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !receivedRequest {
		t.Error("request should have been passed to the handler")
	}

	if rec.Body.String() != "OK" {
		t.Errorf("expected body 'OK', got '%s'", rec.Body.String())
	}
}

// Helper function to check if a string contains a substring
func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstring(s, substr))
}

func containsSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
