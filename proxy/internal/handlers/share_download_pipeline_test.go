package handlers

import (
	"archive/zip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/danibram/immich-proxy-go/internal/config"
	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func TestDownloadAssetsRejectsRequestWhenAnyAssetIsUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(immich.SharedLink{
			Type:          "INDIVIDUAL",
			AllowDownload: true,
			Assets:        []immich.Asset{{ID: testAssetID1, Type: "IMAGE"}},
		})
	}))
	defer server.Close()
	handler := newDownloadPipelineHandler(server)
	router := chi.NewRouter()
	router.Route("/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Post("/download", handler.DownloadAssets)
	})

	req := httptest.NewRequest(
		http.MethodPost,
		"/share/valid-key/download",
		strings.NewReader(`{"assetIds":["`+testAssetID1+`","`+testAssetID2+`"]}`),
	)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "requested assets are unavailable") {
		t.Fatalf("body = %q", rec.Body.String())
	}
}

func newDownloadPipelineHandler(server *httptest.Server) *ShareHandler {
	return newDownloadPipelineHandlerWithOptions(server, config.OptionsConfig{AllowDownload: true})
}

func newDownloadPipelineHandlerWithOptions(server *httptest.Server, options config.OptionsConfig) *ShareHandler {
	return NewShareHandler(
		immich.NewClient(server.URL),
		&config.Config{Options: options},
		zap.NewNop(),
		"test-secret",
	)
}

func TestProcessDownloadJobAppliesConfiguredImageQuality(t *testing.T) {
	requestedPath := ""
	requestedSize := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.Path
		requestedSize = r.URL.Query().Get("size")
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = io.WriteString(w, "resized-photo")
	}))
	defer server.Close()

	job := downloadJobManager.Create(1, "album.zip", "valid-key")
	defer downloadJobManager.Delete(job.ID)
	assets := map[string]*immich.Asset{
		testAssetID1: {ID: testAssetID1, Type: "IMAGE", OriginalFileName: "one.heic"},
	}
	handler := newDownloadPipelineHandlerWithOptions(server, config.OptionsConfig{
		AllowDownload:      true,
		MaxDownloadQuality: config.QualityPreview,
	})
	handler.processDownloadJob(job, []string{testAssetID1}, assets, "valid-key", "", immich.KeyTypeKey)

	got := downloadJobManager.Get(job.ID)
	if got == nil || got.Status != "ready" {
		t.Fatalf("quality-capped job = %+v", got)
	}
	if !strings.HasSuffix(requestedPath, "/thumbnail") || requestedSize != "preview" {
		t.Fatalf("path=%q size=%q", requestedPath, requestedSize)
	}
	reader, err := zip.OpenReader(got.FilePath)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	if len(reader.File) != 1 || reader.File[0].Name != "one.jpg" {
		t.Fatalf("ZIP entries = %+v", reader.File)
	}
}

func TestProcessDownloadJobFailsAtomicallyWhenAnyAssetFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, testAssetID2) {
			http.Error(w, "temporary upstream failure", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "photo-one")
	}))
	defer server.Close()

	job := downloadJobManager.Create(2, "album.zip", "valid-key")
	defer downloadJobManager.Delete(job.ID)

	assets := map[string]*immich.Asset{
		testAssetID1: {ID: testAssetID1, OriginalFileName: "one.jpg"},
		testAssetID2: {ID: testAssetID2, OriginalFileName: "two.jpg"},
	}

	newDownloadPipelineHandler(server).processDownloadJob(
		job,
		[]string{testAssetID1, testAssetID2},
		assets,
		"valid-key",
		"",
		immich.KeyTypeKey,
	)

	got := downloadJobManager.Get(job.ID)
	if got == nil {
		t.Fatal("download job disappeared")
	}
	if got.Status != "failed" {
		t.Fatalf("partial ZIP must fail atomically, got status %q", got.Status)
	}
	if got.FilePath != "" {
		t.Fatalf("failed job must not expose a partial ZIP, got %q", got.FilePath)
	}
}

func TestProcessDownloadJobRetriesTransientAssetFailure(t *testing.T) {
	var mu sync.Mutex
	attempts := map[string]int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assetID := testAssetID1
		if strings.Contains(r.URL.Path, testAssetID2) {
			assetID = testAssetID2
		}

		mu.Lock()
		attempts[assetID]++
		attempt := attempts[assetID]
		mu.Unlock()

		if assetID == testAssetID2 && attempt == 1 {
			http.Error(w, "retry me", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Content-Disposition", `inline; filename="`+assetID+`.jpg"`)
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, assetID)
	}))
	defer server.Close()

	job := downloadJobManager.Create(2, "album.zip", "valid-key")
	defer downloadJobManager.Delete(job.ID)

	assets := map[string]*immich.Asset{
		testAssetID1: {ID: testAssetID1, OriginalFileName: "one.jpg"},
		testAssetID2: {ID: testAssetID2, OriginalFileName: "two.jpg"},
	}

	newDownloadPipelineHandler(server).processDownloadJob(
		job,
		[]string{testAssetID1, testAssetID2},
		assets,
		"valid-key",
		"",
		immich.KeyTypeKey,
	)

	got := downloadJobManager.Get(job.ID)
	if got == nil || got.Status != "ready" {
		t.Fatalf("transient failure should recover, got job %+v", got)
	}
	mu.Lock()
	secondAttempts := attempts[testAssetID2]
	mu.Unlock()
	if secondAttempts != 2 {
		t.Fatalf("expected one retry for second asset, got %d attempts", secondAttempts)
	}

	reader, err := zip.OpenReader(got.FilePath)
	if err != nil {
		t.Fatalf("open completed ZIP: %v", err)
	}
	defer reader.Close()
	if len(reader.File) != 2 {
		t.Fatalf("completed ZIP must contain every requested asset, got %d entries", len(reader.File))
	}
}
