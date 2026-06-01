package middleware

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danibram/immich-proxy-go/internal/sharecookie"
	"github.com/go-chi/chi/v5"
)

func TestExtractShareKey(t *testing.T) {
	// Set up cookie secret for tests
	CookieSecret = []byte("test-secret-key-12345")

	tests := []struct {
		name        string
		urlKey      string
		cookie      string
		header      string
		expectKey   string
		expectPass  string
		expectError bool
	}{
		{
			name:       "valid share key only",
			urlKey:     "abc123",
			expectKey:  "abc123",
			expectPass: "",
		},
		{
			// SECURITY: raw/unsigned cookie values must NEVER be used as
			// the password. Accepting them would allow an attacker with
			// just a share URL to set arbitrary cookie values and probe
			// passwords at the normal request-rate limit rather than the
			// strict password-endpoint limit.
			name:       "raw (unsigned) password cookie is rejected",
			urlKey:     "abc123",
			cookie:     "mysecret",
			expectKey:  "abc123",
			expectPass: "",
		},
		{
			name:       "share key with password header",
			urlKey:     "abc123",
			header:     "headerpassword",
			expectKey:  "abc123",
			expectPass: "headerpassword",
		},
		{
			name:       "header takes precedence over cookie",
			urlKey:     "abc123",
			cookie:     "cookiepassword",
			header:     "headerpassword",
			expectKey:  "abc123",
			expectPass: "headerpassword",
		},
		{
			name:        "missing share key",
			urlKey:      "",
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create router with middleware
			r := chi.NewRouter()
			r.Route("/share/{key}", func(r chi.Router) {
				r.Use(ExtractShareKey)
				r.Get("/", func(w http.ResponseWriter, r *http.Request) {
					key := GetShareKey(r.Context())
					password := GetPassword(r.Context())

					if key != tt.expectKey {
						t.Errorf("expected key '%s', got '%s'", tt.expectKey, key)
					}
					if password != tt.expectPass {
						t.Errorf("expected password '%s', got '%s'", tt.expectPass, password)
					}
					w.WriteHeader(http.StatusOK)
				})
			})

			url := "/share/" + tt.urlKey + "/"
			req := httptest.NewRequest("GET", url, nil)

			if tt.cookie != "" {
				req.AddCookie(&http.Cookie{Name: "immich-share-password", Value: tt.cookie})
			}
			if tt.header != "" {
				req.Header.Set("x-immich-share-password", tt.header)
			}

			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)

			if tt.expectError {
				if rec.Code == http.StatusOK {
					t.Error("expected error response, got 200")
				}
			} else {
				if rec.Code != http.StatusOK {
					t.Errorf("expected status 200, got %d", rec.Code)
				}
			}
		})
	}
}

func TestSignedCookie(t *testing.T) {
	CookieSecret = []byte("test-secret-key-12345")

	password := "mysecretpassword"
	signedValue := sharecookie.Sign(CookieSecret, password)

	// Test that the middleware correctly extracts the password
	r := chi.NewRouter()
	r.Route("/share/{key}", func(r chi.Router) {
		r.Use(ExtractShareKey)
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			extractedPassword := GetPassword(r.Context())
			if extractedPassword != password {
				t.Errorf("expected password '%s', got '%s'", password, extractedPassword)
			}
			w.WriteHeader(http.StatusOK)
		})
	})

	req := httptest.NewRequest("GET", "/share/testkey/", nil)
	req.AddCookie(&http.Cookie{Name: "immich-share-password", Value: signedValue})

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}
}

func TestInvalidSignedCookie(t *testing.T) {
	CookieSecret = []byte("test-secret-key-12345")

	// SECURITY: every invalid/forged cookie variant MUST resolve to an
	// empty password. The previous implementation fell back to the raw
	// cookie string which let any client seed arbitrary password attempts
	// at the per-request rate instead of the strict password-endpoint rate.
	tests := []struct {
		name           string
		cookieValue    string
		expectedResult string
	}{
		{
			name:           "invalid signature",
			cookieValue:    base64.URLEncoding.EncodeToString([]byte("password")) + "." + base64.URLEncoding.EncodeToString([]byte("invalidsig")),
			expectedResult: "",
		},
		{
			name:           "malformed - no dot",
			cookieValue:    "justplaintext",
			expectedResult: "",
		},
		{
			name:           "empty cookie",
			cookieValue:    "",
			expectedResult: "",
		},
		{
			name:           "invalid base64",
			cookieValue:    "not@valid@base64.alsonotvalid",
			expectedResult: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := chi.NewRouter()
			r.Route("/share/{key}", func(r chi.Router) {
				r.Use(ExtractShareKey)
				r.Get("/", func(w http.ResponseWriter, r *http.Request) {
					extractedPassword := GetPassword(r.Context())
					if extractedPassword != tt.expectedResult {
						t.Errorf("expected password '%s', got '%s'", tt.expectedResult, extractedPassword)
					}
					w.WriteHeader(http.StatusOK)
				})
			})

			req := httptest.NewRequest("GET", "/share/testkey/", nil)
			if tt.cookieValue != "" {
				req.AddCookie(&http.Cookie{Name: "immich-share-password", Value: tt.cookieValue})
			}

			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
		})
	}
}

func TestGetShareKey(t *testing.T) {
	// Test with key in context
	ctx := context.WithValue(context.Background(), ShareKeyContextKey, "testkey123")
	key := GetShareKey(ctx)
	if key != "testkey123" {
		t.Errorf("expected 'testkey123', got '%s'", key)
	}

	// Test with no key in context
	key = GetShareKey(context.Background())
	if key != "" {
		t.Errorf("expected empty string, got '%s'", key)
	}

	// Test with wrong type in context
	ctx = context.WithValue(context.Background(), ShareKeyContextKey, 12345)
	key = GetShareKey(ctx)
	if key != "" {
		t.Errorf("expected empty string for wrong type, got '%s'", key)
	}
}

func TestGetPassword(t *testing.T) {
	// Test with password in context
	ctx := context.WithValue(context.Background(), PasswordContextKey, "secretpass")
	pass := GetPassword(ctx)
	if pass != "secretpass" {
		t.Errorf("expected 'secretpass', got '%s'", pass)
	}

	// Test with no password in context
	pass = GetPassword(context.Background())
	if pass != "" {
		t.Errorf("expected empty string, got '%s'", pass)
	}
}

func TestVerifySignedCookie(t *testing.T) {
	secret := []byte("test-secret-key-12345")
	password := "testpassword"
	validSignedValue := sharecookie.Sign(secret, password)

	tests := []struct {
		name          string
		signedValue   string
		expectedValue string
	}{
		{
			name:          "valid signed cookie",
			signedValue:   validSignedValue,
			expectedValue: password,
		},
		{
			name:          "no separator",
			signedValue:   "nodot",
			expectedValue: "",
		},
		{
			name:          "wrong signature",
			signedValue:   base64.URLEncoding.EncodeToString([]byte("password")) + "." + base64.URLEncoding.EncodeToString([]byte("wrongsig")),
			expectedValue: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := sharecookie.Verify(secret, tt.signedValue)
			if err != nil {
				t.Fatalf("verify: %v", err)
			}
			if result != tt.expectedValue {
				t.Errorf("expected '%s', got '%s'", tt.expectedValue, result)
			}
		})
	}
}

func TestDifferentSecrets(t *testing.T) {
	secret1 := []byte("secret1")
	secret2 := []byte("secret2")
	password := "testpassword"

	signedValue := sharecookie.Sign(secret1, password)

	result, err := sharecookie.Verify(secret2, signedValue)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if result != "" {
		t.Errorf("expected empty string for wrong secret, got '%s'", result)
	}
}
