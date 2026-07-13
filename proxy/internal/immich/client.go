package immich

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Client is an HTTP client for the Immich API
type Client struct {
	baseURL string
	// httpClient serves JSON/API calls. Its total Timeout is correct there:
	// no API response should take longer than 30s end to end.
	httpClient *http.Client
	// mediaClient serves streaming media (thumbnails, originals, video
	// playback, download staging). Go's http.Client.Timeout keeps counting
	// while the response body streams, so a total deadline would kill any
	// transfer that takes longer than it — a long video can never finish
	// through a 30s-total client. This client therefore has NO total timeout;
	// instead the transport bounds each phase that can hang (dial, TLS,
	// waiting for response headers), and the handlers' streaming copy aborts
	// on idle (no bytes for a while) rather than on wall clock.
	mediaClient *http.Client

	// Cache of Immich v3 shared-link auth tokens for password-protected
	// shares, keyed by keyType|key|password. See share_token.go.
	shareTokenMu sync.RWMutex
	shareTokens  map[string]shareTokenEntry

	// Cached probe of whether the upstream exposes /api/shared-links/login
	// (an Immich v3 marker). Server-wide, not per-share. See share_token.go.
	loginEndpointMu sync.Mutex
	loginEndpoint   *loginEndpointProbe
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
		mediaClient: &http.Client{
			// No total timeout: media bodies may legitimately stream for
			// minutes (see the field comment). Per-phase limits live in the
			// transport below.
			Timeout:   0,
			Transport: newMediaTransport(),
		},
		shareTokens: make(map[string]shareTokenEntry),
	}
}

// newMediaTransport bounds every phase of a media request that can hang
// without a total deadline killing healthy long transfers. MaxIdleConnsPerHost
// is raised well above Go's default of 2 because a gallery viewport easily
// fires dozens of concurrent thumbnail requests at the single Immich host, and
// with 2 idle slots the rest would re-dial (and re-TLS) every burst.
func newMediaTransport() *http.Transport {
	return &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		MaxIdleConns:          32,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       90 * time.Second,
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
	link, _, err := c.GetSharedLinkWithKeyTypeDroppedStalePassword(key, password, keyType)
	return link, err
}

// GetSharedLinkWithKeyTypeDroppedStalePassword is like GetSharedLinkWithKeyType but
// reports when a stale password cookie was dropped for a public share.
func (c *Client) GetSharedLinkWithKeyTypeDroppedStalePassword(key string, password string, keyType KeyType) (*SharedLink, bool, error) {
	link, err := c.getSharedLinkWithKeyType(key, password, keyType)

	// Immich v3 silently ignores passwords on public shares, so the request
	// succeeds — but the login probe already told us the link has no
	// password, which makes the supplied one a stale cookie worth clearing.
	if err == nil && password != "" && c.shareKnownPublic(key, password, keyType) {
		return link, true, nil
	}

	if err == nil || password == "" || !isStalePasswordOnPublicShareError(err) {
		return link, false, err
	}

	// Immich v2 signals the same condition with a 400 on the request itself.
	link, err = c.getSharedLinkWithKeyType(key, "", keyType)
	return link, err == nil, err
}

func (c *Client) getSharedLinkWithKeyType(key string, password string, keyType KeyType) (*SharedLink, error) {
	resp, err := c.proxyShareRequest("GET", "/api/shared-links/me", key, password, keyType, nil, nil, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrSharedLinkNotFound
	}

	if resp.StatusCode == http.StatusUnauthorized {
		// Check if it's "Invalid share key" vs "Password required"
		body, _ := io.ReadAll(resp.Body)
		bodyStr := string(body)
		normalizedBody := strings.ToLower(bodyStr)
		if strings.Contains(normalizedBody, "invalid share key") ||
			strings.Contains(normalizedBody, "invalid share slug") ||
			strings.Contains(normalizedBody, "shared link not found") {
			return nil, ErrSharedLinkNotFound
		}
		if strings.Contains(normalizedBody, "invalid password") ||
			strings.Contains(normalizedBody, "password required") {
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

// GetAlbumWithKeyType retrieves album information with specified key type
func (c *Client) GetAlbumWithKeyType(albumID string, key string, password string, keyType KeyType) (*Album, error) {
	album, err := c.getAlbumWithKeyType(albumID, key, password, keyType)
	if err == nil || password == "" || !isStalePasswordOnPublicShareError(err) {
		return album, err
	}

	return c.getAlbumWithKeyType(albumID, key, "", keyType)
}

func (c *Client) getAlbumWithKeyType(albumID string, key string, password string, keyType KeyType) (*Album, error) {
	path := fmt.Sprintf("/api/albums/%s", albumID)
	resp, err := c.proxyShareRequest("GET", path, key, password, keyType, nil, nil, nil)
	if err != nil {
		return nil, err
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

	// Immich v3 stopped returning the album's assets inline; rebuild the
	// list through the timeline API so galleries and downloads keep working.
	if len(album.Assets) == 0 && album.AssetCount > 0 {
		assets, err := c.fetchAlbumTimelineAssets(albumID, key, password, keyType)
		if err != nil {
			return nil, fmt.Errorf("album %s has %d assets but none inline and the timeline fallback failed: %w", albumID, album.AssetCount, err)
		}
		album.Assets = assets
	}

	return &album, nil
}

// GetAsset retrieves asset information (uses key by default)
func (c *Client) GetAsset(assetID string, key string, password string) (*Asset, error) {
	return c.GetAssetWithKeyType(assetID, key, password, KeyTypeKey)
}

// GetAssetWithKeyType retrieves asset information with explicit key type
func (c *Client) GetAssetWithKeyType(assetID string, key string, password string, keyType KeyType) (*Asset, error) {
	path := fmt.Sprintf("/api/assets/%s", assetID)
	resp, err := c.proxyShareRequest("GET", path, key, password, keyType, nil, nil, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		// Normalize the "asset not reachable through this share" family into
		// sentinels so handlers respond with consistent, non-leaking statuses.
		// Immich variously answers 400/403/404 for a foreign asset id.
		switch resp.StatusCode {
		case http.StatusUnauthorized:
			return nil, ErrPasswordRequired
		case http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound:
			return nil, ErrAssetNotFound
		}
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
	return c.proxyRequestWith(c.httpClient, method, path, query, headers, body)
}

// proxyRequestWith is ProxyRequest with an explicit http.Client, so media
// paths can use the streaming client (no total timeout) while JSON/API paths
// keep the hard 30s deadline.
func (c *Client) proxyRequestWith(client *http.Client, method, path string, query url.Values, headers http.Header, body io.Reader) (*http.Response, error) {
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

	resp, err := client.Do(req)
	if err != nil {
		return nil, wrapTransportError(err)
	}
	return resp, nil
}

// proxyShareRequest applies shared-link authentication as one atomic operation.
// Keeping the query parameter and matching header together prevents key/slug
// mismatches across individual client methods. For password-protected shares
// it additionally attaches the Immich v3 shared-link token cookie (see
// share_token.go); Immich v2 keeps working through the password parameter.
func (c *Client) proxyShareRequest(
	method string,
	path string,
	key string,
	password string,
	keyType KeyType,
	query url.Values,
	headers http.Header,
	body io.Reader,
) (*http.Response, error) {
	return c.proxyShareRequestWith(c.httpClient, method, path, key, password, keyType, query, headers, body)
}

// proxyShareMediaRequest is proxyShareRequest over the media client: same
// authentication handling, but no total timeout so long body streams
// (videos, originals) are never killed mid-transfer.
func (c *Client) proxyShareMediaRequest(
	method string,
	path string,
	key string,
	password string,
	keyType KeyType,
	query url.Values,
	headers http.Header,
	body io.Reader,
) (*http.Response, error) {
	return c.proxyShareRequestWith(c.mediaClient, method, path, key, password, keyType, query, headers, body)
}

func (c *Client) proxyShareRequestWith(
	client *http.Client,
	method string,
	path string,
	key string,
	password string,
	keyType KeyType,
	query url.Values,
	headers http.Header,
	body io.Reader,
) (*http.Response, error) {
	if headers == nil {
		headers = http.Header{}
	}
	headers.Del("Cookie")
	if password != "" {
		if token := c.sharedLinkToken(key, password, keyType); token != "" {
			headers.Set("Cookie", sharedLinkTokenCookie+"="+token)
		}
	}
	return c.proxyShareRequestWithoutTokenWith(client, method, path, key, password, keyType, query, headers, body)
}

// proxyShareRequestWithoutToken applies key/slug/password authentication but
// never attaches the shared-link token cookie. It exists so the token login
// call itself cannot recurse.
func (c *Client) proxyShareRequestWithoutToken(
	method string,
	path string,
	key string,
	password string,
	keyType KeyType,
	query url.Values,
	headers http.Header,
	body io.Reader,
) (*http.Response, error) {
	return c.proxyShareRequestWithoutTokenWith(c.httpClient, method, path, key, password, keyType, query, headers, body)
}

func (c *Client) proxyShareRequestWithoutTokenWith(
	client *http.Client,
	method string,
	path string,
	key string,
	password string,
	keyType KeyType,
	query url.Values,
	headers http.Header,
	body io.Reader,
) (*http.Response, error) {
	if query == nil {
		query = url.Values{}
	}
	if headers == nil {
		headers = http.Header{}
	}
	query.Del("key")
	query.Del("slug")
	query.Del("password")
	headers.Del("x-immich-share-key")
	headers.Del("x-immich-share-slug")
	headers.Del("x-immich-share-password")

	switch keyType {
	case KeyTypeKey:
		query.Set("key", key)
		headers.Set("x-immich-share-key", key)
	case KeyTypeSlug:
		query.Set("slug", key)
		headers.Set("x-immich-share-slug", key)
	default:
		return nil, fmt.Errorf("unsupported shared-link key type %q", keyType)
	}

	if password != "" {
		query.Set("password", password)
		headers.Set("x-immich-share-password", password)
	}

	return c.proxyRequestWith(client, method, path, query, headers, body)
}

// GetThumbnail retrieves an asset thumbnail
func (c *Client) GetThumbnail(assetID string, key string, password string, size string) (*http.Response, error) {
	return c.GetThumbnailWithKeyType(assetID, key, password, size, KeyTypeKey)
}

// GetThumbnailWithKeyType retrieves an asset thumbnail with specified key type
func (c *Client) GetThumbnailWithKeyType(assetID string, key string, password string, size string, keyType KeyType) (*http.Response, error) {
	path := fmt.Sprintf("/api/assets/%s/thumbnail", assetID)
	query := url.Values{}
	if size != "" {
		query.Set("size", size)
	}

	return c.proxyShareMediaRequest("GET", path, key, password, keyType, query, nil, nil)
}

// GetOriginal retrieves the original asset file
func (c *Client) GetOriginal(assetID string, key string, password string) (*http.Response, error) {
	return c.GetOriginalWithKeyType(assetID, key, password, KeyTypeKey)
}

// GetOriginalWithKeyType retrieves the original asset file with specified key type
func (c *Client) GetOriginalWithKeyType(assetID string, key string, password string, keyType KeyType) (*http.Response, error) {
	path := fmt.Sprintf("/api/assets/%s/original", assetID)
	return c.proxyShareMediaRequest("GET", path, key, password, keyType, nil, nil, nil)
}

// GetVideo retrieves a video for playback
func (c *Client) GetVideo(assetID string, key string, password string) (*http.Response, error) {
	return c.GetVideoWithKeyType(assetID, key, password, KeyTypeKey, "")
}

// GetVideoWithKeyType retrieves a video for playback with specified key type.
// rangeHeader, when non-empty, is the incoming request's Range header; it is
// forwarded so Immich can answer 206 Partial Content and browsers can seek
// without downloading the whole file.
func (c *Client) GetVideoWithKeyType(assetID string, key string, password string, keyType KeyType, rangeHeader string) (*http.Response, error) {
	path := fmt.Sprintf("/api/assets/%s/video/playback", assetID)
	var headers http.Header
	if rangeHeader != "" {
		headers = http.Header{}
		headers.Set("Range", rangeHeader)
	}
	return c.proxyShareMediaRequest("GET", path, key, password, keyType, nil, headers, nil)
}

// UploadAsset uploads an asset via a shared link (uses key by default)
func (c *Client) UploadAsset(key string, password string, contentType string, checksum string, body io.Reader) (*http.Response, error) {
	return c.UploadAssetWithKeyType(key, password, contentType, checksum, body, KeyTypeKey)
}

// UploadAssetWithKeyType uploads an asset via a shared link with explicit key
// type. checksum, when non-empty, is the client-computed SHA-1 of the file
// forwarded as x-immich-checksum: Immich's upload interceptor uses it to
// answer 200 {status:"duplicate"} before consuming the body when the asset
// already exists in the link owner's library.
func (c *Client) UploadAssetWithKeyType(key string, password string, contentType string, checksum string, body io.Reader, keyType KeyType) (*http.Response, error) {
	path := "/api/assets"
	headers := http.Header{}
	headers.Set("Content-Type", contentType)
	if checksum != "" {
		headers.Set("x-immich-checksum", checksum)
	}

	return c.proxyShareRequest("POST", path, key, password, keyType, nil, headers, body)
}

// AddAssetToAlbum adds an asset to an album using the shared link key (uses key by default)
func (c *Client) AddAssetToAlbum(albumID string, assetID string, key string, password string) error {
	return c.AddAssetToAlbumWithKeyType(albumID, assetID, key, password, KeyTypeKey)
}

// AddAssetToAlbumWithKeyType adds an asset to an album with explicit key type
func (c *Client) AddAssetToAlbumWithKeyType(albumID string, assetID string, key string, password string, keyType KeyType) error {
	path := fmt.Sprintf("/api/albums/%s/assets", albumID)
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")

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

	resp, err := c.proxyShareRequest("PUT", path, key, password, keyType, nil, headers, body)
	if err != nil {
		return fmt.Errorf("failed to add asset to album: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return &AlbumAddError{StatusCode: resp.StatusCode, Body: string(respBody)}
	}

	return nil
}

func isStalePasswordOnPublicShareError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	// Only retry without password when Immich explicitly says the link is
	// public. Never drop the password on 5xx — that can bypass protection
	// if upstream is flaky or returns inconsistent auth errors.
	return strings.Contains(msg, "unexpected status code 400") &&
		strings.Contains(msg, "shared link is not password protected")
}

// Errors
var (
	ErrSharedLinkNotFound = fmt.Errorf("shared link not found")
	ErrPasswordRequired   = fmt.Errorf("password required")
	// ErrAssetNotFound means the asset is not reachable through this shared
	// link — it does not belong to the share, or does not exist. The two are
	// deliberately indistinguishable to avoid asset-ID enumeration.
	ErrAssetNotFound = fmt.Errorf("asset not found")
)
