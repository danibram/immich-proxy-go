package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/danibram/immich-proxy-go/internal/sharecookie"
	"github.com/go-chi/chi/v5"
)

type contextKey string

const (
	ShareKeyContextKey  contextKey = "shareKey"
	PasswordContextKey  contextKey = "password"
	KeyTypeContextKey   contextKey = "keyType"
)

// KeyType represents whether the key is a standard key or a slug
type KeyType string

const (
	KeyTypeKey  KeyType = "key"
	KeyTypeSlug KeyType = "slug"
)

// CookieSecret is set by main.go and used for verifying signed cookies
var CookieSecret []byte

// ExtractShareKey extracts the share key from the URL and adds it to the context
func ExtractShareKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := chi.URLParam(r, "key")
		if key == "" {
			http.Error(w, "Share key required", http.StatusBadRequest)
			return
		}

		// Determine key type based on URL path
		// /s/{key} = slug, /share/{key} = key
		keyType := KeyTypeKey
		if strings.HasPrefix(r.URL.Path, "/s/") {
			keyType = KeyTypeSlug
		}

		// Get password from cookie or header
		password := ""

		// Only accept password cookies that pass HMAC verification against our
		// CookieSecret. Accepting raw cookies as a "backwards compat" fallback
		// lets any attacker with a share URL guess passwords at the normal
		// request rate rather than at the password-endpoint strict rate, and
		// bypasses our HMAC entirely.
		if cookie, err := r.Cookie("immich-share-password"); err == nil {
			if verifiedPassword, err := sharecookie.Verify(CookieSecret, cookie.Value); err == nil && verifiedPassword != "" {
				password = verifiedPassword
			}
			// If verification fails, the password stays empty and the user
			// will get a "password required" response just like a fresh
			// visitor. No raw-cookie fallback.
		}

		// Header takes precedence over cookie (used by programmatic clients).
		// Note: this header is still subject to the password-endpoint rate
		// limit when used to fetch via /shared-links/me.
		if headerPassword := r.Header.Get("x-immich-share-password"); headerPassword != "" {
			password = headerPassword
		}

		ctx := context.WithValue(r.Context(), ShareKeyContextKey, key)
		ctx = context.WithValue(ctx, PasswordContextKey, password)
		ctx = context.WithValue(ctx, KeyTypeContextKey, keyType)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetShareKey retrieves the share key from the context
func GetShareKey(ctx context.Context) string {
	if key, ok := ctx.Value(ShareKeyContextKey).(string); ok {
		return key
	}
	return ""
}

// GetPassword retrieves the password from the context
func GetPassword(ctx context.Context) string {
	if password, ok := ctx.Value(PasswordContextKey).(string); ok {
		return password
	}
	return ""
}

// GetKeyType retrieves the key type from the context
func GetKeyType(ctx context.Context) KeyType {
	if keyType, ok := ctx.Value(KeyTypeContextKey).(KeyType); ok {
		return keyType
	}
	return KeyTypeKey
}
