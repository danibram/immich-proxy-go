package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/danibram/immich-proxy-go/internal/config"
	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

const (
	knownChecksumHex = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	knownDuplicateID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
	missingChecksum  = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	erroringChecksum = "cccccccccccccccccccccccccccccccccccccccc"
	knownChecksumB64 = "qqqqqqqqqqqqqqqqqqqqqqqqqqo=" // base64 form registered in the mock
)

// How the mock's POST /api/assets/bulk-upload-check treats shared-link auth.
const (
	// bulkModeRejected mimics current Immich (v3.0.1): the route exists but
	// rejects shared-link auth with 403. Zero value, so all pre-existing
	// tests exercise the detection→fallback path unchanged.
	bulkModeRejected = ""
	// bulkModeNative mimics an Immich with the upstream PR merged: answers
	// real accept/reject results under shared-link auth.
	bulkModeNative = "native"
	// bulkModeNetErr drops the connection mid-request: a transport error,
	// which must NOT cache an "unsupported" decision.
	bulkModeNetErr = "neterr"
)

// bulkCheckReqItem mirrors Immich's AssetBulkUploadCheckItem request shape.
type bulkCheckReqItem struct {
	ID       string `json:"id"`
	Checksum string `json:"checksum"`
}

// uploadCheckMockImmich simulates Immich's AssetUploadInterceptor contract:
// POST /api/assets with a known x-immich-checksum answers 200 duplicate
// before parsing the body; unknown checksums fall through to the file filter
// which rejects the probe's .xyz extension with 400. It also models the
// native bulk-upload-check route according to bulkMode.
type uploadCheckMockImmich struct {
	allowUpload bool
	probeDelay  time.Duration
	bulkMode    string

	probeCalls    atomic.Int32
	inFlight      atomic.Int32
	maxInFlight   atomic.Int32
	assetsCreated atomic.Int32

	bulkCalls atomic.Int32
	bulkMu    sync.Mutex
	// bulkBatches records the items received by each bulk call, in order.
	bulkBatches [][]bulkCheckReqItem
}

func (m *uploadCheckMockImmich) bulkBatchesSnapshot() [][]bulkCheckReqItem {
	m.bulkMu.Lock()
	defer m.bulkMu.Unlock()
	return append([][]bulkCheckReqItem(nil), m.bulkBatches...)
}

func (m *uploadCheckMockImmich) server(t *testing.T) *httptest.Server {
	t.Helper()
	now := time.Now()

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/shared-links/login" && r.Method == http.MethodPost:
			w.WriteHeader(http.StatusUnauthorized) // v3-looking server

		case r.URL.Path == "/api/shared-links/me":
			link := immich.SharedLink{
				ID:          testLinkID1,
				Key:         "valid-key",
				Type:        "ALBUM",
				AllowUpload: m.allowUpload,
				CreatedAt:   now,
				Album: &immich.Album{
					ID:        testAlbumID1,
					AlbumName: "Upload Album",
					CreatedAt: now,
					UpdatedAt: now,
				},
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(link)

		case r.URL.Path == "/api/assets/bulk-upload-check" && r.Method == http.MethodPost:
			m.bulkCalls.Add(1)
			switch m.bulkMode {
			case bulkModeNetErr:
				hj, ok := w.(http.Hijacker)
				if !ok {
					t.Errorf("mock server does not support hijacking")
					return
				}
				conn, _, err := hj.Hijack()
				if err == nil {
					conn.Close()
				}
			case bulkModeNative:
				var req struct {
					Assets []bulkCheckReqItem `json:"assets"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				m.bulkMu.Lock()
				m.bulkBatches = append(m.bulkBatches, req.Assets)
				m.bulkMu.Unlock()
				results := make([]map[string]any, 0, len(req.Assets))
				for _, a := range req.Assets {
					switch a.Checksum {
					case knownChecksumHex, knownChecksumB64:
						results = append(results, map[string]any{
							"id": a.ID, "action": "reject", "reason": "duplicate", "assetId": knownDuplicateID,
						})
					case erroringChecksum:
						// Exotic reject reason: must fail open as not-exists.
						results = append(results, map[string]any{
							"id": a.ID, "action": "reject", "reason": "unsupported-format",
						})
					default:
						results = append(results, map[string]any{"id": a.ID, "action": "accept"})
					}
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]any{"results": results})
			default: // bulkModeRejected — today's Immich behavior
				w.WriteHeader(http.StatusForbidden)
				w.Write([]byte(`{"message":"Forbidden"}`))
			}

		case r.URL.Path == "/api/assets" && r.Method == http.MethodPost:
			m.probeCalls.Add(1)
			current := m.inFlight.Add(1)
			for {
				max := m.maxInFlight.Load()
				if current <= max || m.maxInFlight.CompareAndSwap(max, current) {
					break
				}
			}
			if m.probeDelay > 0 {
				time.Sleep(m.probeDelay)
			}
			m.inFlight.Add(-1)

			checksum := r.Header.Get("x-immich-checksum")
			w.Header().Set("Content-Type", "application/json")
			switch checksum {
			case knownChecksumHex, knownChecksumB64:
				// Interceptor short-circuit: duplicate found, body untouched.
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]string{"status": "duplicate", "id": knownDuplicateID})
			case erroringChecksum:
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"error":"boom"}`))
			default:
				// File filter rejects probe.xyz before creating anything.
				w.WriteHeader(http.StatusBadRequest)
				w.Write([]byte(`{"message":"File type not supported"}`))
			}

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func setupUploadCheckHandler(t *testing.T, mockServer *httptest.Server) (*chi.Mux, *observer.ObservedLogs) {
	t.Helper()
	testSecret := "test-secret-key-12345"

	client := immich.NewClient(mockServer.URL)
	cfg := &config.Config{
		Security: config.SecurityConfig{MaxUploadSize: 100},
	}
	core, logs := observer.New(zap.DebugLevel)
	logger := zap.New(core)

	middleware.CookieSecret = []byte(testSecret)
	handler := NewShareHandler(client, cfg, logger, testSecret)

	r := chi.NewRouter()
	r.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Post("/upload-check", handler.UploadCheck)
	})
	return r, logs
}

func postUploadCheck(t *testing.T, router *chi.Mux, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/share/valid-key/upload-check", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func decodeUploadCheck(t *testing.T, rec *httptest.ResponseRecorder) uploadCheckResponse {
	t.Helper()
	var resp uploadCheckResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode upload-check response: %v (%s)", err, rec.Body.String())
	}
	return resp
}

func TestUploadCheckMarksExistingAndMissing(t *testing.T) {
	mock := &uploadCheckMockImmich{allowUpload: true}
	server := mock.server(t)
	defer server.Close()

	router, _ := setupUploadCheckHandler(t, server)
	rec := postUploadCheck(t, router, fmt.Sprintf(
		`{"files":[{"name":"a.jpg","checksum":"%s"},{"name":"b.jpg","checksum":"%s"}]}`,
		knownChecksumHex, missingChecksum))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	resp := decodeUploadCheck(t, rec)
	if len(resp.Results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(resp.Results))
	}
	if !resp.Results[0].Exists || resp.Results[0].AssetID != knownDuplicateID {
		t.Fatalf("expected first file to exist with asset id, got %+v", resp.Results[0])
	}
	if resp.Results[0].Name != "a.jpg" || resp.Results[0].Checksum != knownChecksumHex {
		t.Fatalf("result must echo name+checksum, got %+v", resp.Results[0])
	}
	if resp.Results[1].Exists || resp.Results[1].AssetID != "" {
		t.Fatalf("expected second file to be missing, got %+v", resp.Results[1])
	}
	if created := mock.assetsCreated.Load(); created != 0 {
		t.Fatalf("probes must never create assets, got %d", created)
	}
}

func TestUploadCheckAcceptsBase64Checksums(t *testing.T) {
	mock := &uploadCheckMockImmich{allowUpload: true}
	server := mock.server(t)
	defer server.Close()

	router, _ := setupUploadCheckHandler(t, server)
	rec := postUploadCheck(t, router, fmt.Sprintf(
		`{"files":[{"name":"a.jpg","checksum":"%s"}]}`, knownChecksumB64))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	resp := decodeUploadCheck(t, rec)
	if len(resp.Results) != 1 || !resp.Results[0].Exists {
		t.Fatalf("expected base64 checksum to be probed and found, got %+v", resp.Results)
	}
}

func TestUploadCheckRejectsInvalidChecksum(t *testing.T) {
	mock := &uploadCheckMockImmich{allowUpload: true}
	server := mock.server(t)
	defer server.Close()

	router, _ := setupUploadCheckHandler(t, server)
	for _, checksum := range []string{"nope", "zzzz", strings.Repeat("g", 40), ""} {
		rec := postUploadCheck(t, router, fmt.Sprintf(
			`{"files":[{"name":"a.jpg","checksum":"%s"}]}`, checksum))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("checksum %q: expected 400, got %d", checksum, rec.Code)
		}
	}
	if calls := mock.probeCalls.Load(); calls != 0 {
		t.Fatalf("invalid checksums must never reach the upstream, got %d probes", calls)
	}
}

func TestUploadCheckCapsListSize(t *testing.T) {
	mock := &uploadCheckMockImmich{allowUpload: true}
	server := mock.server(t)
	defer server.Close()

	router, _ := setupUploadCheckHandler(t, server)

	var sb strings.Builder
	sb.WriteString(`{"files":[`)
	for i := 0; i < maxUploadCheckFiles+1; i++ {
		if i > 0 {
			sb.WriteString(",")
		}
		fmt.Fprintf(&sb, `{"name":"f%d.jpg","checksum":"%s"}`, i, missingChecksum)
	}
	sb.WriteString(`]}`)

	rec := postUploadCheck(t, router, sb.String())
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized list, got %d", rec.Code)
	}
	if calls := mock.probeCalls.Load(); calls != 0 {
		t.Fatalf("oversized lists must never reach the upstream, got %d probes", calls)
	}
}

func TestUploadCheckRequiresUploadPermission(t *testing.T) {
	mock := &uploadCheckMockImmich{allowUpload: false}
	server := mock.server(t)
	defer server.Close()

	router, _ := setupUploadCheckHandler(t, server)
	rec := postUploadCheck(t, router, fmt.Sprintf(
		`{"files":[{"name":"a.jpg","checksum":"%s"}]}`, knownChecksumHex))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 on upload-disabled share, got %d", rec.Code)
	}
	if calls := mock.probeCalls.Load(); calls != 0 {
		t.Fatalf("unauthorized checks must never reach the upstream, got %d probes", calls)
	}
}

func TestUploadCheckFailsOpenOnProbeError(t *testing.T) {
	mock := &uploadCheckMockImmich{allowUpload: true}
	server := mock.server(t)
	defer server.Close()

	router, logs := setupUploadCheckHandler(t, server)
	rec := postUploadCheck(t, router, fmt.Sprintf(
		`{"files":[{"name":"a.jpg","checksum":"%s"},{"name":"b.jpg","checksum":"%s"}]}`,
		erroringChecksum, knownChecksumHex))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 despite one probe error, got %d: %s", rec.Code, rec.Body.String())
	}
	resp := decodeUploadCheck(t, rec)
	if resp.Results[0].Exists {
		t.Fatalf("erroring probe must fail open as not-found, got %+v", resp.Results[0])
	}
	if !resp.Results[1].Exists {
		t.Fatalf("healthy probe must still resolve, got %+v", resp.Results[1])
	}
	if logs.FilterLevelExact(zap.InfoLevel).Len() == 0 {
		t.Fatalf("expected an info log for the failed probe")
	}
}

func TestUploadCheckBoundsProbeConcurrency(t *testing.T) {
	mock := &uploadCheckMockImmich{allowUpload: true, probeDelay: 20 * time.Millisecond}
	server := mock.server(t)
	defer server.Close()

	router, _ := setupUploadCheckHandler(t, server)

	var sb strings.Builder
	sb.WriteString(`{"files":[`)
	for i := 0; i < 40; i++ {
		if i > 0 {
			sb.WriteString(",")
		}
		fmt.Fprintf(&sb, `{"name":"f%d.jpg","checksum":"%s"}`, i, missingChecksum)
	}
	sb.WriteString(`]}`)

	rec := postUploadCheck(t, router, sb.String())
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if calls := mock.probeCalls.Load(); calls != 40 {
		t.Fatalf("expected 40 probes, got %d", calls)
	}
	if max := mock.maxInFlight.Load(); max > uploadCheckProbeConcurrency {
		t.Fatalf("probe concurrency exceeded bound: %d > %d", max, uploadCheckProbeConcurrency)
	}
}

func TestUploadCheckEmptyListShortCircuits(t *testing.T) {
	mock := &uploadCheckMockImmich{allowUpload: true}
	server := mock.server(t)
	defer server.Close()

	router, _ := setupUploadCheckHandler(t, server)
	rec := postUploadCheck(t, router, `{"files":[]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for empty list, got %d", rec.Code)
	}
	resp := decodeUploadCheck(t, rec)
	if len(resp.Results) != 0 {
		t.Fatalf("expected empty results, got %+v", resp.Results)
	}
	if calls := mock.probeCalls.Load(); calls != 0 {
		t.Fatalf("empty list must not probe upstream, got %d", calls)
	}
	if calls := mock.bulkCalls.Load(); calls != 0 {
		t.Fatalf("empty list must not trigger bulk detection, got %d", calls)
	}
}

// countLogsContaining counts log entries whose message contains substr.
func countLogsContaining(logs *observer.ObservedLogs, substr string) int {
	count := 0
	for _, entry := range logs.All() {
		if strings.Contains(entry.Message, substr) {
			count++
		}
	}
	return count
}

func TestUploadCheckUsesNativeBulkEndpoint(t *testing.T) {
	mock := &uploadCheckMockImmich{allowUpload: true, bulkMode: bulkModeNative}
	server := mock.server(t)
	defer server.Close()

	router, logs := setupUploadCheckHandler(t, server)
	body := fmt.Sprintf(
		`{"files":[{"name":"a.jpg","checksum":"%s"},{"name":"b.jpg","checksum":"%s"},{"name":"c.jpg","checksum":"%s"}]}`,
		knownChecksumHex, missingChecksum, erroringChecksum)

	// First request: capability detection (1 item) + remainder (2 items).
	rec := postUploadCheck(t, router, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	resp := decodeUploadCheck(t, rec)
	if len(resp.Results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(resp.Results))
	}
	if !resp.Results[0].Exists || resp.Results[0].AssetID != knownDuplicateID {
		t.Fatalf("duplicate must map to exists+assetId, got %+v", resp.Results[0])
	}
	if resp.Results[0].Name != "a.jpg" || resp.Results[0].Checksum != knownChecksumHex {
		t.Fatalf("result must echo name+checksum, got %+v", resp.Results[0])
	}
	if resp.Results[1].Exists {
		t.Fatalf("accept must map to exists=false, got %+v", resp.Results[1])
	}
	if resp.Results[2].Exists || resp.Results[2].AssetID != "" {
		t.Fatalf("non-duplicate reject must fail open as exists=false, got %+v", resp.Results[2])
	}
	if calls := mock.probeCalls.Load(); calls != 0 {
		t.Fatalf("native path must not send probes, got %d", calls)
	}
	if calls := mock.bulkCalls.Load(); calls != 2 {
		t.Fatalf("first use must cost detection + remainder = 2 bulk calls, got %d", calls)
	}
	batches := mock.bulkBatchesSnapshot()
	if len(batches[0]) != 1 || batches[0][0].Checksum != knownChecksumHex {
		t.Fatalf("detection must carry exactly the first real item, got %+v", batches[0])
	}
	if len(batches[1]) != 2 || batches[1][0].ID != "1" || batches[1][1].ID != "2" {
		t.Fatalf("remainder call must carry items 1..n-1 with offset ids, got %+v", batches[1])
	}
	if n := countLogsContaining(logs, "upstream supports shared-link bulk-upload-check"); n != 1 {
		t.Fatalf("expected exactly one supported-detection log, got %d", n)
	}

	// Second request: cached decision → a single bulk call for the whole list.
	rec = postUploadCheck(t, router, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on second request, got %d", rec.Code)
	}
	resp = decodeUploadCheck(t, rec)
	if !resp.Results[0].Exists || resp.Results[1].Exists {
		t.Fatalf("cached native path must keep the same mapping, got %+v", resp.Results)
	}
	if calls := mock.bulkCalls.Load(); calls != 3 {
		t.Fatalf("cached support must cost exactly one bulk call, got %d total", calls)
	}
	batches = mock.bulkBatchesSnapshot()
	if last := batches[len(batches)-1]; len(last) != 3 || last[0].ID != "0" {
		t.Fatalf("cached path must send the full list in one call, got %+v", last)
	}
	if calls := mock.probeCalls.Load(); calls != 0 {
		t.Fatalf("native path must never probe, got %d", calls)
	}
	if n := countLogsContaining(logs, "upstream supports shared-link bulk-upload-check"); n != 1 {
		t.Fatalf("detection log must not repeat on cached decisions, got %d", n)
	}
}

func TestUploadCheckNativeRejectionIsCachedAndFallsBack(t *testing.T) {
	mock := &uploadCheckMockImmich{allowUpload: true, bulkMode: bulkModeRejected}
	server := mock.server(t)
	defer server.Close()

	router, logs := setupUploadCheckHandler(t, server)
	body := fmt.Sprintf(
		`{"files":[{"name":"a.jpg","checksum":"%s"},{"name":"b.jpg","checksum":"%s"}]}`,
		knownChecksumHex, missingChecksum)

	// First request: detection gets 403 → probe fallback answers.
	rec := postUploadCheck(t, router, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	resp := decodeUploadCheck(t, rec)
	if !resp.Results[0].Exists || resp.Results[0].AssetID != knownDuplicateID || resp.Results[1].Exists {
		t.Fatalf("fallback must produce identical semantics, got %+v", resp.Results)
	}
	if calls := mock.bulkCalls.Load(); calls != 1 {
		t.Fatalf("detection must cost exactly one bulk call, got %d", calls)
	}
	if calls := mock.probeCalls.Load(); calls != 2 {
		t.Fatalf("fallback must probe every checksum, got %d", calls)
	}
	if n := countLogsContaining(logs, "upstream rejected shared-link bulk-upload-check"); n != 1 {
		t.Fatalf("expected exactly one fallback-detection log, got %d", n)
	}

	// Second request: unsupported decision is cached → no new bulk call.
	rec = postUploadCheck(t, router, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on second request, got %d", rec.Code)
	}
	if calls := mock.bulkCalls.Load(); calls != 1 {
		t.Fatalf("unsupported decision must be cached (no re-detection), got %d bulk calls", calls)
	}
	if calls := mock.probeCalls.Load(); calls != 4 {
		t.Fatalf("cached fallback must keep probing, got %d probes", calls)
	}
	if n := countLogsContaining(logs, "upstream rejected shared-link bulk-upload-check"); n != 1 {
		t.Fatalf("fallback-detection log must not repeat on cached decisions, got %d", n)
	}
}

func TestUploadCheckNativeTransportErrorIsNotCached(t *testing.T) {
	mock := &uploadCheckMockImmich{allowUpload: true, bulkMode: bulkModeNetErr}
	server := mock.server(t)
	defer server.Close()

	router, logs := setupUploadCheckHandler(t, server)
	body := fmt.Sprintf(`{"files":[{"name":"a.jpg","checksum":"%s"}]}`, knownChecksumHex)

	// First request: detection dies on the wire → fallback, decision NOT cached.
	rec := postUploadCheck(t, router, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 despite bulk transport error, got %d: %s", rec.Code, rec.Body.String())
	}
	resp := decodeUploadCheck(t, rec)
	if !resp.Results[0].Exists {
		t.Fatalf("probe fallback must still resolve existence, got %+v", resp.Results[0])
	}
	if calls := mock.bulkCalls.Load(); calls != 1 {
		t.Fatalf("expected one bulk detection attempt, got %d", calls)
	}
	if n := countLogsContaining(logs, "native bulk-upload-check attempt failed"); n != 1 {
		t.Fatalf("expected one transient-failure log, got %d", n)
	}

	// Second request: detection must be retried (nothing was cached).
	rec = postUploadCheck(t, router, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on second request, got %d", rec.Code)
	}
	if calls := mock.bulkCalls.Load(); calls != 2 {
		t.Fatalf("transport errors must not cache the decision; expected re-detection, got %d bulk calls", calls)
	}
	if calls := mock.probeCalls.Load(); calls != 2 {
		t.Fatalf("both requests must fall back to probes, got %d", calls)
	}
}
