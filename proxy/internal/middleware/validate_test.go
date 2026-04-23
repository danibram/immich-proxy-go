package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsValidUUID(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		// Valid UUIDs
		{"valid UUID v4", "550e8400-e29b-41d4-a716-446655440000", true},
		{"valid UUID lowercase", "550e8400-e29b-41d4-a716-446655440000", true},
		{"valid UUID uppercase", "550E8400-E29B-41D4-A716-446655440000", true},
		{"valid UUID mixed case", "550e8400-E29B-41d4-A716-446655440000", true},
		{"all zeros", "00000000-0000-0000-0000-000000000000", true},
		{"all f's", "ffffffff-ffff-ffff-ffff-ffffffffffff", true},

		// Invalid UUIDs
		{"empty string", "", false},
		{"too short", "550e8400-e29b-41d4-a716", false},
		{"too long", "550e8400-e29b-41d4-a716-4466554400001", false},
		{"missing hyphens", "550e8400e29b41d4a716446655440000", false},
		{"wrong hyphen position", "550e840-0e29b-41d4-a716-446655440000", false},
		{"invalid characters", "550e8400-e29b-41d4-a716-44665544000g", false},
		{"spaces", "550e8400 e29b 41d4 a716 446655440000", false},
		{"simple string", "not-a-uuid", false},
		{"numeric", "12345678901234567890123456789012", false},
		{"sql injection attempt", "'; DROP TABLE users; --", false},
		{"path traversal attempt", "../../../etc/passwd", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsValidUUID(tt.input)
			if got != tt.expected {
				t.Errorf("IsValidUUID(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestIsValidShareKey(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		// Valid share keys
		{"simple alphanumeric", "abc123", true},
		{"with underscore", "share_key_123", true},
		{"with hyphen", "share-key-123", true},
		{"mixed", "Share_Key-123", true},
		{"single char", "a", true},
		{"100 chars", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", true},

		// Invalid share keys
		{"empty string", "", false},
		{"over 100 chars", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", false},
		{"with spaces", "share key", false},
		{"with special chars", "share@key", false},
		{"with dots", "share.key", false},
		{"sql injection", "'; DROP TABLE--", false},
		{"path traversal", "../../../etc", false},
		{"html injection", "<script>alert(1)</script>", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsValidShareKey(tt.input)
			if got != tt.expected {
				t.Errorf("IsValidShareKey(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestIsValidThumbnailSize(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		// Valid sizes
		{"empty (default)", "", true},
		{"thumbnail", "thumbnail", true},
		{"preview", "preview", true},

		// Invalid sizes
		{"original", "original", false},
		{"large", "large", false},
		{"small", "small", false},
		{"numeric", "100", false},
		{"with dimensions", "100x100", false},
		{"sql injection", "'; DROP TABLE--", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsValidThumbnailSize(tt.input)
			if got != tt.expected {
				t.Errorf("IsValidThumbnailSize(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestValidateShareKey_Middleware(t *testing.T) {
	tests := []struct {
		name           string
		shareKey       string
		expectedStatus int
	}{
		{"valid key", "valid-share-key", http.StatusOK},
		{"valid key with numbers", "share123", http.StatusOK},
		{"invalid key with spaces", "invalid key", http.StatusBadRequest},
		{"invalid key with special chars", "key@#$", http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create handler that returns 200 if it reaches
			handler := ValidateShareKey(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))

			req := httptest.NewRequest("GET", "/test", nil)
			// Set the share key in context using context.WithValue
			ctx := context.WithValue(req.Context(), ShareKeyContextKey, tt.shareKey)
			req = req.WithContext(ctx)

			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, rec.Code)
			}
		})
	}
}

func TestValidateShareKey_EmptyKey(t *testing.T) {
	// Empty key should pass validation (the ExtractShareKey middleware handles empty key rejection)
	handler := ValidateShareKey(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	// Should pass through since empty key is handled by ExtractShareKey
	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200 for empty key (handled elsewhere), got %d", rec.Code)
	}
}
