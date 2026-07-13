package immich

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestGetAlbum_TimelineFallbackForImmichV3 covers the Immich v3 behavior where
// GET /api/albums/{id} returns assetCount > 0 but an empty assets array. The
// client must rebuild the list through the timeline API, mapping the columnar
// bucket payload back into classic Asset objects.
func TestGetAlbum_TimelineFallbackForImmichV3(t *testing.T) {
	albumID := "album-1"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("key") != "sharekey" {
			t.Errorf("missing share key on %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/albums/" + albumID:
			// Immich v3: no inline assets.
			w.Write([]byte(`{"id":"album-1","albumName":"A","assets":[],"assetCount":2}`))
		case "/api/timeline/buckets":
			if r.URL.Query().Get("albumId") != albumID {
				t.Errorf("buckets request missing albumId, got %q", r.URL.Query().Get("albumId"))
			}
			w.Write([]byte(`[{"timeBucket":"2026-07-01","count":2}]`))
		case "/api/timeline/bucket":
			if r.URL.Query().Get("timeBucket") != "2026-07-01" {
				t.Errorf("bucket request missing timeBucket, got %q", r.URL.Query().Get("timeBucket"))
			}
			w.Write([]byte(`{
				"id":["asset-img","asset-vid"],
				"isImage":[true,false],
				"isTrashed":[false,true],
				"isFavorite":[false,false],
				"duration":[null,90500],
				"fileCreatedAt":["2026-07-06T10:27:13","2026-07-05T08:00:00"],
				"ratio":[1.778,0.75],
				"thumbhash":["aGFzaA==",null],
				"livePhotoVideoId":[null,null],
				"visibility":["timeline","timeline"]
			}`))
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	album, err := NewClient(srv.URL).GetAlbumWithKeyType(albumID, "sharekey", "", KeyTypeKey)
	if err != nil {
		t.Fatalf("GetAlbumWithKeyType failed: %v", err)
	}

	if len(album.Assets) != 2 {
		t.Fatalf("expected 2 timeline assets, got %d", len(album.Assets))
	}

	img := album.Assets[0]
	if img.ID != "asset-img" || img.Type != "IMAGE" || img.IsTrashed {
		t.Errorf("unexpected image asset: %+v", img)
	}
	if img.Thumbhash != "aGFzaA==" {
		t.Errorf("thumbhash not mapped: %q", img.Thumbhash)
	}
	if img.FileCreatedAt.IsZero() || img.LocalDateTime.IsZero() {
		t.Errorf("timestamps not parsed: %+v", img)
	}
	if img.Ratio != 1.778 {
		t.Errorf("ratio not mapped: %v", img.Ratio)
	}
	if img.ExifInfo != nil {
		t.Errorf("timeline assets must not fabricate EXIF data: %+v", img.ExifInfo)
	}

	vid := album.Assets[1]
	if vid.Type != "VIDEO" || !vid.IsTrashed {
		t.Errorf("unexpected video asset: %+v", vid)
	}
	if vid.Duration != "0:01:30.500000" {
		t.Errorf("duration not converted from milliseconds: %q", vid.Duration)
	}
}

// TestGetAlbum_NoTimelineFallbackWhenAssetsInline ensures the v2 code path is
// untouched: when the album response carries assets, no timeline requests fire.
func TestGetAlbum_NoTimelineFallbackWhenAssetsInline(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/albums/album-1" {
			t.Errorf("unexpected request: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"album-1","assets":[{"id":"a1","type":"IMAGE"}],"assetCount":1}`))
	}))
	defer srv.Close()

	album, err := NewClient(srv.URL).GetAlbumWithKeyType("album-1", "sharekey", "", KeyTypeKey)
	if err != nil {
		t.Fatalf("GetAlbumWithKeyType failed: %v", err)
	}
	if len(album.Assets) != 1 || album.Assets[0].ID != "a1" {
		t.Errorf("inline assets should pass through unchanged: %+v", album.Assets)
	}
}

// TestDurationUnmarshal covers the duration formats across Immich versions:
// v2 sends "H:MM:SS.000000" strings, v3 sends numeric milliseconds or null —
// both in timeline buckets and inline on INDIVIDUAL share assets.
func TestDurationUnmarshal(t *testing.T) {
	cases := map[string]Duration{
		`null`:          "",
		`2000`:          "0:00:02.000000",
		`90500`:         "0:01:30.500000",
		`3661000`:       "1:01:01.000000",
		`"0:00:05.000"`: "0:00:05.000",
		`-5`:            "",
	}
	for raw, want := range cases {
		var got Duration
		if err := json.Unmarshal([]byte(raw), &got); err != nil {
			t.Errorf("Duration unmarshal of %s failed: %v", raw, err)
			continue
		}
		if got != want {
			t.Errorf("Duration unmarshal of %s = %q, want %q", raw, got, want)
		}
	}

	var invalid Duration
	if err := json.Unmarshal([]byte(`{"bad":1}`), &invalid); err == nil {
		t.Error("expected error for non-string non-number duration")
	}

	// Assets with v3 numeric durations must decode as part of a full payload
	// (this is exactly what INDIVIDUAL shares return inline).
	var asset Asset
	if err := json.Unmarshal([]byte(`{"id":"a","type":"VIDEO","duration":2000}`), &asset); err != nil {
		t.Fatalf("asset with numeric duration failed to decode: %v", err)
	}
	if asset.Duration != "0:00:02.000000" {
		t.Errorf("asset duration = %q, want 0:00:02.000000", asset.Duration)
	}
}
