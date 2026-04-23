package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dbr/immich-public-proxy/internal/config"
	"github.com/dbr/immich-public-proxy/internal/immich"
	"github.com/dbr/immich-public-proxy/internal/middleware"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// signCookieValue builds a cookie value in the same HMAC+base64 format
// expected by the middleware, so tests can construct authentic password
// cookies without shelling out to the password-validation endpoint.
func signCookieValue(password, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(password))
	sig := mac.Sum(nil)
	return base64.URLEncoding.EncodeToString([]byte(password)) + "." +
		base64.URLEncoding.EncodeToString(sig)
}

// Test UUIDs - valid UUID format for testing
const (
	testLinkID1   = "11111111-1111-1111-1111-111111111111"
	testLinkID2   = "22222222-2222-2222-2222-222222222222"
	testLinkID3   = "33333333-3333-3333-3333-333333333333"
	testLinkID4   = "44444444-4444-4444-4444-444444444444"
	testAlbumID1  = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	testAlbumID2  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	testAlbumID3  = "cccccccc-cccc-cccc-cccc-cccccccccccc"
	testAlbumID4  = "12121212-1212-1212-1212-121212121212"
	testAssetID1  = "dddddddd-dddd-dddd-dddd-dddddddddddd"
	testAssetID2  = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
	testInvalidID = "ffffffff-ffff-ffff-ffff-ffffffffffff"
)

// MockImmichServer creates a test server that mocks Immich API responses
func MockImmichServer(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Get share key from query params (key or slug) or fallback to header
		shareKey := r.URL.Query().Get("key")
		if shareKey == "" {
			shareKey = r.URL.Query().Get("slug")
		}
		if shareKey == "" {
			shareKey = r.Header.Get("x-immich-share-key")
		}

		// Get password from query params or header
		sharePassword := r.URL.Query().Get("password")
		if sharePassword == "" {
			sharePassword = r.Header.Get("x-immich-share-password")
		}

		// Route based on path
		switch {
		case r.URL.Path == "/api/shared-links/me":
			handleMockSharedLink(w, r, shareKey, sharePassword)
		case strings.HasPrefix(r.URL.Path, "/api/albums/"):
			handleMockAlbum(w, r, shareKey)
		case strings.HasPrefix(r.URL.Path, "/api/assets/") && strings.HasSuffix(r.URL.Path, "/thumbnail"):
			handleMockThumbnail(w, r, shareKey)
		case strings.HasPrefix(r.URL.Path, "/api/assets/") && strings.HasSuffix(r.URL.Path, "/original"):
			handleMockOriginal(w, r, shareKey)
		case strings.HasPrefix(r.URL.Path, "/api/assets/"):
			handleMockAsset(w, r, shareKey)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func handleMockSharedLink(w http.ResponseWriter, r *http.Request, shareKey, sharePassword string) {
	now := time.Now()

	switch shareKey {
	case "valid-key":
		// Return a valid shared link
		link := immich.SharedLink{
			ID:            testLinkID1,
			Key:           shareKey,
			Type:          "ALBUM",
			AllowDownload: true,
			AllowUpload:   true,
			ShowMetadata:  true,
			CreatedAt:     now,
			Album: &immich.Album{
				ID:        testAlbumID1,
				AlbumName: "Test Album",
				CreatedAt: now,
				UpdatedAt: now,
				Assets: []immich.Asset{
					{
						ID:               testAssetID1,
						Type:             "IMAGE",
						OriginalFileName: "photo1.jpg",
						FileCreatedAt:    now,
						FileModifiedAt:   now,
						LocalDateTime:    now,
						UpdatedAt:        now,
						ExifInfo: &immich.ExifInfo{
							Make:           "Canon",
							FileSizeInByte: 12345,
						},
					},
					{ID: testAssetID2, Type: "VIDEO", OriginalFileName: "video1.mp4", Duration: "0:00:30.000000", FileCreatedAt: now, FileModifiedAt: now, LocalDateTime: now, UpdatedAt: now},
				},
			},
			Assets: []immich.Asset{
				{
					ID:               testAssetID1,
					Type:             "IMAGE",
					OriginalFileName: "photo1.jpg",
					FileCreatedAt:    now,
					FileModifiedAt:   now,
					LocalDateTime:    now,
					UpdatedAt:        now,
					ExifInfo: &immich.ExifInfo{
						Make:           "Canon",
						FileSizeInByte: 12345,
					},
				},
				{ID: testAssetID2, Type: "VIDEO", OriginalFileName: "video1.mp4", Duration: "0:00:30.000000", FileCreatedAt: now, FileModifiedAt: now, LocalDateTime: now, UpdatedAt: now},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(link)

	case "password-protected":
		if sharePassword != "secret123" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		link := immich.SharedLink{
			ID:            testLinkID2,
			Key:           shareKey,
			Type:          "ALBUM",
			AllowDownload: true,
			CreatedAt:     now,
			Album: &immich.Album{
				ID:        testAlbumID2,
				AlbumName: "Protected Album",
				CreatedAt: now,
				UpdatedAt: now,
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(link)

	case "no-download":
		link := immich.SharedLink{
			ID:            testLinkID3,
			Key:           shareKey,
			Type:          "ALBUM",
			AllowDownload: false,
			AllowUpload:   false,
			CreatedAt:     now,
			Album: &immich.Album{
				ID:        testAlbumID3,
				AlbumName: "View Only Album",
				CreatedAt: now,
				UpdatedAt: now,
			},
			Assets: []immich.Asset{
				{ID: testAssetID1, Type: "IMAGE", OriginalFileName: "photo1.jpg", FileCreatedAt: now, FileModifiedAt: now, LocalDateTime: now, UpdatedAt: now},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(link)

	case "metadata-off":
		link := immich.SharedLink{
			ID:            testLinkID4,
			Key:           shareKey,
			Type:          "ALBUM",
			AllowDownload: true,
			AllowUpload:   false,
			ShowMetadata:  false,
			CreatedAt:     now,
			Album: &immich.Album{
				ID:        testAlbumID4,
				AlbumName: "Metadata Off Album",
				CreatedAt: now,
				UpdatedAt: now,
				Assets: []immich.Asset{
					{
						ID:               testAssetID1,
						Type:             "IMAGE",
						OriginalFileName: "photo1.jpg",
						FileCreatedAt:    now,
						FileModifiedAt:   now,
						LocalDateTime:    now,
						UpdatedAt:        now,
						ExifInfo: &immich.ExifInfo{
							Make:           "Nikon",
							FileSizeInByte: 67890,
						},
					},
				},
			},
			Assets: []immich.Asset{
				{
					ID:               testAssetID1,
					Type:             "IMAGE",
					OriginalFileName: "photo1.jpg",
					FileCreatedAt:    now,
					FileModifiedAt:   now,
					LocalDateTime:    now,
					UpdatedAt:        now,
					ExifInfo: &immich.ExifInfo{
						Make:           "Nikon",
						FileSizeInByte: 67890,
					},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(link)

	case "expired-key":
		w.WriteHeader(http.StatusNotFound)

	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func handleMockAlbum(w http.ResponseWriter, r *http.Request, shareKey string) {
	albumID := strings.TrimPrefix(r.URL.Path, "/api/albums/")
	albumID = strings.Split(albumID, "/")[0]

	now := time.Now()

	if albumID == testAlbumID1 && shareKey == "valid-key" {
		album := immich.Album{
			ID:        testAlbumID1,
			AlbumName: "Test Album",
			CreatedAt: now,
			UpdatedAt: now,
			Assets: []immich.Asset{
				{
					ID:               testAssetID1,
					Type:             "IMAGE",
					OriginalFileName: "photo1.jpg",
					FileCreatedAt:    now,
					FileModifiedAt:   now,
					LocalDateTime:    now,
					UpdatedAt:        now,
					ExifInfo: &immich.ExifInfo{
						Make:           "Canon",
						FileSizeInByte: 12345,
					},
				},
				{ID: testAssetID2, Type: "VIDEO", OriginalFileName: "video1.mp4", FileCreatedAt: now, FileModifiedAt: now, LocalDateTime: now, UpdatedAt: now},
			},
			AssetCount: 2,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(album)
	} else if albumID == testAlbumID4 && shareKey == "metadata-off" {
		album := immich.Album{
			ID:        testAlbumID4,
			AlbumName: "Metadata Off Album",
			CreatedAt: now,
			UpdatedAt: now,
			Assets: []immich.Asset{
				{
					ID:               testAssetID1,
					Type:             "IMAGE",
					OriginalFileName: "photo1.jpg",
					FileCreatedAt:    now,
					FileModifiedAt:   now,
					LocalDateTime:    now,
					UpdatedAt:        now,
					ExifInfo: &immich.ExifInfo{
						Make:           "Nikon",
						FileSizeInByte: 67890,
					},
				},
			},
			AssetCount: 1,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(album)
	} else {
		w.WriteHeader(http.StatusNotFound)
	}
}

func handleMockAsset(w http.ResponseWriter, r *http.Request, shareKey string) {
	assetID := strings.TrimPrefix(r.URL.Path, "/api/assets/")
	assetID = strings.Split(assetID, "/")[0]

	now := time.Now()

	if assetID == testAssetID1 && shareKey == "valid-key" {
		asset := immich.Asset{
			ID:               testAssetID1,
			Type:             "IMAGE",
			OriginalFileName: "photo1.jpg",
			FileCreatedAt:    now,
			FileModifiedAt:   now,
			LocalDateTime:    now,
			UpdatedAt:        now,
			ExifInfo: &immich.ExifInfo{
				Make:        "Canon",
				Model:       "EOS R5",
				FocalLength: 50.0,
				FNumber:     1.8,
				ISO:         100,
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(asset)
	} else {
		w.WriteHeader(http.StatusNotFound)
	}
}

func handleMockThumbnail(w http.ResponseWriter, r *http.Request, shareKey string) {
	// Validate share key
	if shareKey != "valid-key" && shareKey != "no-download" && shareKey != "password-protected" {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	// Return a fake image
	w.Header().Set("Content-Type", "image/jpeg")
	w.Write([]byte{0xFF, 0xD8, 0xFF, 0xE0}) // Fake JPEG header
}

func handleMockOriginal(w http.ResponseWriter, r *http.Request, shareKey string) {
	// Validate share key
	if shareKey != "valid-key" && shareKey != "password-protected" {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	// Return a fake file
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Content-Disposition", "attachment; filename=photo1.jpg")
	w.Write([]byte{0xFF, 0xD8, 0xFF, 0xE0}) // Fake JPEG data
}

// Helper to setup the handler with a mock server
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

	// Set middleware cookie secret for tests
	middleware.CookieSecret = []byte(testSecret)

	handler := NewShareHandler(client, cfg, logger, testSecret)

	r := chi.NewRouter()

	// Setup routes with share key extraction
	r.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Get("/link", handler.GetSharedLink)
		r.Get("/album/{albumID}", handler.GetAlbum)
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

// Test: Get shared link successfully
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

// Test: Get shared link - not found
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

// Test: Get shared link - password required
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

// Test: Get shared link with correct password
func TestGetSharedLink_WithPassword(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/password-protected/link", nil)
	// SECURITY: only HMAC-signed cookies are accepted. Raw "secret123"
	// must be rejected even when it is the correct password.
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

// Test: Get album successfully
func TestGetAlbum_Success(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/valid-key/album/"+testAlbumID1, nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}

	var album immich.Album
	if err := json.NewDecoder(rec.Body).Decode(&album); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if album.AlbumName != "Test Album" {
		t.Errorf("expected album name 'Test Album', got '%s'", album.AlbumName)
	}

	if len(album.Assets) != 2 {
		t.Errorf("expected 2 assets, got %d", len(album.Assets))
	}
}

// Test: Get album - wrong album ID for share key
func TestGetAlbum_WrongAlbum(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/valid-key/album/"+testInvalidID, nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", rec.Code)
	}
}

func TestGetAlbum_RespectsMetadataFlags(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	tests := []struct {
		name       string
		key        string
		albumID    string
		showConfig bool
		expectExif bool
	}{
		{
			name:       "album metadata visible when both config and share enable it",
			key:        "valid-key",
			albumID:    testAlbumID1,
			showConfig: true,
			expectExif: true,
		},
		{
			name:       "album metadata hidden when config disables it",
			key:        "valid-key",
			albumID:    testAlbumID1,
			showConfig: false,
			expectExif: false,
		},
		{
			name:       "album metadata hidden when share disables it",
			key:        "metadata-off",
			albumID:    testAlbumID4,
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

			req := httptest.NewRequest("GET", "/api/share/"+tc.key+"/album/"+tc.albumID, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("expected status 200, got %d, body: %s", rec.Code, rec.Body.String())
			}

			var album immich.Album
			if err := json.NewDecoder(rec.Body).Decode(&album); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}
			if len(album.Assets) == 0 {
				t.Fatalf("expected at least one album asset")
			}

			hasExif := album.Assets[0].ExifInfo != nil
			if hasExif != tc.expectExif {
				t.Fatalf("unexpected EXIF visibility: expected %v, got %v", tc.expectExif, hasExif)
			}
		})
	}
}

// Test: Get thumbnail
func TestGetThumbnail_Success(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/valid-key/asset/"+testAssetID1+"/thumbnail", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}

	contentType := rec.Header().Get("Content-Type")
	if contentType != "image/jpeg" {
		t.Errorf("expected content-type 'image/jpeg', got '%s'", contentType)
	}
}

// Test: Get original - download allowed
func TestGetOriginal_Success(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	req := httptest.NewRequest("GET", "/api/share/valid-key/asset/"+testAssetID1+"/original", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}
}

// Test: Get original - download disabled in config
func TestGetOriginal_DownloadDisabled(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	client := immich.NewClient(mockServer.URL)
	cfg := &config.Config{
		Options: config.OptionsConfig{
			AllowDownload: false, // Disabled at proxy level
		},
	}
	logger := zap.NewNop()
	handler := NewShareHandler(client, cfg, logger, "test-secret-key-12345")

	r := chi.NewRouter()
	r.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Get("/asset/{assetID}/original", handler.GetOriginal)
	})

	req := httptest.NewRequest("GET", "/api/share/valid-key/asset/"+testAssetID1+"/original", nil)
	rec := httptest.NewRecorder()

	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", rec.Code)
	}
}

// Test: Validate password - correct
func TestValidatePassword_Correct(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	body := strings.NewReader(`{"password": "secret123"}`)
	req := httptest.NewRequest("POST", "/api/share/password-protected/validate-password", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}

	var response map[string]bool
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !response["valid"] {
		t.Error("expected valid to be true")
	}

	// Check cookie is set (now it's a signed cookie)
	cookies := rec.Result().Cookies()
	var foundCookie bool
	for _, c := range cookies {
		if c.Name == "immich-share-password" {
			// The cookie value is now signed (base64.password + "." + base64.signature)
			// Verify that the cookie is set and has a valid format
			if strings.Contains(c.Value, ".") {
				foundCookie = true
			}
			break
		}
	}
	if !foundCookie {
		t.Error("expected password cookie to be set with signed value")
	}
}

// Test: Validate password - incorrect
func TestValidatePassword_Incorrect(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	body := strings.NewReader(`{"password": "wrongpassword"}`)
	req := httptest.NewRequest("POST", "/api/share/password-protected/validate-password", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rec.Code)
	}
}

// Test: Missing share key
func TestMissingShareKey(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	// Request without key parameter (invalid route)
	req := httptest.NewRequest("GET", "/api/share//link", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	// Should get 404 as route won't match
	if rec.Code == http.StatusOK {
		t.Error("expected non-200 status when share key is missing")
	}
}

// Benchmark: Get shared link
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

// Test helper to print response body for debugging
func printResponse(t *testing.T, rec *httptest.ResponseRecorder) {
	body, _ := io.ReadAll(rec.Body)
	t.Logf("Status: %d, Body: %s", rec.Code, string(body))
}

func TestMain(m *testing.M) {
	// Run tests
	fmt.Println("Running API integration tests...")
	m.Run()
}
