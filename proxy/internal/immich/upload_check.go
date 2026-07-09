package immich

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
)

// AssetExistence is the verdict of a checksum probe: whether an asset with
// that checksum already exists in the share owner's library, and its id.
type AssetExistence struct {
	Exists  bool
	AssetID string
}

// probeMultipart builds the intentionally-invalid multipart body used by the
// checksum probe: a single assetData part whose filename has an extension
// Immich will never accept (.xyz). The body is only ever parsed when the
// checksum does NOT match — and then the file filter rejects it with 400
// before any asset is created.
func probeMultipart() (io.Reader, string, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("assetData", "probe.xyz")
	if err != nil {
		return nil, "", fmt.Errorf("failed to build probe multipart: %w", err)
	}
	if _, err := part.Write([]byte("x")); err != nil {
		return nil, "", fmt.Errorf("failed to build probe multipart: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, "", fmt.Errorf("failed to build probe multipart: %w", err)
	}
	return &buf, writer.FormDataContentType(), nil
}

// CheckAssetExistsByChecksum reports whether an asset with the given SHA-1
// checksum (hex or base64, as Immich accepts both) already exists in the
// share owner's library — WITHOUT uploading any file bytes.
//
// Technique (verified against Immich source at 2db1e02cdf): POST /api/assets
// runs AssetUploadInterceptor before body validation; when x-immich-checksum
// matches an existing asset it short-circuits to 200 {status:"duplicate", id}
// before the body is consumed. When it does not match, the multer fileFilter
// rejects our deliberately-invalid probe.xyz extension with 400 before
// creating anything. Both outcomes are cheap (a ~200-byte request) and
// side-effect free. The e2e suite pins this behavior against the running
// Immich version.
func (c *Client) CheckAssetExistsByChecksum(key string, password string, checksum string, keyType KeyType) (*AssetExistence, error) {
	body, contentType, err := probeMultipart()
	if err != nil {
		return nil, err
	}

	headers := http.Header{}
	headers.Set("Content-Type", contentType)
	headers.Set("x-immich-checksum", checksum)

	resp, err := c.proxyShareRequest("POST", "/api/assets", key, password, keyType, nil, headers, body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		// The interceptor answered: the checksum exists.
		var result UploadResponse
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			return nil, fmt.Errorf("checksum probe: failed to decode duplicate response: %w", err)
		}
		if result.Status == "duplicate" && result.ID != "" {
			return &AssetExistence{Exists: true, AssetID: result.ID}, nil
		}
		return nil, fmt.Errorf("checksum probe: unexpected 200 with status %q", result.Status)
	case http.StatusBadRequest:
		// The file filter rejected probe.xyz: no duplicate short-circuit
		// happened, so the checksum does not exist. Nothing was created.
		return &AssetExistence{Exists: false}, nil
	default:
		// 201 would mean Immich accepted a .xyz probe file (a server-side
		// behavior change that would make this probe unsafe) — treat it and
		// every other status as an error so callers fall back to uploading
		// with the checksum header, which dedupes anyway.
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("checksum probe: unexpected status %d: %s", resp.StatusCode, string(respBody))
	}
}
