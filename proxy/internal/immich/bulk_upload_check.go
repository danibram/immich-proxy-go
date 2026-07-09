package immich

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// Immich's real POST /api/assets/bulk-upload-check answers every checksum in
// a single round-trip, but current servers (verified against v3.0.1 and main)
// gate it with @Authenticated({permission: AssetUpload}) WITHOUT
// `sharedLink: true`, so shared-link auth is rejected with 401/403. An
// upstream Immich PR proposes allowing shared-link auth on the route. This
// file lets the proxy use the native endpoint as soon as the target server
// supports it — capability is detected once with a one-item request and
// cached — while callers keep the per-checksum probe technique
// (upload_check.go) as the fallback.
//
// Body/response contract (Immich server/src/dtos/asset-media*.dto.ts):
//
//	request:  {assets: [{id, checksum}]}       // id echoed back verbatim
//	response: {results: [{id, action: "accept"|"reject",
//	                      reason?: "duplicate"|..., assetId?, isTrashed?}]}
//
// The DTO declares NO array length limit (plain z.array in v3.0.1 and main),
// so a full 500-item proxy request fits in one call — no chunking needed.

// bulkCheckProbe caches whether the upstream accepts shared-link auth on
// /api/assets/bulk-upload-check. Mirrors loginEndpointProbe (share_token.go):
// supported results are re-checked hourly, unsupported ones every 10 minutes
// so an upstream upgrade is noticed quickly; transport errors and ambiguous
// statuses are never cached.
type bulkCheckProbe struct {
	supported bool
	fetchedAt time.Time
	ttl       time.Duration
}

// BulkCheckOutcome is the result of trying the native bulk-upload-check.
type BulkCheckOutcome struct {
	// Supported reports whether the native endpoint answered; Existence is
	// then index-aligned with the checksums passed in. When false the caller
	// must fall back to per-checksum probes.
	Supported bool
	// Detected is true when THIS call performed capability detection (the
	// decision was not served from cache) — callers log the decision once.
	Detected bool
	// StatusCode is the upstream status that decided a detection (200, or
	// the 401/403/404/405 that proved "unsupported"). Zero when the decision
	// came from cache.
	StatusCode int
	// Existence holds the per-checksum verdicts when Supported.
	Existence []AssetExistence
}

type bulkCheckItem struct {
	ID       string `json:"id"`
	Checksum string `json:"checksum"`
}

type bulkCheckRequest struct {
	Assets []bulkCheckItem `json:"assets"`
}

type bulkCheckResult struct {
	ID      string `json:"id"`
	Action  string `json:"action"`
	Reason  string `json:"reason,omitempty"`
	AssetID string `json:"assetId,omitempty"`
}

type bulkCheckResponse struct {
	Results []bulkCheckResult `json:"results"`
}

// isBulkCheckUnsupportedStatus reports whether an upstream status PROVES the
// native endpoint cannot be used with shared-link auth: 401/403 (route exists
// but rejects share-key auth — today's Immich), 404/405 (route absent on old
// servers). Anything else — 400, 5xx — proves neither support nor absence and
// must not poison the cache.
func isBulkCheckUnsupportedStatus(status int) bool {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusMethodNotAllowed:
		return true
	}
	return false
}

func (c *Client) storeBulkCheckProbe(supported bool) {
	ttl := shareTokenTTL
	if !supported {
		ttl = shareTokenNegativeTTL
	}
	c.bulkCheckMu.Lock()
	c.bulkCheck = &bulkCheckProbe{supported: supported, fetchedAt: time.Now(), ttl: ttl}
	c.bulkCheckMu.Unlock()
}

// BulkCheckAssetsByChecksum answers all checksums through Immich's native
// POST /api/assets/bulk-upload-check when the upstream accepts shared-link
// auth on it. Capability is detected on first use with a ONE-item request
// (so an unsupported answer costs a ~100-byte round-trip) and cached
// server-wide; when the probe proves support the remaining items follow in a
// single second call. Subsequent requests make exactly one bulk call.
//
// Returns a non-nil outcome with Supported=false when the caller must fall
// back to per-checksum probes (decision cached), or an error on transport
// failures and ambiguous statuses (nothing cached — detection retries on the
// next request, and the caller falls back for this one).
func (c *Client) BulkCheckAssetsByChecksum(key string, password string, keyType KeyType, checksums []string) (*BulkCheckOutcome, error) {
	if len(checksums) == 0 {
		return &BulkCheckOutcome{Supported: true, Existence: nil}, nil
	}

	c.bulkCheckMu.Lock()
	cached := c.bulkCheck
	c.bulkCheckMu.Unlock()

	if cached != nil && time.Since(cached.fetchedAt) < cached.ttl {
		if !cached.supported {
			return &BulkCheckOutcome{}, nil
		}
		existence, status, err := c.postBulkCheck(key, password, keyType, checksums, 0)
		if err != nil {
			return nil, err
		}
		if status != http.StatusOK {
			if isBulkCheckUnsupportedStatus(status) {
				// The server stopped accepting shared-link bulk checks
				// (downgrade or permission change): flip the cache so later
				// requests skip straight to probes.
				c.storeBulkCheckProbe(false)
				return &BulkCheckOutcome{Detected: true, StatusCode: status}, nil
			}
			return nil, fmt.Errorf("bulk-upload-check: unexpected status %d", status)
		}
		return &BulkCheckOutcome{Supported: true, Existence: existence}, nil
	}

	// Capability detection: one REAL item, so a 200 answer is immediately
	// usable and an unsupported answer wastes almost nothing.
	first, status, err := c.postBulkCheck(key, password, keyType, checksums[:1], 0)
	if err != nil {
		return nil, err
	}
	switch {
	case status == http.StatusOK:
		c.storeBulkCheckProbe(true)
	case isBulkCheckUnsupportedStatus(status):
		c.storeBulkCheckProbe(false)
		return &BulkCheckOutcome{Detected: true, StatusCode: status}, nil
	default:
		return nil, fmt.Errorf("bulk-upload-check: unexpected status %d during capability detection", status)
	}

	existence := make([]AssetExistence, len(checksums))
	existence[0] = first[0]
	if len(checksums) > 1 {
		rest, status, err := c.postBulkCheck(key, password, keyType, checksums[1:], 1)
		if err != nil {
			return nil, err
		}
		if status != http.StatusOK {
			return nil, fmt.Errorf("bulk-upload-check: unexpected status %d after successful detection", status)
		}
		copy(existence[1:], rest)
	}
	return &BulkCheckOutcome{Supported: true, Detected: true, StatusCode: http.StatusOK, Existence: existence}, nil
}

// postBulkCheck performs one native bulk-upload-check call for the given
// checksums, using their position (+idOffset) as the echoed item id. On 200
// it returns verdicts index-aligned with the input; on any other status it
// returns (nil, status, nil) and lets the caller decide. Missing or unknown
// result ids fail open as "does not exist" — the client then uploads with
// the checksum header and Immich dedupes there anyway.
func (c *Client) postBulkCheck(key string, password string, keyType KeyType, checksums []string, idOffset int) ([]AssetExistence, int, error) {
	payload := bulkCheckRequest{Assets: make([]bulkCheckItem, len(checksums))}
	for i, checksum := range checksums {
		payload.Assets[i] = bulkCheckItem{ID: strconv.Itoa(idOffset + i), Checksum: checksum}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, fmt.Errorf("bulk-upload-check: failed to encode request: %w", err)
	}

	headers := http.Header{}
	headers.Set("Content-Type", "application/json")

	resp, err := c.proxyShareRequest("POST", "/api/assets/bulk-upload-check", key, password, keyType, nil, headers, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 512)) //nolint:errcheck // drain for connection reuse
		return nil, resp.StatusCode, nil
	}

	var parsed bulkCheckResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, 0, fmt.Errorf("bulk-upload-check: failed to decode response: %w", err)
	}

	existence := make([]AssetExistence, len(checksums))
	for _, result := range parsed.Results {
		id, err := strconv.Atoi(result.ID)
		if err != nil {
			continue
		}
		idx := id - idOffset
		if idx < 0 || idx >= len(checksums) {
			continue
		}
		// Same semantics as the probe path: only a confirmed duplicate counts
		// as existing. "accept" and any exotic reject reason fail open.
		if result.Action == "reject" && result.Reason == "duplicate" {
			existence[idx] = AssetExistence{Exists: true, AssetID: result.AssetID}
		}
	}
	return existence, http.StatusOK, nil
}
