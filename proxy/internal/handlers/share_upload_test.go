package handlers

import (
	"encoding/json"
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

// uploadMockImmich simulates the upstream Immich pieces the upload flow
// touches. loginStatus selects the server generation:
//   - 404: Immich v2 (no /api/shared-links/login route)
//   - 401: Immich v3 (route exists; empty probe password is just wrong)
type uploadMockImmich struct {
	loginStatus    int
	albumAddStatus int
	albumAddCalls  atomic.Int32

	// Records the x-immich-checksum header seen on the upload POST (the
	// proxy must forward it verbatim so Immich's dedupe interceptor works).
	uploadChecksumMu sync.Mutex
	uploadChecksum   string
}

func (m *uploadMockImmich) server(t *testing.T) *httptest.Server {
	t.Helper()
	now := time.Now()

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/shared-links/login" && r.Method == http.MethodPost:
			w.WriteHeader(m.loginStatus)

		case r.URL.Path == "/api/shared-links/me":
			link := immich.SharedLink{
				ID:          testLinkID1,
				Key:         "valid-key",
				Type:        "ALBUM",
				AllowUpload: true,
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
			m.uploadChecksumMu.Lock()
			m.uploadChecksum = r.Header.Get("x-immich-checksum")
			m.uploadChecksumMu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(immich.UploadResponse{ID: testAssetID1})

		case r.URL.Path == "/api/albums/"+testAlbumID1+"/assets" && r.Method == http.MethodPut:
			m.albumAddCalls.Add(1)
			w.WriteHeader(m.albumAddStatus)
			w.Write([]byte(`{"error":"mock album add response"}`))

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func setupUploadTestHandler(t *testing.T, mockServer *httptest.Server) (*chi.Mux, *observer.ObservedLogs) {
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
		r.Post("/assets", handler.UploadAsset)
	})
	return r, logs
}

func postUpload(t *testing.T, router *chi.Mux) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/share/valid-key/assets", strings.NewReader("fake-image-bytes"))
	req.Header.Set("Content-Type", "image/jpeg")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestUploadForwardsChecksumHeader(t *testing.T) {
	// The client hashes files locally and sends x-immich-checksum; the proxy
	// must forward it verbatim so Immich can short-circuit duplicates before
	// the body is consumed.
	mock := &uploadMockImmich{loginStatus: http.StatusUnauthorized}
	server := mock.server(t)
	defer server.Close()

	router, _ := setupUploadTestHandler(t, server)

	const checksum = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	req := httptest.NewRequest(http.MethodPost, "/api/share/valid-key/assets", strings.NewReader("fake-image-bytes"))
	req.Header.Set("Content-Type", "image/jpeg")
	req.Header.Set("x-immich-checksum", checksum)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	mock.uploadChecksumMu.Lock()
	forwarded := mock.uploadChecksum
	mock.uploadChecksumMu.Unlock()
	if forwarded != checksum {
		t.Fatalf("expected checksum %q forwarded to Immich, got %q", checksum, forwarded)
	}
}

func TestUploadWithoutChecksumSendsNoHeader(t *testing.T) {
	mock := &uploadMockImmich{loginStatus: http.StatusUnauthorized}
	server := mock.server(t)
	defer server.Close()

	router, _ := setupUploadTestHandler(t, server)
	rec := postUpload(t, router)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	mock.uploadChecksumMu.Lock()
	forwarded := mock.uploadChecksum
	mock.uploadChecksumMu.Unlock()
	if forwarded != "" {
		t.Fatalf("expected no checksum header, got %q", forwarded)
	}
}

func TestUploadAlbumAddSkippedOnImmichV3(t *testing.T) {
	// v3: login endpoint exists → uploads are auto-associated with the album
	// upstream, so the proxy must not issue the explicit (403-answering) add.
	mock := &uploadMockImmich{loginStatus: http.StatusUnauthorized, albumAddStatus: http.StatusForbidden}
	server := mock.server(t)
	defer server.Close()

	router, logs := setupUploadTestHandler(t, server)
	rec := postUpload(t, router)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if calls := mock.albumAddCalls.Load(); calls != 0 {
		t.Fatalf("expected 0 album-add calls on Immich v3, got %d", calls)
	}
	if warns := logs.FilterLevelExact(zap.WarnLevel).Len(); warns != 0 {
		t.Fatalf("expected no warn logs on v3 skip, got %d", warns)
	}
}

func TestUploadAlbumAddPerformedOnImmichV2(t *testing.T) {
	// v2: no login endpoint → the explicit album add is still required.
	mock := &uploadMockImmich{loginStatus: http.StatusNotFound, albumAddStatus: http.StatusOK}
	server := mock.server(t)
	defer server.Close()

	router, logs := setupUploadTestHandler(t, server)
	rec := postUpload(t, router)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if calls := mock.albumAddCalls.Load(); calls != 1 {
		t.Fatalf("expected exactly 1 album-add call on Immich v2, got %d", calls)
	}
	if warns := logs.FilterLevelExact(zap.WarnLevel).Len(); warns != 0 {
		t.Fatalf("expected no warn logs on successful v2 add, got %d", warns)
	}
}

func TestUploadAlbumAdd403DowngradedToDebug(t *testing.T) {
	// Safety net: if the add is attempted anyway and answers 403, that is
	// Immich v3's "already auto-added" — a debug note, not a scary warn.
	// Simulated here with a v2-looking server (so the add happens) that
	// rejects the add with 403.
	mock := &uploadMockImmich{loginStatus: http.StatusNotFound, albumAddStatus: http.StatusForbidden}
	server := mock.server(t)
	defer server.Close()

	router, logs := setupUploadTestHandler(t, server)
	rec := postUpload(t, router)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if calls := mock.albumAddCalls.Load(); calls != 1 {
		t.Fatalf("expected 1 album-add call, got %d", calls)
	}
	if warns := logs.FilterLevelExact(zap.WarnLevel).Len(); warns != 0 {
		t.Fatalf("expected 403 album add to be logged at debug, found %d warn logs", warns)
	}
	found := false
	for _, entry := range logs.FilterLevelExact(zap.DebugLevel).All() {
		if strings.Contains(entry.Message, "403") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a debug log mentioning the 403 album add")
	}
}

func TestUploadAlbumAddGenuineFailureStillWarns(t *testing.T) {
	// A non-403 failure (e.g. upstream 500) is a real problem and must keep
	// its warn-level visibility.
	mock := &uploadMockImmich{loginStatus: http.StatusNotFound, albumAddStatus: http.StatusInternalServerError}
	server := mock.server(t)
	defer server.Close()

	router, logs := setupUploadTestHandler(t, server)
	rec := postUpload(t, router)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if warns := logs.FilterLevelExact(zap.WarnLevel).Len(); warns != 1 {
		t.Fatalf("expected exactly 1 warn log for a 500 album add, got %d", warns)
	}
}
