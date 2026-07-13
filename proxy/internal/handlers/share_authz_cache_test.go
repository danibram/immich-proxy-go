package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/go-chi/chi/v5"
)

// authzTestRig wires a ShareHandler to a controllable upstream and exposes a
// probe route that calls authorizeShareRequest with real middleware context.
type authzTestRig struct {
	router      *chi.Mux
	upstreamHit *atomic.Int64
	// respond decides the upstream's answer for /api/shared-links/me.
	respond *atomic.Value // stores func(w http.ResponseWriter)
}

func newAuthzTestRig(t *testing.T) *authzTestRig {
	t.Helper()

	hits := &atomic.Int64{}
	respond := &atomic.Value{}
	respond.Store(func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"id":            testLinkID1,
			"key":           "valid-key",
			"type":          "ALBUM",
			"allowDownload": true,
		})
	})

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/shared-links/me" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		hits.Add(1)
		respond.Load().(func(w http.ResponseWriter))(w)
	}))
	t.Cleanup(upstream.Close)

	handler, _ := setupTestHandler(t, upstream)

	router := chi.NewRouter()
	router.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Get("/authz-probe", func(w http.ResponseWriter, req *http.Request) {
			if err := handler.authorizeShareRequest(req); err != nil {
				handler.handleError(w, err)
				return
			}
			w.WriteHeader(http.StatusOK)
		})
	})

	return &authzTestRig{router: router, upstreamHit: hits, respond: respond}
}

func (rig *authzTestRig) probe(t *testing.T) int {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/share/valid-key/authz-probe", nil)
	rec := httptest.NewRecorder()
	rig.router.ServeHTTP(rec, req)
	return rec.Code
}

func TestAuthorizeShareRequest_TransientErrorNotCached(t *testing.T) {
	rig := newAuthzTestRig(t)

	// Upstream is momentarily broken (a 503 blip).
	rig.respond.Store(func(w http.ResponseWriter) {
		http.Error(w, "upstream exploded", http.StatusServiceUnavailable)
	})
	if code := rig.probe(t); code == http.StatusOK {
		t.Fatalf("expected failure while upstream is down, got %d", code)
	}
	if hits := rig.upstreamHit.Load(); hits != 1 {
		t.Fatalf("expected 1 upstream hit, got %d", hits)
	}

	// Upstream recovers. The transient failure must NOT have been cached:
	// the very next request re-checks upstream and succeeds immediately.
	rig.respond.Store(func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"id": testLinkID1, "key": "valid-key", "type": "ALBUM",
		})
	})
	if code := rig.probe(t); code != http.StatusOK {
		t.Fatalf("expected authorization to succeed right after recovery, got %d", code)
	}
	if hits := rig.upstreamHit.Load(); hits != 2 {
		t.Fatalf("expected the second request to re-invoke upstream (2 hits), got %d", hits)
	}
}

func TestAuthorizeShareRequest_AuthorizedVerdictCached(t *testing.T) {
	rig := newAuthzTestRig(t)

	for i := 0; i < 3; i++ {
		if code := rig.probe(t); code != http.StatusOK {
			t.Fatalf("probe %d: expected 200, got %d", i, code)
		}
	}
	if hits := rig.upstreamHit.Load(); hits != 1 {
		t.Fatalf("expected a single upstream lookup for repeated requests, got %d", hits)
	}
}

func TestAuthorizeShareRequest_DefinitiveDenialCached(t *testing.T) {
	rig := newAuthzTestRig(t)

	// Immich says the link needs a password — a definitive verdict.
	rig.respond.Store(func(w http.ResponseWriter) {
		http.Error(w, `{"message":"password required"}`, http.StatusUnauthorized)
	})
	for i := 0; i < 3; i++ {
		if code := rig.probe(t); code != http.StatusUnauthorized {
			t.Fatalf("probe %d: expected 401, got %d", i, code)
		}
	}
	if hits := rig.upstreamHit.Load(); hits != 1 {
		t.Fatalf("expected the denial to be served from cache (1 hit), got %d", hits)
	}
}

func TestIsDefinitiveAuthzVerdict(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		definitive bool
	}{
		{"authorized", nil, true},
		{"password required", immich.ErrPasswordRequired, true},
		{"link not found", immich.ErrSharedLinkNotFound, true},
		{"upstream unavailable", immich.ErrUpstreamUnavailable, false},
		{"wrapped upstream unavailable", errors.Join(errors.New("ctx"), immich.ErrUpstreamUnavailable), false},
		{"unexpected 5xx", errors.New("unexpected status code 503: boom"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isDefinitiveAuthzVerdict(tc.err); got != tc.definitive {
				t.Fatalf("isDefinitiveAuthzVerdict(%v) = %v, want %v", tc.err, got, tc.definitive)
			}
		})
	}
}
