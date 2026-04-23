package immich

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client is an HTTP client for the Immich API
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a new Immich API client
func NewClient(baseURL string) *Client {
	// Ensure baseURL doesn't have trailing slash
	baseURL = strings.TrimSuffix(baseURL, "/")

	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// KeyType represents whether the identifier is a key or slug
type KeyType string

const (
	KeyTypeKey  KeyType = "key"
	KeyTypeSlug KeyType = "slug"
)

// GetSharedLink retrieves information about a shared link using its key or slug
func (c *Client) GetSharedLink(key string, password string) (*SharedLink, error) {
	return c.GetSharedLinkWithKeyType(key, password, KeyTypeKey)
}

// GetSharedLinkWithKeyType retrieves information about a shared link using its key or slug
func (c *Client) GetSharedLinkWithKeyType(key string, password string, keyType KeyType) (*SharedLink, error) {
	// Build URL with query parameters
	// keyType determines whether we use 'key' or 'slug' as the param name
	paramName := string(keyType) // "key" or "slug"
	reqURL := fmt.Sprintf("%s/api/shared-links/me?%s=%s", c.baseURL, paramName, url.QueryEscape(key))
	if password != "" {
		reqURL = fmt.Sprintf("%s&password=%s", reqURL, url.QueryEscape(password))
	}

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrSharedLinkNotFound
	}

	if resp.StatusCode == http.StatusUnauthorized {
		// Check if it's "Invalid share key" vs "Password required"
		body, _ := io.ReadAll(resp.Body)
		bodyStr := string(body)
		if strings.Contains(bodyStr, "Invalid share key") {
			return nil, ErrSharedLinkNotFound
		}
		if strings.Contains(bodyStr, "Invalid password") {
			return nil, ErrPasswordRequired
		}
		return nil, ErrPasswordRequired
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status code %d: %s", resp.StatusCode, string(body))
	}

	var link SharedLink
	if err := json.NewDecoder(resp.Body).Decode(&link); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &link, nil
}

// GetAlbum retrieves album information
func (c *Client) GetAlbum(albumID string, key string, password string) (*Album, error) {
	return c.GetAlbumWithKeyType(albumID, key, password, KeyTypeKey)
}

// GetAlbumWithKeyType retrieves album information with specified key type
func (c *Client) GetAlbumWithKeyType(albumID string, key string, password string, keyType KeyType) (*Album, error) {
	paramName := string(keyType)
	reqURL := fmt.Sprintf("%s/api/albums/%s?%s=%s", c.baseURL, albumID, paramName, url.QueryEscape(key))
	if password != "" {
		reqURL = fmt.Sprintf("%s&password=%s", reqURL, url.QueryEscape(password))
	}

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status code %d: %s", resp.StatusCode, string(body))
	}

	var album Album
	if err := json.NewDecoder(resp.Body).Decode(&album); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &album, nil
}

// GetAsset retrieves asset information (uses key by default)
func (c *Client) GetAsset(assetID string, key string, password string) (*Asset, error) {
	return c.GetAssetWithKeyType(assetID, key, password, KeyTypeKey)
}

// GetAssetWithKeyType retrieves asset information with explicit key type
func (c *Client) GetAssetWithKeyType(assetID string, key string, password string, keyType KeyType) (*Asset, error) {
	// Build query params
	query := url.Values{}
	if keyType == KeyTypeSlug {
		query.Set("slug", key)
	} else {
		query.Set("key", key)
	}
	if password != "" {
		query.Set("password", password)
	}

	reqURL := fmt.Sprintf("%s/api/assets/%s?%s", c.baseURL, assetID, query.Encode())

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Send both query params AND headers for maximum compatibility
	req.Header.Set("x-immich-share-key", key)
	if password != "" {
		req.Header.Set("x-immich-share-password", password)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	var asset Asset
	if err := json.NewDecoder(resp.Body).Decode(&asset); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &asset, nil
}

// ProxyRequest forwards an HTTP request to Immich and returns the response
func (c *Client) ProxyRequest(method, path string, query url.Values, headers http.Header, body io.Reader) (*http.Response, error) {
	// Build URL
	reqURL := fmt.Sprintf("%s%s", c.baseURL, path)
	if len(query) > 0 {
		reqURL = fmt.Sprintf("%s?%s", reqURL, query.Encode())
	}

	req, err := http.NewRequest(method, reqURL, body)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Copy relevant headers
	for key, values := range headers {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}

	return c.httpClient.Do(req)
}

// GetThumbnail retrieves an asset thumbnail
func (c *Client) GetThumbnail(assetID string, key string, password string, size string) (*http.Response, error) {
	return c.GetThumbnailWithKeyType(assetID, key, password, size, KeyTypeKey)
}

// GetThumbnailWithKeyType retrieves an asset thumbnail with specified key type
func (c *Client) GetThumbnailWithKeyType(assetID string, key string, password string, size string, keyType KeyType) (*http.Response, error) {
	path := fmt.Sprintf("/api/assets/%s/thumbnail", assetID)
	query := url.Values{}
	query.Set(string(keyType), key)
	if size != "" {
		query.Set("size", size)
	}
	if password != "" {
		query.Set("password", password)
	}

	return c.ProxyRequest("GET", path, query, nil, nil)
}

// GetOriginal retrieves the original asset file
func (c *Client) GetOriginal(assetID string, key string, password string) (*http.Response, error) {
	return c.GetOriginalWithKeyType(assetID, key, password, KeyTypeKey)
}

// GetOriginalWithKeyType retrieves the original asset file with specified key type
func (c *Client) GetOriginalWithKeyType(assetID string, key string, password string, keyType KeyType) (*http.Response, error) {
	path := fmt.Sprintf("/api/assets/%s/original", assetID)
	query := url.Values{}
	query.Set(string(keyType), key)
	if password != "" {
		query.Set("password", password)
	}

	return c.ProxyRequest("GET", path, query, nil, nil)
}

// GetVideo retrieves a video for playback
func (c *Client) GetVideo(assetID string, key string, password string) (*http.Response, error) {
	return c.GetVideoWithKeyType(assetID, key, password, KeyTypeKey)
}

// GetVideoWithKeyType retrieves a video for playback with specified key type
func (c *Client) GetVideoWithKeyType(assetID string, key string, password string, keyType KeyType) (*http.Response, error) {
	path := fmt.Sprintf("/api/assets/%s/video/playback", assetID)
	query := url.Values{}
	query.Set(string(keyType), key)
	if password != "" {
		query.Set("password", password)
	}

	return c.ProxyRequest("GET", path, query, nil, nil)
}

// UploadAsset uploads an asset via a shared link (uses key by default)
func (c *Client) UploadAsset(key string, password string, contentType string, body io.Reader) (*http.Response, error) {
	return c.UploadAssetWithKeyType(key, password, contentType, body, KeyTypeKey)
}

// UploadAssetWithKeyType uploads an asset via a shared link with explicit key type
func (c *Client) UploadAssetWithKeyType(key string, password string, contentType string, body io.Reader, keyType KeyType) (*http.Response, error) {
	path := "/api/assets"
	query := url.Values{}
	if keyType == KeyTypeSlug {
		query.Set("slug", key)
	} else {
		query.Set("key", key)
	}
	if password != "" {
		query.Set("password", password)
	}

	headers := http.Header{}
	headers.Set("Content-Type", contentType)
	headers.Set("x-immich-share-key", key)
	if password != "" {
		headers.Set("x-immich-share-password", password)
	}

	return c.ProxyRequest("POST", path, query, headers, body)
}

// AddAssetToAlbum adds an asset to an album using the shared link key (uses key by default)
func (c *Client) AddAssetToAlbum(albumID string, assetID string, key string, password string) error {
	return c.AddAssetToAlbumWithKeyType(albumID, assetID, key, password, KeyTypeKey)
}

// AddAssetToAlbumWithKeyType adds an asset to an album with explicit key type
func (c *Client) AddAssetToAlbumWithKeyType(albumID string, assetID string, key string, password string, keyType KeyType) error {
	path := fmt.Sprintf("/api/albums/%s/assets", albumID)
	query := url.Values{}
	if keyType == KeyTypeSlug {
		query.Set("slug", key)
	} else {
		query.Set("key", key)
	}
	if password != "" {
		query.Set("password", password)
	}

	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	headers.Set("x-immich-share-key", key)
	if password != "" {
		headers.Set("x-immich-share-password", password)
	}

	// SECURITY: build the JSON body with json.Marshal to guarantee proper
	// escaping. Using fmt.Sprintf with %s lets any quote/control char in
	// assetID break out of the JSON string and inject arbitrary fields or
	// extra asset IDs. assetID is normally a UUID (validated upstream)
	// but this function has no control over every caller, so we refuse
	// to trust that invariant here.
	payload := struct {
		IDs []string `json:"ids"`
	}{IDs: []string{assetID}}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to encode album payload: %w", err)
	}
	body := bytes.NewReader(bodyBytes)

	resp, err := c.ProxyRequest("PUT", path, query, headers, body)
	if err != nil {
		return fmt.Errorf("failed to add asset to album: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to add asset to album: status %d, body: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// Errors
var (
	ErrSharedLinkNotFound = fmt.Errorf("shared link not found")
	ErrPasswordRequired   = fmt.Errorf("password required")
)
