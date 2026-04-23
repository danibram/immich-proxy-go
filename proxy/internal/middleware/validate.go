package middleware

import (
	"net/http"
	"regexp"
)

// UUID regex pattern (canonical UUID text shape; version bits not enforced)
var uuidRegex = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Share key can be alphanumeric with some special characters
var shareKeyRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`)

// ValidThumbnailSizes contains allowed thumbnail size values
var ValidThumbnailSizes = map[string]bool{
	"":          true, // empty is allowed (defaults to thumbnail)
	"thumbnail": true,
	"preview":   true,
}

// IsValidUUID checks if a string is a valid UUID
func IsValidUUID(s string) bool {
	return uuidRegex.MatchString(s)
}

// IsValidShareKey checks if a string is a valid share key
func IsValidShareKey(s string) bool {
	return shareKeyRegex.MatchString(s)
}

// IsValidThumbnailSize checks if a string is a valid thumbnail size
func IsValidThumbnailSize(s string) bool {
	return ValidThumbnailSizes[s]
}

// ValidateUUID returns a middleware that validates URL parameters are valid UUIDs
func ValidateUUID(paramName string, getParam func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			value := getParam(r)
			if value != "" && !IsValidUUID(value) {
				http.Error(w, "Invalid "+paramName+" format", http.StatusBadRequest)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ValidateShareKey validates the share key format in the middleware
func ValidateShareKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := GetShareKey(r.Context())
		if key != "" && !IsValidShareKey(key) {
			http.Error(w, "Invalid share key format", http.StatusBadRequest)
			return
		}
		next.ServeHTTP(w, r)
	})
}
