package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danibram/immich-proxy-go/internal/immich"
)

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
