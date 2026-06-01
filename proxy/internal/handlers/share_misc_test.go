package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danibram/immich-proxy-go/internal/config"
	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func TestMissingShareKey(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share//link", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Error("expected non-200 status when share key is missing")
	}
}

func BenchmarkGetSharedLink(b *testing.B) {
	testSecret := "test-secret-key-12345"
	middleware.CookieSecret = []byte(testSecret)

	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		link := immich.SharedLink{
			ID:        testLinkID1,
			Key:       "valid-key",
			Type:      "ALBUM",
			CreatedAt: time.Now(),
			Album: &immich.Album{
				ID:        testAlbumID1,
				AlbumName: "Test Album",
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(link)
	}))
	defer mockServer.Close()

	client := immich.NewClient(mockServer.URL)
	cfg := &config.Config{}
	logger := zap.NewNop()
	handler := NewShareHandler(client, cfg, logger, testSecret)

	r := chi.NewRouter()
	r.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Get("/link", handler.GetSharedLink)
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("GET", "/api/share/valid-key/link", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
	}
}

func printResponse(t *testing.T, rec *httptest.ResponseRecorder) {
	body, _ := io.ReadAll(rec.Body)
	t.Logf("Status: %d, Body: %s", rec.Code, string(body))
}

func TestMain(m *testing.M) {
	fmt.Println("Running API integration tests...")
	m.Run()
}
