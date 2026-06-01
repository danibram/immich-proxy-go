package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/danibram/immich-proxy-go/internal/sharecookie"
)

// ValidatePassword validates a password for a shared link
func (h *ShareHandler) ValidatePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Limit password length to prevent DoS
	if len(req.Password) > 256 {
		http.Error(w, "Password too long", http.StatusBadRequest)
		return
	}

	_, _, _, err := h.loadShareLink(r.Context(), req.Password)
	if err != nil {
		if err == immich.ErrPasswordRequired {
			http.Error(w, "Invalid password", http.StatusUnauthorized)
			return
		}
		h.handleError(w, err)
		return
	}

	signedPassword := sharecookie.Sign(h.cookieSecret, req.Password)

	// Decide whether to set the Secure attribute on the cookie. We must
	// strike a balance between "safe by default in production" and "works
	// on http://localhost in development":
	//   1. security.force_secure_cookies=true  -> always Secure (for admins
	//      behind a TLS-terminating reverse proxy who haven't set PublicURL)
	//   2. security.trust_proxy_headers and X-Forwarded-Proto=https -> Secure
	//   3. the request itself was on TLS -> Secure
	//   4. proxy.public_url starts with https:// -> Secure
	// Only when none of those hold do we send the cookie without Secure
	// (localhost/dev).
	isSecure := h.config.Security.ForceSecureCookies ||
		(h.config.Security.TrustProxyHeaders && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")) ||
		r.TLS != nil ||
		strings.HasPrefix(h.config.Proxy.PublicURL, "https://")

	cookiePath := shareCookiePath(r)

	http.SetCookie(w, &http.Cookie{
		Name:     "immich-share-password",
		Value:    signedPassword,
		Path:     cookiePath,
		HttpOnly: true,
		Secure:   isSecure,
		SameSite: http.SameSiteStrictMode, // Strict: never sent on cross-site requests
		MaxAge:   86400,                   // 24 hours
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"valid": true})
}

// clearSharePasswordCookie removes a stale password cookie after Immich confirms
// the shared link is public, so media requests are not sent with a useless password.
func clearSharePasswordCookie(w http.ResponseWriter, r *http.Request) {
	cookiePath := shareCookiePath(r)
	http.SetCookie(w, &http.Cookie{
		Name:     "immich-share-password",
		Value:    "",
		Path:     cookiePath,
		HttpOnly: true,
		MaxAge:   -1,
		SameSite: http.SameSiteStrictMode,
	})
}

// shareCookiePath scopes the password cookie to the current share URL so a
// session unlocked on /s/album-a is not sent to /s/album-b.
func shareCookiePath(r *http.Request) string {
	key := middleware.GetShareKey(r.Context())
	if key == "" {
		return "/"
	}
	if middleware.GetKeyType(r.Context()) == middleware.KeyTypeSlug {
		return "/s/" + key
	}
	return "/share/" + key
}
