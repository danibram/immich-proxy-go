package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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
	knownChecksumHex  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	knownDuplicateID  = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
	missingChecksum   = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	erroringChecksum  = "cccccccccccccccccccccccccccccccccccccccc"
	knownChecksumB64  = "qqqqqqqqqqqqqqqqqqqqqqqqqqo=" // base64 form registered in the mock
)

// uploadCheckMockImmich simulates Immich's AssetUploadInterceptor contract:
// POST /api/assets with a known x-immich-checksum answers 200 duplicate
// before parsing the body; unknown checksums fall through to the file filter
// which rejects the probe's .xyz extension with 400.
type uploadCheckMockImmich struct {
	allowUpload bool
	probeDelay  time.Duration

	probeCalls    atomic.Int32
	inFlight      atomic.Int32
	maxInFlight   atomic.Int32
	assetsCreated atomic.Int32
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
}
