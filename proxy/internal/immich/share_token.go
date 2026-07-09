package immich

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Immich v3 no longer authenticates password-protected shared links through
// the `password` query parameter. Clients must POST the password to
// /api/shared-links/login once and replay the resulting
// immich_shared_link_token cookie on every request. Immich v2 does not have
// the login route, so a 404 there means "keep using the password parameter".

const sharedLinkTokenCookie = "immich_shared_link_token"

// How long a fetched token is reused before logging in again. Immich issues
// the cookie with a 24h lifetime; refreshing hourly stays well inside it.
const shareTokenTTL = time.Hour

// How long a "this server has no login endpoint" result is remembered, so
// Immich v2 deployments do not pay an extra upstream request per call.
const shareTokenNegativeTTL = 10 * time.Minute

type shareTokenEntry struct {
	token string
	// notPasswordProtected means the login endpoint reported the link has no
	// password — i.e. any password we were given is a stale cookie.
	notPasswordProtected bool
	fetchedAt            time.Time
	ttl                  time.Duration
}

func shareTokenCacheKey(key, password string, keyType KeyType) string {
	return fmt.Sprintf("%s|%s|%s", keyType, key, password)
}

// shareTokenState returns the login state for a password-protected share,
// fetching it through the v3 login endpoint when needed. A zero-value entry
// means the server has no login endpoint (v2) or the password was rejected —
// in both cases the caller proceeds without a token and the upstream response
// surfaces the proper status.
func (c *Client) shareTokenState(key, password string, keyType KeyType) shareTokenEntry {
	cacheKey := shareTokenCacheKey(key, password, keyType)

	c.shareTokenMu.RLock()
	entry, ok := c.shareTokens[cacheKey]
	c.shareTokenMu.RUnlock()
	if ok && time.Since(entry.fetchedAt) < entry.ttl {
		return entry
	}

	entry = c.fetchSharedLinkToken(key, password, keyType)
	if entry.ttl > 0 {
		entry.fetchedAt = time.Now()
		c.shareTokenMu.Lock()
		c.shareTokens[cacheKey] = entry
		c.shareTokenMu.Unlock()
	}
	return entry
}

// sharedLinkToken returns the auth token cookie value for a password-protected
// share, or "" when no token is available or needed.
func (c *Client) sharedLinkToken(key, password string, keyType KeyType) string {
	return c.shareTokenState(key, password, keyType).token
}

// shareKnownPublic reports whether the login probe established that the link
// has no password at all — meaning a supplied password is a stale cookie.
// Only meaningful on Immich v3 (v2 has no login endpoint and signals the same
// condition with a 400 on the actual request instead).
func (c *Client) shareKnownPublic(key, password string, keyType KeyType) bool {
	if password == "" {
		return false
	}
	return c.shareTokenState(key, password, keyType).notPasswordProtected
}

type loginEndpointProbe struct {
	supported bool
	fetchedAt time.Time
	ttl       time.Duration
}

// SupportsSharedLinkLogin reports whether the upstream Immich exposes the
// /api/shared-links/login endpoint. The route shipped in Immich v3 alongside
// the behavior change that shared-link uploads are automatically associated
// with the shared album — so callers use this as the "v3+" signal to skip
// the redundant (and 403-answering) explicit album add after an upload.
//
// Unknown (transport error) reports false so callers fall back to the
// explicit add: correct on v2, and on v3 the resulting 403 is harmless.
// Results are cached server-wide; the probe costs one upstream round-trip
// per TTL window instead of one wasted album-add per uploaded photo.
func (c *Client) SupportsSharedLinkLogin(key string, keyType KeyType) bool {
	c.loginEndpointMu.Lock()
	cached := c.loginEndpoint
	c.loginEndpointMu.Unlock()
	if cached != nil && time.Since(cached.fetchedAt) < cached.ttl {
		return cached.supported
	}

	probe := c.probeSharedLinkLoginEndpoint(key, keyType)
	if probe == nil {
		return false
	}
	c.loginEndpointMu.Lock()
	c.loginEndpoint = probe
	c.loginEndpointMu.Unlock()
	return probe.supported
}

// probeSharedLinkLoginEndpoint asks the upstream whether the shared-link
// login route exists. Any concrete status proves route presence or absence;
// nil means the upstream was unreachable and nothing should be cached.
func (c *Client) probeSharedLinkLoginEndpoint(key string, keyType KeyType) *loginEndpointProbe {
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")

	resp, err := c.proxyShareRequestWithoutToken("POST", "/api/shared-links/login", key, "", keyType, nil, headers, strings.NewReader(`{"password":""}`))
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusNotFound, http.StatusMethodNotAllowed:
		// Immich v2: the login route does not exist. Re-check sooner in case
		// the operator upgrades the server underneath a running proxy.
		return &loginEndpointProbe{supported: false, fetchedAt: time.Now(), ttl: shareTokenNegativeTTL}
	default:
		// Any other answer (200/201 token issued, 400 "not password
		// protected", 401 wrong password) proves the route exists → v3+.
		return &loginEndpointProbe{supported: true, fetchedAt: time.Now(), ttl: shareTokenTTL}
	}
}

// fetchSharedLinkToken performs the login call. Entries with ttl == 0 must
// not be cached (transport errors or wrong passwords, which the user may
// correct at any moment).
func (c *Client) fetchSharedLinkToken(key, password string, keyType KeyType) shareTokenEntry {
	payload, err := json.Marshal(map[string]string{"password": password})
	if err != nil {
		return shareTokenEntry{}
	}
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")

	resp, err := c.proxyShareRequestWithoutToken("POST", "/api/shared-links/login", key, "", keyType, nil, headers, strings.NewReader(string(payload)))
	if err != nil {
		return shareTokenEntry{}
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated:
		for _, cookie := range resp.Cookies() {
			if cookie.Name == sharedLinkTokenCookie && cookie.Value != "" {
				return shareTokenEntry{token: cookie.Value, ttl: shareTokenTTL}
			}
		}
		return shareTokenEntry{}
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusMethodNotAllowed:
		// Immich v2: no login endpoint; the password query parameter works.
		return shareTokenEntry{ttl: shareTokenNegativeTTL}
	case resp.StatusCode == http.StatusBadRequest:
		// "Shared link is not password protected" — the supplied password is
		// a stale cookie on a public share. No token needed.
		return shareTokenEntry{notPasswordProtected: true, ttl: shareTokenNegativeTTL}
	default:
		// Wrong password (401) or anything unexpected: let the actual request
		// fail with the real upstream status.
		return shareTokenEntry{}
	}
}
