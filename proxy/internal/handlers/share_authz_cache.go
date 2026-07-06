package handlers

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
)

// Immich v3 stopped enforcing shared-link passwords on media endpoints
// (thumbnail/video return 200 with just the key, while shared-links/me
// correctly returns 401). The proxy therefore authorizes those requests
// itself. A short-lived verdict cache keeps this at one upstream lookup per
// share per TTL instead of one per gallery tile, preserving the scroll
// performance that motivated skipping the check in the first place.

const authzCacheTTL = time.Minute

type authzVerdict struct {
	err       error // nil = authorized
	expiresAt time.Time
}

type shareAuthzCache struct {
	mu       sync.RWMutex
	verdicts map[string]authzVerdict
}

func newShareAuthzCache() *shareAuthzCache {
	return &shareAuthzCache{verdicts: make(map[string]authzVerdict)}
}

func (c *shareAuthzCache) get(key string) (authzVerdict, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	verdict, ok := c.verdicts[key]
	if !ok || time.Now().After(verdict.expiresAt) {
		return authzVerdict{}, false
	}
	return verdict, true
}

func (c *shareAuthzCache) set(key string, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Drop expired entries opportunistically so the map stays bounded by the
	// number of shares actively browsed within a TTL window.
	now := time.Now()
	for k, v := range c.verdicts {
		if now.After(v.expiresAt) {
			delete(c.verdicts, k)
		}
	}
	c.verdicts[key] = authzVerdict{err: err, expiresAt: now.Add(authzCacheTTL)}
}

// authorizeShareRequest verifies that the request's credentials open the
// shared link (correct password, not expired). It must be called by every
// media handler that proxies upstream without loading the link itself.
func (h *ShareHandler) authorizeShareRequest(r *http.Request) error {
	ctx := r.Context()
	cacheKey := fmt.Sprintf("%s|%s|%s",
		h.getKeyType(ctx),
		middleware.GetShareKey(ctx),
		middleware.GetPassword(ctx))

	if verdict, ok := h.authzCache.get(cacheKey); ok {
		return verdict.err
	}

	link, _, _, err := h.loadShareLinkFromRequest(r)
	if err == nil {
		if msg, _ := h.validateSharedLink(link); msg != "" {
			err = immich.ErrSharedLinkNotFound
		}
	}
	h.authzCache.set(cacheKey, err)
	return err
}
