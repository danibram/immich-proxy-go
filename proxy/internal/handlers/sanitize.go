package handlers

import (
	"github.com/danibram/immich-proxy-go/internal/immich"
)

// sanitizeSharedLink strips sensitive and internal-only fields from a SharedLink
// before it is returned to the public. This prevents leaking information about
// the Immich instance, its owner, or other users.
//
// Fields removed:
//   - Password (server-only secret)
//   - Token    (server-only secret)
//   - UserID   (internal owner identifier)
//
// It also sanitizes the embedded Album and Assets.
func sanitizeSharedLink(link *immich.SharedLink, showMetadata bool) {
	if link == nil {
		return
	}
	link.Password = ""
	link.Token = ""
	link.UserID = ""

	if link.Album != nil {
		sanitizeAlbum(link.Album, showMetadata)
	}

	for i := range link.Assets {
		sanitizeAsset(&link.Assets[i], showMetadata)
	}
}

// sanitizeAlbum strips fields that would leak owner/user PII to anonymous
// visitors of a shared link.
//
// Fields removed or cleared:
//   - Owner (email, name, avatar path, profile path)
//   - OwnerID (internal identifier)
//   - AlbumUsers (other collaborators – their emails / names must never leak)
//   - Assets are sanitized in place
func sanitizeAlbum(album *immich.Album, showMetadata bool) {
	if album == nil {
		return
	}
	album.Owner = nil
	album.OwnerID = ""
	album.AlbumUsers = nil

	for i := range album.Assets {
		sanitizeAsset(&album.Assets[i], showMetadata)
	}
}

// sanitizeAsset strips fields that would either leak information about the
// Immich server (filesystem paths, device IDs, checksum) or the owner's other
// data. When showMetadata is false, EXIF metadata is stripped completely.
// When it is true, GPS coordinates are ALWAYS removed — the proxy never
// exposes precise location data to public visitors, even if the share link
// has "showMetadata" enabled on Immich.
func sanitizeAsset(asset *immich.Asset, showMetadata bool) {
	if asset == nil {
		return
	}

	// Server-internal / owner-linked identifiers must never leak
	asset.OriginalPath = ""
	asset.OwnerID = ""
	asset.DeviceID = ""
	asset.DeviceAssetID = ""
	asset.Checksum = ""
	asset.DuplicateID = nil

	// Face recognition data (names of recognized people) is PII.
	// Public share visitors must not learn who is in the photos unless
	// the Immich owner opted in by leaving showMetadata true, AND even
	// then we strip names of people who have no public name set.
	if !showMetadata {
		asset.People = nil
		asset.ExifInfo = nil
		return
	}

	// showMetadata=true: scrub highly sensitive EXIF fields regardless.
	if asset.ExifInfo != nil {
		// GPS coordinates are never safe to expose publicly.
		asset.ExifInfo.Latitude = 0
		asset.ExifInfo.Longitude = 0
	}
}

// sanitizeAlbumResponse is a convenience wrapper for the direct Album endpoint.
func sanitizeAlbumResponse(album *immich.Album, showMetadata bool) {
	sanitizeAlbum(album, showMetadata)
}
