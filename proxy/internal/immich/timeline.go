package immich

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Immich v3 removed the `assets` array from album and shared-link responses;
// clients are expected to enumerate assets through the timeline API instead.
// This file rebuilds the classic []Asset list from the columnar timeline
// responses so the rest of the proxy (and the web app) keeps working across
// Immich v2 and v3.

// timeBucketRef is one entry of GET /api/timeline/buckets.
type timeBucketRef struct {
	TimeBucket string `json:"timeBucket"`
	Count      int    `json:"count"`
}

// timeBucketAssets is the columnar response of GET /api/timeline/bucket.
// Every field is a parallel array indexed by asset position.
type timeBucketAssets struct {
	ID               []string   `json:"id"`
	IsImage          []bool     `json:"isImage"`
	IsFavorite       []bool     `json:"isFavorite"`
	IsTrashed        []bool     `json:"isTrashed"`
	Duration         []Duration `json:"duration"`
	FileCreatedAt    []string   `json:"fileCreatedAt"`
	LocalOffsetHours []float64  `json:"localOffsetHours"`
	Ratio            []float64  `json:"ratio"`
	Thumbhash        []*string  `json:"thumbhash"`
	LivePhotoVideoID []*string  `json:"livePhotoVideoId"`
	Visibility       []string   `json:"visibility"`
}

// fetchAlbumTimelineAssets rebuilds an album's asset list via the timeline API.
func (c *Client) fetchAlbumTimelineAssets(albumID string, key string, password string, keyType KeyType) ([]Asset, error) {
	baseQuery := url.Values{}
	baseQuery.Set("albumId", albumID)

	var buckets []timeBucketRef
	if err := c.getTimelineJSON("/api/timeline/buckets", baseQuery, key, password, keyType, &buckets); err != nil {
		return nil, fmt.Errorf("failed to list timeline buckets: %w", err)
	}

	var assets []Asset
	for _, bucket := range buckets {
		query := url.Values{}
		query.Set("albumId", albumID)
		query.Set("timeBucket", bucket.TimeBucket)

		var columns timeBucketAssets
		if err := c.getTimelineJSON("/api/timeline/bucket", query, key, password, keyType, &columns); err != nil {
			return nil, fmt.Errorf("failed to fetch timeline bucket %s: %w", bucket.TimeBucket, err)
		}
		assets = append(assets, columns.toAssets()...)
	}

	return assets, nil
}

func (c *Client) getTimelineJSON(path string, query url.Values, key string, password string, keyType KeyType, out any) error {
	resp, err := c.proxyShareRequest("GET", path, key, password, keyType, query, nil, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status code %d: %s", resp.StatusCode, string(body))
	}

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}
	return nil
}

// toAssets converts the columnar bucket payload into classic Asset objects.
// Missing per-column values (Immich omits some columns in edge cases) simply
// leave the corresponding Asset field at its zero value.
func (b *timeBucketAssets) toAssets() []Asset {
	assets := make([]Asset, 0, len(b.ID))
	for i, id := range b.ID {
		asset := Asset{
			ID:   id,
			Type: "VIDEO",
		}
		if boolAt(b.IsImage, i) {
			asset.Type = "IMAGE"
		}
		asset.IsFavorite = boolAt(b.IsFavorite, i)
		asset.IsTrashed = boolAt(b.IsTrashed, i)

		if created, ok := parseTimelineTime(stringAt(b.FileCreatedAt, i)); ok {
			asset.FileCreatedAt = created
			asset.LocalDateTime = created
		}
		if i < len(b.Thumbhash) && b.Thumbhash[i] != nil {
			asset.Thumbhash = *b.Thumbhash[i]
		}
		if i < len(b.LivePhotoVideoID) && b.LivePhotoVideoID[i] != nil {
			asset.LivePhotoVideoID = b.LivePhotoVideoID[i]
		}
		if i < len(b.Duration) {
			asset.Duration = b.Duration[i]
		}
		if ratio := floatAt(b.Ratio, i); ratio > 0 {
			asset.Ratio = ratio
		}
		assets = append(assets, asset)
	}
	return assets
}

// parseTimelineTime parses timeline timestamps, which come without a zone
// (e.g. "2026-07-06T10:27:13") or occasionally as full RFC3339.
func parseTimelineTime(value string) (time.Time, bool) {
	if value == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.999999999", "2006-01-02T15:04:05"} {
		if t, err := time.Parse(layout, value); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func boolAt(values []bool, i int) bool {
	return i < len(values) && values[i]
}

func stringAt(values []string, i int) string {
	if i < len(values) {
		return values[i]
	}
	return ""
}

func floatAt(values []float64, i int) float64 {
	if i < len(values) {
		return values[i]
	}
	return 0
}
