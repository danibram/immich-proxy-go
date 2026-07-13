package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danibram/immich-proxy-go/internal/config"
	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func TestGetSharedLink_Success(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/valid-key/link", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d, body: %s", rec.Code, rec.Body.String())
	}

	var link immich.SharedLink
	if err := json.NewDecoder(rec.Body).Decode(&link); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if link.ID != testLinkID1 {
		t.Errorf("expected link ID '%s', got '%s'", testLinkID1, link.ID)
	}

	if link.Album.AlbumName != "Test Album" {
		t.Errorf("expected album name 'Test Album', got '%s'", link.Album.AlbumName)
	}

	if len(link.Assets) != 2 {
		t.Errorf("expected 2 assets, got %d", len(link.Assets))
	}
}

func TestGetSharedLink_RespectsMetadataFlags(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	tests := []struct {
		name       string
		key        string
		showConfig bool
		expectExif bool
	}{
		{
			name:       "metadata visible when both config and share enable it",
			key:        "valid-key",
			showConfig: true,
			expectExif: true,
		},
		{
			name:       "metadata hidden when config disables it",
			key:        "valid-key",
			showConfig: false,
			expectExif: false,
		},
		{
			name:       "metadata hidden when share disables it",
			key:        "metadata-off",
			showConfig: true,
			expectExif: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, router := setupTestHandlerWithOptions(t, mockServer, config.OptionsConfig{
				AllowDownload: true,
				ShowMetadata:  tc.showConfig,
			})

			req := httptest.NewRequest("GET", "/api/share/"+tc.key+"/link", nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("expected status 200, got %d, body: %s", rec.Code, rec.Body.String())
			}

			var link immich.SharedLink
			if err := json.NewDecoder(rec.Body).Decode(&link); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}
			if len(link.Album.Assets) == 0 {
				t.Fatalf("expected at least one album asset")
			}

			hasExif := link.Album.Assets[0].ExifInfo != nil
			if hasExif != tc.expectExif {
				t.Fatalf("unexpected EXIF visibility: expected %v, got %v", tc.expectExif, hasExif)
			}
		})
	}
}

func TestGetSharedLink_RespectsEffectiveAllowDownload(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	tests := []struct {
		name         string
		allowConfig  bool
		wantDownload bool
	}{
		{name: "download allowed when config and share enable it", allowConfig: true, wantDownload: true},
		{name: "download disabled when config disables it", allowConfig: false, wantDownload: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, router := setupTestHandlerWithOptions(t, mockServer, config.OptionsConfig{
				AllowDownload: tc.allowConfig,
				ShowMetadata:  true,
			})

			req := httptest.NewRequest("GET", "/api/share/valid-key/link", nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("expected status 200, got %d, body: %s", rec.Code, rec.Body.String())
			}

			var link immich.SharedLink
			if err := json.NewDecoder(rec.Body).Decode(&link); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}
			if link.AllowDownload != tc.wantDownload {
				t.Fatalf("AllowDownload: expected %v, got %v", tc.wantDownload, link.AllowDownload)
			}
		})
	}
}

func TestGetSharedLink_NotFound(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/expired-key/link", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", rec.Code)
	}
}

func TestGetSharedLink_UpstreamUnavailable(t *testing.T) {
	mockServer := MockImmichServer(t)
	mockURL := mockServer.URL
	mockServer.Close()

	client := immich.NewClient(mockURL)
	cfg := &config.Config{
		Options: config.OptionsConfig{
			AllowDownload: true,
			ShowMetadata:  true,
		},
		Security: config.SecurityConfig{
			MaxUploadSize: 100,
		},
	}
	testSecret := "test-secret-key-12345"
	handler := NewShareHandler(client, cfg, zap.NewNop(), testSecret)

	router := chi.NewRouter()
	router.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Get("/link", handler.GetSharedLink)
	})

	req := httptest.NewRequest("GET", "/api/share/valid-key/link", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502, got %d, body: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Unable to reach Immich upstream") {
		t.Fatalf("expected upstream error message, got %q", rec.Body.String())
	}
}

func TestGetSharedLink_PasswordRequired(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/password-protected/link", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rec.Code)
	}

	var response map[string]bool
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !response["passwordRequired"] {
		t.Error("expected passwordRequired to be true")
	}
}

func TestGetSharedLink_WithPassword(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/password-protected/link", nil)
	req.AddCookie(&http.Cookie{
		Name:  "immich-share-password",
		Value: signCookieValue("secret123", "test-secret-key-12345"),
	})
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}

	var link immich.SharedLink
	if err := json.NewDecoder(rec.Body).Decode(&link); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if link.Album.AlbumName != "Protected Album" {
		t.Errorf("expected album name 'Protected Album', got '%s'", link.Album.AlbumName)
	}
}

// TestGetAssetInfo_SanitizesMetadata covers the lazy asset-details endpoint
// the viewer uses on Immich v3 (album listings no longer include EXIF):
// metadata-on shares get EXIF with GPS always stripped; metadata-off shares
// get no EXIF at all; internal paths never leak.
func TestGetAssetInfo_SanitizesMetadata(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	t.Run("metadata on", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/share/valid-key/asset/"+testAssetID1, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var asset immich.Asset
		if err := json.NewDecoder(rec.Body).Decode(&asset); err != nil {
			t.Fatalf("failed to decode: %v", err)
		}
		if asset.OriginalFileName != "photo1.jpg" {
			t.Errorf("expected original filename, got %q", asset.OriginalFileName)
		}
		if asset.ExifInfo == nil || asset.ExifInfo.Make != "Canon" {
			t.Errorf("expected EXIF data, got %+v", asset.ExifInfo)
		}
		if asset.ExifInfo.Latitude != 0 || asset.ExifInfo.Longitude != 0 {
			t.Errorf("GPS coordinates must be stripped, got %v,%v", asset.ExifInfo.Latitude, asset.ExifInfo.Longitude)
		}
		if asset.OriginalPath != "" {
			t.Errorf("internal path must not leak, got %q", asset.OriginalPath)
		}
	})

	t.Run("metadata off", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/share/metadata-off/asset/"+testAssetID1, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var asset immich.Asset
		if err := json.NewDecoder(rec.Body).Decode(&asset); err != nil {
			t.Fatalf("failed to decode: %v", err)
		}
		if asset.ExifInfo != nil {
			t.Errorf("EXIF must be stripped when metadata is off, got %+v", asset.ExifInfo)
		}
	})

	t.Run("invalid asset id", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/share/valid-key/asset/not-a-uuid", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400 for invalid UUID, got %d", rec.Code)
		}
	})

	// An asset that does not belong to this share must return a clean 404,
	// not a 500 and not the upstream's raw error body (anti-enumeration +
	// no upstream-internal leakage).
	t.Run("foreign asset id", func(t *testing.T) {
		foreign := "11111111-2222-3333-4444-555555555555"
		req := httptest.NewRequest("GET", "/api/share/valid-key/asset/"+foreign, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("expected 404 for foreign asset, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}
