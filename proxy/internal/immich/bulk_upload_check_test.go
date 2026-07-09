package immich

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

const bulkTestChecksum = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func bulkTestServer(t *testing.T, handler func(w http.ResponseWriter, calls int32)) (*Client, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/assets/bulk-upload-check" || r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		handler(w, calls.Add(1))
	}))
	t.Cleanup(server.Close)
	return NewClient(server.URL), &calls
}

// A 5xx during detection proves neither support nor absence: the call must
// error (caller falls back for this request) and NOTHING may be cached, so
// the next call retries detection.
func TestBulkCheckAmbiguousStatusIsNotCached(t *testing.T) {
	client, calls := bulkTestServer(t, func(w http.ResponseWriter, _ int32) {
		w.WriteHeader(http.StatusInternalServerError)
	})

	for i := 0; i < 2; i++ {
		outcome, err := client.BulkCheckAssetsByChecksum("key", "", KeyTypeKey, []string{bulkTestChecksum})
		if err == nil {
			t.Fatalf("call %d: expected error on 500 during detection, got %+v", i, outcome)
		}
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("ambiguous statuses must not cache a decision; expected 2 detection attempts, got %d", got)
	}
}

// Results whose ids are missing, unknown, or out of range must fail open as
// "does not exist" instead of panicking or misattributing verdicts.
func TestBulkCheckUnknownResultIdsFailOpen(t *testing.T) {
	client, _ := bulkTestServer(t, func(w http.ResponseWriter, _ int32) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"results": []map[string]any{
				{"id": "not-a-number", "action": "reject", "reason": "duplicate", "assetId": "x"},
				{"id": "99", "action": "reject", "reason": "duplicate", "assetId": "y"},
			},
		})
	})

	outcome, err := client.BulkCheckAssetsByChecksum("key", "", KeyTypeKey, []string{bulkTestChecksum})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !outcome.Supported || !outcome.Detected {
		t.Fatalf("a 200 answer must mark the endpoint supported+detected, got %+v", outcome)
	}
	if outcome.Existence[0].Exists {
		t.Fatalf("unmatched result ids must fail open, got %+v", outcome.Existence[0])
	}
}

// When the cached decision says "supported" but the server starts rejecting
// shared-link auth (downgrade), the cache must flip to unsupported.
func TestBulkCheckSupportDowngradeFlipsCache(t *testing.T) {
	client, calls := bulkTestServer(t, func(w http.ResponseWriter, n int32) {
		if n == 1 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"results": []map[string]any{{"id": "0", "action": "accept"}},
			})
			return
		}
		w.WriteHeader(http.StatusForbidden)
	})

	outcome, err := client.BulkCheckAssetsByChecksum("key", "", KeyTypeKey, []string{bulkTestChecksum})
	if err != nil || !outcome.Supported {
		t.Fatalf("expected supported on first call, got %+v err=%v", outcome, err)
	}

	outcome, err = client.BulkCheckAssetsByChecksum("key", "", KeyTypeKey, []string{bulkTestChecksum})
	if err != nil {
		t.Fatalf("downgrade must not error: %v", err)
	}
	if outcome.Supported || !outcome.Detected || outcome.StatusCode != http.StatusForbidden {
		t.Fatalf("downgrade must re-detect as unsupported, got %+v", outcome)
	}

	// Third call: unsupported is now cached — no upstream traffic.
	outcome, err = client.BulkCheckAssetsByChecksum("key", "", KeyTypeKey, []string{bulkTestChecksum})
	if err != nil || outcome.Supported || outcome.Detected {
		t.Fatalf("expected cached unsupported, got %+v err=%v", outcome, err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("expected exactly 2 upstream calls, got %d", got)
	}
}
