package handlers

import (
	"net/http/httptest"
	"testing"

	"github.com/danibram/immich-proxy-go/internal/config"
	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/danibram/immich-proxy-go/internal/sharecookie"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func signCookieValue(password, secret string) string {
	return sharecookie.Sign([]byte(secret), password)
}

func setupTestHandlerWithOptions(t *testing.T, mockServer *httptest.Server, options config.OptionsConfig) (*ShareHandler, *chi.Mux) {
	testSecret := "test-secret-key-12345"

	client := immich.NewClient(mockServer.URL)
	cfg := &config.Config{
		Options: options,
		Security: config.SecurityConfig{
			MaxUploadSize: 100,
		},
	}
	logger := zap.NewNop()

	middleware.CookieSecret = []byte(testSecret)

	handler := NewShareHandler(client, cfg, logger, testSecret)

	r := chi.NewRouter()
	r.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Get("/link", handler.GetSharedLink)
		r.Get("/album/{albumID}", handler.GetAlbum)
		r.Get("/asset/{assetID}", handler.GetAssetInfo)
		r.Get("/asset/{assetID}/thumbnail", handler.GetThumbnail)
		r.Get("/asset/{assetID}/original", handler.GetOriginal)
		r.Post("/validate-password", handler.ValidatePassword)
	})

	return handler, r
}

func setupTestHandler(t *testing.T, mockServer *httptest.Server) (*ShareHandler, *chi.Mux) {
	return setupTestHandlerWithOptions(t, mockServer, config.OptionsConfig{
		AllowDownload: true,
		ShowMetadata:  true,
	})
}
