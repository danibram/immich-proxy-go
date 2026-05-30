package handlers

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/danibram/immich-proxy-go/internal/immich"
)

// TestSanitizeSharedLink_StripsOwnerPII makes sure we never leak the owner's
// email, name, avatar path, or internal IDs to anonymous share visitors.
// Regression guard for the "Album.Owner is returned raw" leak.
func TestSanitizeSharedLink_StripsOwnerPII(t *testing.T) {
	link := &immich.SharedLink{
		ID:       "link-id",
		Key:      "sharekey",
		Password: "serversidesecret",
		Token:    "internaltoken",
		UserID:   "internal-owner-user-id",
		Album: &immich.Album{
			ID:      "album-id",
			OwnerID: "internal-owner-user-id",
			Owner: &immich.User{
				ID:    "internal-owner-user-id",
				Email: "owner@private.example",
				Name:  "Owner Name",
			},
			AlbumUsers: []immich.AlbumUser{
				{User: immich.User{Email: "collab1@private.example"}},
				{User: immich.User{Email: "collab2@private.example"}},
			},
		},
	}

	sanitizeSharedLink(link, true)

	// Top-level secrets
	if link.Password != "" {
		t.Errorf("Password must be stripped, got %q", link.Password)
	}
	if link.Token != "" {
		t.Errorf("Token must be stripped, got %q", link.Token)
	}
	if link.UserID != "" {
		t.Errorf("UserID must be stripped, got %q", link.UserID)
	}

	// Album owner PII
	if link.Album.Owner != nil {
		t.Errorf("Album.Owner must be nil, got %+v", link.Album.Owner)
	}
	if link.Album.OwnerID != "" {
		t.Errorf("Album.OwnerID must be empty, got %q", link.Album.OwnerID)
	}
	if link.Album.AlbumUsers != nil {
		t.Errorf("Album.AlbumUsers must be nil, got %+v", link.Album.AlbumUsers)
	}

	// Serialize and double-check the JSON contains no emails.
	body, err := json.Marshal(link)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, forbidden := range []string{
		"owner@private.example",
		"collab1@private.example",
		"collab2@private.example",
		"Owner Name",
		"internal-owner-user-id",
		"serversidesecret",
		"internaltoken",
	} {
		if strings.Contains(string(body), forbidden) {
			t.Errorf("response leaks %q: %s", forbidden, body)
		}
	}
}

// TestSanitizeAsset_StripsInternalFields guards the "OriginalPath /
// DeviceID / Checksum leak via /api/shared-links/me" risk. These leak
// information about the Immich server's filesystem layout or the
// uploader's device.
func TestSanitizeAsset_StripsInternalFields(t *testing.T) {
	asset := immich.Asset{
		ID:            "asset-id",
		OriginalPath:  "/var/lib/immich/upload/xyz/secret.jpg",
		OwnerID:       "internal-owner",
		DeviceID:      "iphone-uuid",
		DeviceAssetID: "local-id",
		Checksum:      "deadbeef",
	}

	sanitizeAsset(&asset, true)

	if asset.OriginalPath != "" {
		t.Errorf("OriginalPath must be empty, got %q", asset.OriginalPath)
	}
	if asset.OwnerID != "" {
		t.Errorf("OwnerID must be empty, got %q", asset.OwnerID)
	}
	if asset.DeviceID != "" {
		t.Errorf("DeviceID must be empty, got %q", asset.DeviceID)
	}
	if asset.DeviceAssetID != "" {
		t.Errorf("DeviceAssetID must be empty, got %q", asset.DeviceAssetID)
	}
	if asset.Checksum != "" {
		t.Errorf("Checksum must be empty, got %q", asset.Checksum)
	}
}

// TestSanitizeAsset_DropsExifWhenMetadataDisabled - when show_metadata is
// off, the whole EXIF block and recognized-people list must go, not just
// GPS.
func TestSanitizeAsset_DropsExifWhenMetadataDisabled(t *testing.T) {
	asset := immich.Asset{
		ID: "asset-id",
		ExifInfo: &immich.ExifInfo{
			Make:      "Canon",
			Latitude:  37.7749,
			Longitude: -122.4194,
		},
		People: []immich.Person{
			{ID: "1", Name: "Alice"},
			{ID: "2", Name: "Bob"},
		},
	}

	sanitizeAsset(&asset, false)

	if asset.ExifInfo != nil {
		t.Errorf("ExifInfo must be nil when showMetadata is false")
	}
	if asset.People != nil {
		t.Errorf("People must be nil when showMetadata is false")
	}
}

// TestSanitizeAsset_ScrubsGPSEvenWhenMetadataEnabled is the core privacy
// guarantee: GPS coordinates are never exposed publicly, even when the
// operator opts in to metadata. Leaking precise coordinates of photos
// taken at home would be a serious safety issue.
func TestSanitizeAsset_ScrubsGPSEvenWhenMetadataEnabled(t *testing.T) {
	asset := immich.Asset{
		ID: "asset-id",
		ExifInfo: &immich.ExifInfo{
			Make:      "Canon",
			Model:     "EOS R5",
			Latitude:  37.7749,
			Longitude: -122.4194,
			City:      "San Francisco",
		},
	}

	sanitizeAsset(&asset, true)

	if asset.ExifInfo == nil {
		t.Fatalf("ExifInfo should be retained when showMetadata is true")
	}
	if asset.ExifInfo.Latitude != 0 {
		t.Errorf("Latitude must be zeroed, got %v", asset.ExifInfo.Latitude)
	}
	if asset.ExifInfo.Longitude != 0 {
		t.Errorf("Longitude must be zeroed, got %v", asset.ExifInfo.Longitude)
	}
	// Non-GPS metadata like camera model and city is allowed to remain;
	// the operator chose to enable metadata.
	if asset.ExifInfo.Make != "Canon" {
		t.Errorf("non-GPS EXIF should be preserved when metadata is on")
	}
}

// TestSanitizeSharedLink_NilSafety ensures the sanitizer does not panic on
// missing optional fields (Album nil, nil slices, etc.).
func TestSanitizeSharedLink_NilSafety(t *testing.T) {
	sanitizeSharedLink(nil, true)
	sanitizeSharedLink(&immich.SharedLink{}, false)
	sanitizeAlbum(nil, true)
	sanitizeAsset(nil, true)
}
