package handlers

import (
	"archive/zip"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/dbr/immich-public-proxy/internal/config"
	"github.com/dbr/immich-public-proxy/internal/immich"
	"github.com/dbr/immich-public-proxy/internal/middleware"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// DownloadJob represents a ZIP download job
type DownloadJob struct {
	ID        string    `json:"id"`
	Status    string    `json:"status"` // "processing", "ready", "failed"
	Progress  int       `json:"progress"`
	Total     int       `json:"total"`
	Filename  string    `json:"filename,omitempty"`
	Error     string    `json:"error,omitempty"`
	FilePath  string    `json:"-"`
	CreatedAt time.Time `json:"-"`
	// ShareKey binds the job to the share that created it. Only requests
	// authenticated with the same share key can look up status or
	// download the resulting ZIP. This is defense-in-depth: the jobID is
	// already a 128-bit random value, but binding to the share key blocks
	// any cross-share information leak even if a job ID were to leak
	// (e.g. via logs).
	ShareKey string `json:"-"`
}

// DownloadJobManager manages download jobs
type DownloadJobManager struct {
	jobs  map[string]*DownloadJob
	mutex sync.RWMutex
}

// Global job manager
var downloadJobManager = &DownloadJobManager{
	jobs: make(map[string]*DownloadJob),
}

// activeJobCount returns the number of jobs that are currently processing.
// Ready/failed jobs do not count towards the concurrency limit — they live
// only until their temp files are cleaned up.
func (m *DownloadJobManager) activeJobCount() int {
	m.mutex.RLock()
	defer m.mutex.RUnlock()
	n := 0
	for _, j := range m.jobs {
		if j.Status == "processing" {
			n++
		}
	}
	return n
}

func (m *DownloadJobManager) Create(total int, filename, shareKey string) *DownloadJob {
	id := generateJobID()
	job := &DownloadJob{
		ID:        id,
		Status:    "processing",
		Progress:  0,
		Total:     total,
		Filename:  filename,
		CreatedAt: time.Now(),
		ShareKey:  shareKey,
	}
	m.mutex.Lock()
	m.jobs[id] = job
	m.mutex.Unlock()
	return job
}

func (m *DownloadJobManager) Get(id string) *DownloadJob {
	m.mutex.RLock()
	defer m.mutex.RUnlock()
	return m.jobs[id]
}

func (m *DownloadJobManager) Delete(id string) {
	m.mutex.Lock()
	if job, ok := m.jobs[id]; ok {
		if job.FilePath != "" {
			os.Remove(job.FilePath)
		}
		delete(m.jobs, id)
	}
	m.mutex.Unlock()
}

func (m *DownloadJobManager) UpdateProgress(id string, progress int) {
	m.mutex.Lock()
	if job, ok := m.jobs[id]; ok {
		job.Progress = progress
	}
	m.mutex.Unlock()
}

func (m *DownloadJobManager) SetReady(id string, filePath string) {
	m.mutex.Lock()
	if job, ok := m.jobs[id]; ok {
		job.Status = "ready"
		job.FilePath = filePath
		job.Progress = job.Total
	}
	m.mutex.Unlock()
}

func (m *DownloadJobManager) SetFailed(id string, err string) {
	m.mutex.Lock()
	if job, ok := m.jobs[id]; ok {
		job.Status = "failed"
		job.Error = err
	}
	m.mutex.Unlock()
}

// Cleanup old jobs (call periodically)
func (m *DownloadJobManager) Cleanup(maxAge time.Duration) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	now := time.Now()
	for id, job := range m.jobs {
		if now.Sub(job.CreatedAt) > maxAge {
			if job.FilePath != "" {
				os.Remove(job.FilePath)
			}
			delete(m.jobs, id)
		}
	}
}

func generateJobID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Allowed Content-Type prefixes for uploads
var allowedUploadPrefixes = []string{
	"image/",              // All image types (jpeg, png, heic, raw, etc.)
	"video/",              // All video types (mp4, mov, webm, etc.)
	"multipart/form-data", // For form uploads
}

// ShareHandler handles shared link requests
type ShareHandler struct {
	client       *immich.Client
	config       *config.Config
	logger       *zap.Logger
	cookieSecret []byte
}

// NewShareHandler creates a new share handler
func NewShareHandler(client *immich.Client, cfg *config.Config, logger *zap.Logger, cookieSecret string) *ShareHandler {
	return &ShareHandler{
		client:       client,
		config:       cfg,
		logger:       logger,
		cookieSecret: []byte(cookieSecret),
	}
}

// signPassword creates an HMAC signature for the password
func (h *ShareHandler) signPassword(password string) string {
	mac := hmac.New(sha256.New, h.cookieSecret)
	mac.Write([]byte(password))
	signature := mac.Sum(nil)
	return base64.URLEncoding.EncodeToString([]byte(password)) + "." + base64.URLEncoding.EncodeToString(signature)
}

// verifyPassword verifies and extracts the password from a signed cookie value
func (h *ShareHandler) verifyPassword(signedValue string) (string, error) {
	parts := strings.Split(signedValue, ".")
	if len(parts) != 2 {
		return "", errors.New("invalid cookie format")
	}

	passwordBytes, err := base64.URLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", errors.New("invalid password encoding")
	}

	signature, err := base64.URLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", errors.New("invalid signature encoding")
	}

	// Verify signature
	mac := hmac.New(sha256.New, h.cookieSecret)
	mac.Write(passwordBytes)
	expectedSig := mac.Sum(nil)

	if !hmac.Equal(signature, expectedSig) {
		return "", errors.New("invalid signature")
	}

	return string(passwordBytes), nil
}

// validateAssetInShare checks if an asset belongs to the shared link and is not trashed
func (h *ShareHandler) validateAssetInShare(link *immich.SharedLink, assetID string) bool {
	// Check in direct assets
	for _, asset := range link.Assets {
		if asset.ID == assetID && !asset.IsTrashed {
			return true
		}
	}

	// Check in album assets if this is an album share
	if link.Album != nil {
		for _, asset := range link.Album.Assets {
			if asset.ID == assetID && !asset.IsTrashed {
				return true
			}
		}
	}

	return false
}

// validateSharedLink validates common shared link conditions (expiration, etc.)
// Returns an error message and status code if validation fails, or empty string if OK
func (h *ShareHandler) validateSharedLink(link *immich.SharedLink) (string, int) {
	// Check if the shared link has expired
	if link.ExpiresAt != nil && link.ExpiresAt.Before(time.Now()) {
		return "Shared link has expired", http.StatusGone
	}

	return "", 0
}

// filterValidAssets returns only assets that are not trashed
func (h *ShareHandler) filterValidAssets(assets []immich.Asset) []immich.Asset {
	valid := make([]immich.Asset, 0, len(assets))
	for _, asset := range assets {
		if !asset.IsTrashed {
			valid = append(valid, asset)
		}
	}
	return valid
}

// isAllowedContentType checks if the content type is allowed for uploads
func isAllowedContentType(contentType string) bool {
	// Extract base content type (without parameters like boundary)
	baseType := contentType
	if idx := strings.Index(contentType, ";"); idx != -1 {
		baseType = strings.TrimSpace(contentType[:idx])
	}
	baseType = strings.ToLower(baseType)

	// Check against allowed prefixes
	for _, prefix := range allowedUploadPrefixes {
		if strings.HasPrefix(baseType, prefix) {
			return true
		}
	}
	return false
}

// getKeyType converts middleware.KeyType to immich.KeyType
func (h *ShareHandler) getKeyType(ctx context.Context) immich.KeyType {
	kt := middleware.GetKeyType(ctx)
	if kt == middleware.KeyTypeSlug {
		return immich.KeyTypeSlug
	}
	return immich.KeyTypeKey
}

// GetSharedLink returns information about a shared link
// For album shares, it automatically fetches the full album details to avoid a second request
func (h *ShareHandler) GetSharedLink(w http.ResponseWriter, r *http.Request) {
	key := middleware.GetShareKey(r.Context())
	password := middleware.GetPassword(r.Context())
	keyType := h.getKeyType(r.Context())

	link, err := h.client.GetSharedLinkWithKeyType(key, password, keyType)
	if err != nil {
		h.handleError(w, err)
		return
	}

	// Validate shared link (check expiration)
	if errMsg, statusCode := h.validateSharedLink(link); errMsg != "" {
		http.Error(w, errMsg, statusCode)
		return
	}

	// For album shares, fetch full album details (includes all assets)
	// This saves the frontend from making a second request
	if link.Type == "ALBUM" && link.Album != nil && link.Album.ID != "" {
		album, err := h.client.GetAlbumWithKeyType(link.Album.ID, key, password, keyType)
		if err != nil {
			h.logger.Warn("failed to fetch album details", zap.Error(err), zap.String("albumId", link.Album.ID))
			// Continue with partial album data from shared link
		} else {
			link.Album = album
		}
	}

	// Filter out trashed assets
	link.Assets = h.filterValidAssets(link.Assets)
	if link.Album != nil {
		link.Album.Assets = h.filterValidAssets(link.Album.Assets)
	}

	// Metadata visibility is restrictive: global proxy config can disable
	// metadata for every share, but cannot force-enable metadata when the
	// Immich shared link itself has showMetadata=false.
	// effectiveShowMetadata = proxy.show_metadata && sharedLink.showMetadata
	effectiveShowMetadata := h.config.Options.ShowMetadata && link.ShowMetadata

	// Strip sensitive/internal fields before exposing to the public.
	// This removes: password, token, owner email/name, user IDs,
	// Immich filesystem paths, device IDs, checksums, GPS coordinates,
	// and face-recognition people (when metadata is disabled).
	sanitizeSharedLink(link, effectiveShowMetadata)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(link)
}

// GetAlbum returns album information
func (h *ShareHandler) GetAlbum(w http.ResponseWriter, r *http.Request) {
	key := middleware.GetShareKey(r.Context())
	password := middleware.GetPassword(r.Context())
	keyType := h.getKeyType(r.Context())
	albumID := chi.URLParam(r, "albumID")

	// Validate UUID format
	if !middleware.IsValidUUID(albumID) {
		http.Error(w, "Invalid album ID format", http.StatusBadRequest)
		return
	}

	// First validate the shared link
	link, err := h.client.GetSharedLinkWithKeyType(key, password, keyType)
	if err != nil {
		h.handleError(w, err)
		return
	}

	// Validate shared link (check expiration)
	if errMsg, statusCode := h.validateSharedLink(link); errMsg != "" {
		http.Error(w, errMsg, statusCode)
		return
	}

	// Verify the album belongs to this shared link
	if link.Album == nil || link.Album.ID != albumID {
		http.Error(w, "Album not found in shared link", http.StatusNotFound)
		return
	}

	album, err := h.client.GetAlbumWithKeyType(albumID, key, password, keyType)
	if err != nil {
		h.handleError(w, err)
		return
	}

	// Filter out trashed assets
	album.Assets = h.filterValidAssets(album.Assets)

	// Metadata visibility is restrictive: global proxy config can disable
	// metadata for every share, but cannot force-enable metadata when the
	// Immich shared link itself has showMetadata=false.
	// effectiveShowMetadata = proxy.show_metadata && sharedLink.showMetadata
	effectiveShowMetadata := h.config.Options.ShowMetadata && link.ShowMetadata

	// Strip sensitive/internal fields before exposing to the public.
	sanitizeAlbumResponse(album, effectiveShowMetadata)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(album)
}

// GetThumbnail proxies thumbnail requests
func (h *ShareHandler) GetThumbnail(w http.ResponseWriter, r *http.Request) {
	key := middleware.GetShareKey(r.Context())
	password := middleware.GetPassword(r.Context())
	keyType := h.getKeyType(r.Context())
	assetID := chi.URLParam(r, "assetID")
	size := r.URL.Query().Get("size")

	// Validate UUID format
	if !middleware.IsValidUUID(assetID) {
		http.Error(w, "Invalid asset ID format", http.StatusBadRequest)
		return
	}

	// Validate size parameter
	if !middleware.IsValidThumbnailSize(size) {
		http.Error(w, "Invalid size parameter", http.StatusBadRequest)
		return
	}

	// Note: We trust Immich to validate that this asset belongs to the shared link
	// The share key query param ensures Immich only returns assets from the share
	// Doing IDOR validation here would require fetching the full album which is expensive

	resp, err := h.client.GetThumbnailWithKeyType(assetID, key, password, size, keyType)
	if err != nil {
		h.logger.Error("failed to get thumbnail", zap.Error(err))
		http.Error(w, "Failed to get thumbnail", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// Check if Immich returned an error (asset not in share, etc)
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusForbidden {
		http.Error(w, "Asset not found", http.StatusNotFound)
		return
	}

	h.proxyResponse(w, resp)
}

// GetOriginal proxies original file requests
func (h *ShareHandler) GetOriginal(w http.ResponseWriter, r *http.Request) {
	key := middleware.GetShareKey(r.Context())
	password := middleware.GetPassword(r.Context())
	keyType := h.getKeyType(r.Context())
	assetID := chi.URLParam(r, "assetID")

	// Validate UUID format
	if !middleware.IsValidUUID(assetID) {
		http.Error(w, "Invalid asset ID format", http.StatusBadRequest)
		return
	}

	// Check if download is allowed at proxy level
	if !h.config.Options.AllowDownload {
		http.Error(w, "Downloads are disabled", http.StatusForbidden)
		return
	}

	// Check if download is allowed at shared link level
	link, err := h.client.GetSharedLinkWithKeyType(key, password, keyType)
	if err != nil {
		h.handleError(w, err)
		return
	}
	if !link.AllowDownload {
		http.Error(w, "Downloads are disabled for this share", http.StatusForbidden)
		return
	}

	// Note: We trust Immich to validate that this asset belongs to the shared link
	// The share key query param ensures Immich only returns assets from the share

	resp, err := h.client.GetOriginalWithKeyType(assetID, key, password, keyType)
	if err != nil {
		h.logger.Error("failed to get original", zap.Error(err))
		http.Error(w, "Failed to get original file", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// Check if Immich returned an error (asset not in share, etc)
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusForbidden {
		http.Error(w, "Asset not found", http.StatusNotFound)
		return
	}

	h.proxyResponse(w, resp)
}

// GetVideo proxies video playback requests
func (h *ShareHandler) GetVideo(w http.ResponseWriter, r *http.Request) {
	key := middleware.GetShareKey(r.Context())
	password := middleware.GetPassword(r.Context())
	keyType := h.getKeyType(r.Context())
	assetID := chi.URLParam(r, "assetID")

	// Validate UUID format
	if !middleware.IsValidUUID(assetID) {
		http.Error(w, "Invalid asset ID format", http.StatusBadRequest)
		return
	}

	// Note: We trust Immich to validate that this asset belongs to the shared link
	// The share key query param ensures Immich only returns assets from the share

	resp, err := h.client.GetVideoWithKeyType(assetID, key, password, keyType)
	if err != nil {
		h.logger.Error("failed to get video", zap.Error(err))
		http.Error(w, "Failed to get video", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// Check if Immich returned an error (asset not in share, etc)
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusForbidden {
		http.Error(w, "Asset not found", http.StatusNotFound)
		return
	}

	h.proxyResponse(w, resp)
}

// UploadAsset handles file uploads via shared link
func (h *ShareHandler) UploadAsset(w http.ResponseWriter, r *http.Request) {
	key := middleware.GetShareKey(r.Context())
	password := middleware.GetPassword(r.Context())
	keyType := h.getKeyType(r.Context())

	// Apply upload size limit. We *always* wrap the body so a
	// mis-configured or 0/negative max_upload_size cannot be used to DoS
	// this process with an unbounded upload. If the operator wants truly
	// unlimited uploads they can set a very large number; the hard
	// fallback here is a generous 1 GiB which still beats unbounded.
	const fallbackMaxBytes int64 = 1024 * 1024 * 1024
	maxSize := h.config.Security.MaxUploadSize * 1024 * 1024 // MB -> bytes
	if maxSize <= 0 {
		maxSize = fallbackMaxBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSize)

	// First validate the shared link and check if upload is allowed
	link, err := h.client.GetSharedLinkWithKeyType(key, password, keyType)
	if err != nil {
		h.handleError(w, err)
		return
	}

	if !link.AllowUpload {
		http.Error(w, "Uploads are not allowed for this shared link", http.StatusForbidden)
		return
	}

	// Get album ID if this is an album share
	var albumID string
	if link.Type == "ALBUM" && link.Album != nil {
		albumID = link.Album.ID
	}

	// Get and validate content type
	contentType := r.Header.Get("Content-Type")
	if contentType == "" {
		http.Error(w, "Content-Type header required", http.StatusBadRequest)
		return
	}

	// Validate content type is an allowed image/video type
	if !isAllowedContentType(contentType) {
		http.Error(w, "Invalid file type. Only images and videos are allowed", http.StatusUnsupportedMediaType)
		return
	}

	// Upload the asset
	uploadResp, err := h.client.UploadAssetWithKeyType(key, password, contentType, r.Body, keyType)
	if err != nil {
		// Check if it's a size limit error
		if err.Error() == "http: request body too large" {
			http.Error(w, fmt.Sprintf("File too large. Maximum size is %d MB", h.config.Security.MaxUploadSize), http.StatusRequestEntityTooLarge)
			return
		}
		h.logger.Error("failed to upload asset", zap.Error(err))
		http.Error(w, "Failed to upload asset", http.StatusInternalServerError)
		return
	}
	defer uploadResp.Body.Close()

	// Read the upload response to get the asset ID
	uploadBody, err := io.ReadAll(uploadResp.Body)
	if err != nil {
		h.logger.Error("failed to read upload response", zap.Error(err))
		http.Error(w, "Failed to read upload response", http.StatusInternalServerError)
		return
	}

	// If upload was successful and we have an album ID, add the asset to the album
	if uploadResp.StatusCode == http.StatusCreated && albumID != "" {
		var uploadResult immich.UploadResponse
		if err := json.Unmarshal(uploadBody, &uploadResult); err == nil && uploadResult.ID != "" {
			// Add asset to album
			if err := h.client.AddAssetToAlbumWithKeyType(albumID, uploadResult.ID, key, password, keyType); err != nil {
				h.logger.Warn("failed to add asset to album", zap.Error(err), zap.String("assetId", uploadResult.ID))
				// Continue anyway - the upload was successful
			}
		}
	}

	// Return the original upload response
	for k, v := range uploadResp.Header {
		for _, vv := range v {
			w.Header().Add(k, vv)
		}
	}
	w.WriteHeader(uploadResp.StatusCode)
	w.Write(uploadBody)
}

// ValidatePassword validates a password for a shared link
func (h *ShareHandler) ValidatePassword(w http.ResponseWriter, r *http.Request) {
	key := middleware.GetShareKey(r.Context())
	keyType := h.getKeyType(r.Context())

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Limit password length to prevent DoS
	if len(req.Password) > 256 {
		http.Error(w, "Password too long", http.StatusBadRequest)
		return
	}

	_, err := h.client.GetSharedLinkWithKeyType(key, req.Password, keyType)
	if err != nil {
		if err == immich.ErrPasswordRequired {
			http.Error(w, "Invalid password", http.StatusUnauthorized)
			return
		}
		h.handleError(w, err)
		return
	}

	// Set signed password cookie
	signedPassword := h.signPassword(req.Password)

	// Decide whether to set the Secure attribute on the cookie. We must
	// strike a balance between "safe by default in production" and "works
	// on http://localhost in development":
	//   1. security.force_secure_cookies=true  -> always Secure (for admins
	//      behind a TLS-terminating reverse proxy who haven't set PublicURL)
	//   2. security.trust_proxy_headers and X-Forwarded-Proto=https -> Secure
	//   3. the request itself was on TLS -> Secure
	//   4. proxy.public_url starts with https:// -> Secure
	// Only when none of those hold do we send the cookie without Secure
	// (localhost/dev).
	isSecure := h.config.Security.ForceSecureCookies ||
		(h.config.Security.TrustProxyHeaders && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")) ||
		r.TLS != nil ||
		strings.HasPrefix(h.config.Proxy.PublicURL, "https://")

	http.SetCookie(w, &http.Cookie{
		Name:     "immich-share-password",
		Value:    signedPassword,
		Path:     "/",
		HttpOnly: true,
		Secure:   isSecure,
		SameSite: http.SameSiteStrictMode, // Strict: never sent on cross-site requests
		MaxAge:   86400,                   // 24 hours
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"valid": true})
}

// proxyResponse copies the response from Immich to the client
func (h *ShareHandler) proxyResponse(w http.ResponseWriter, resp *http.Response) {
	// Allowlist of headers to copy from upstream (safe headers only)
	// This prevents leaking sensitive info and hop-by-hop header issues
	allowedHeaders := map[string]bool{
		"Content-Type":        true,
		"Content-Length":      true,
		"Content-Disposition": true,
		"Content-Encoding":    true,
		"Content-Range":       true,
		"Accept-Ranges":       true,
		"Last-Modified":       true,
		"Etag":                true,
	}

	for key, values := range resp.Header {
		// Only copy allowed headers (case-insensitive check via http.CanonicalHeaderKey)
		if allowedHeaders[key] {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
	}

	// Share content should NOT be cached by proxies/browsers
	// This prevents accidental caching of private content
	// NoCache middleware already sets these headers, but we reinforce here
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, private")
	w.Header().Set("Pragma", "no-cache")

	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// handleError handles errors from the Immich client
func (h *ShareHandler) handleError(w http.ResponseWriter, err error) {
	switch err {
	case immich.ErrSharedLinkNotFound:
		http.Error(w, "Shared link not found or expired", http.StatusNotFound)
	case immich.ErrPasswordRequired:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]bool{"passwordRequired": true})
	default:
		h.logger.Error("immich client error", zap.Error(err))
		if strings.Contains(err.Error(), "status code 404") {
			http.Error(w, "Not found", http.StatusNotFound)
		} else {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
	}
}

// DownloadAssets initiates a ZIP download job and returns job ID for progress tracking
func (h *ShareHandler) DownloadAssets(w http.ResponseWriter, r *http.Request) {
	key := middleware.GetShareKey(r.Context())
	password := middleware.GetPassword(r.Context())
	keyType := h.getKeyType(r.Context())

	// Check if download is allowed
	if !h.config.Options.AllowDownload {
		http.Error(w, "Downloads are disabled", http.StatusForbidden)
		return
	}

	// Parse request body to get asset IDs
	var req struct {
		AssetIDs []string `json:"assetIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate we have at least 2 assets (otherwise use single download)
	if len(req.AssetIDs) < 2 {
		http.Error(w, "At least 2 assets required for bulk download", http.StatusBadRequest)
		return
	}

	// Validate all asset IDs are UUIDs
	for _, assetID := range req.AssetIDs {
		if !middleware.IsValidUUID(assetID) {
			http.Error(w, "Invalid asset ID format", http.StatusBadRequest)
			return
		}
	}

	// Get shared link info
	link, err := h.client.GetSharedLinkWithKeyType(key, password, keyType)
	if err != nil {
		h.handleError(w, err)
		return
	}

	// Check if download is allowed at shared link level
	if !link.AllowDownload {
		http.Error(w, "Downloads are disabled for this share", http.StatusForbidden)
		return
	}

	// Check expiration
	if errMsg, statusCode := h.validateSharedLink(link); errMsg != "" {
		http.Error(w, errMsg, statusCode)
		return
	}

	// For album shares, fetch full album details (includes all assets)
	if link.Type == "ALBUM" && link.Album != nil && link.Album.ID != "" {
		album, err := h.client.GetAlbumWithKeyType(link.Album.ID, key, password, keyType)
		if err != nil {
			h.logger.Warn("failed to fetch album for zip", zap.Error(err))
		} else {
			link.Album = album
		}
	}

	// Build a map of asset ID to asset info for quick lookup
	assetMap := make(map[string]*immich.Asset)
	for i := range link.Assets {
		assetMap[link.Assets[i].ID] = &link.Assets[i]
	}
	if link.Album != nil {
		for i := range link.Album.Assets {
			assetMap[link.Album.Assets[i].ID] = &link.Album.Assets[i]
		}
	}

	// Filter to only valid asset IDs
	var validAssetIDs []string
	for _, assetID := range req.AssetIDs {
		if asset, ok := assetMap[assetID]; ok && !asset.IsTrashed {
			validAssetIDs = append(validAssetIDs, assetID)
		}
	}

	if len(validAssetIDs) == 0 {
		http.Error(w, "No valid assets to download", http.StatusBadRequest)
		return
	}

	// Determine zip filename from album name
	zipFilename := "immich-download.zip"
	if link.Album != nil && link.Album.AlbumName != "" {
		safeName := sanitizeFilename(link.Album.AlbumName)
		if safeName != "" {
			zipFilename = safeName + ".zip"
		}
	}

	// Enforce max concurrent download jobs (disk-fill DoS protection).
	// Zero disables the cap for operators who explicitly opt out.
	if cap := h.config.Security.MaxConcurrentDownloadJobs; cap > 0 {
		if downloadJobManager.activeJobCount() >= cap {
			http.Error(w, "Too many active download jobs, try again later", http.StatusTooManyRequests)
			return
		}
	}

	// Create job, bound to the share key that created it.
	job := downloadJobManager.Create(len(validAssetIDs), zipFilename, key)

	h.logger.Info("starting zip job",
		zap.String("jobId", job.ID),
		zap.Int("assets", len(validAssetIDs)),
		zap.String("keyType", string(keyType)))

	// Process in background
	go h.processDownloadJob(job, validAssetIDs, assetMap, key, password, keyType)

	// Return job ID immediately
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"jobId": job.ID})
}

// processDownloadJob generates the ZIP file in the background
func (h *ShareHandler) processDownloadJob(job *DownloadJob, assetIDs []string, assetMap map[string]*immich.Asset, key, password string, keyType immich.KeyType) {
	// Create temp file
	tmpFile, err := os.CreateTemp("", "immich-download-*.zip")
	if err != nil {
		h.logger.Error("failed to create temp file", zap.Error(err))
		downloadJobManager.SetFailed(job.ID, "Failed to create temporary file")
		return
	}
	tmpPath := tmpFile.Name()

	// Create ZIP writer
	zipWriter := zip.NewWriter(tmpFile)
	usedFilenames := make(map[string]int)

	// Download each asset
	for i, assetID := range assetIDs {
		asset := assetMap[assetID]

		// Get original file
		resp, err := h.client.GetOriginalWithKeyType(assetID, key, password, keyType)
		if err != nil {
			h.logger.Warn("failed to get original", zap.Error(err), zap.String("assetId", assetID))
			continue
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			continue
		}

		// Determine filename
		filename := asset.OriginalFileName
		if filename == "" {
			filename = assetID + getExtensionForMimeType(asset.OriginalMimeType)
		}
		filename = getUniqueFilename(filename, usedFilenames)

		// Create ZIP entry
		zipEntry, err := zipWriter.Create(filename)
		if err != nil {
			resp.Body.Close()
			h.logger.Error("failed to create zip entry", zap.Error(err))
			continue
		}

		// Copy file to ZIP
		_, err = io.Copy(zipEntry, resp.Body)
		resp.Body.Close()
		if err != nil {
			h.logger.Error("failed to write to zip", zap.Error(err))
			continue
		}

		// Update progress
		downloadJobManager.UpdateProgress(job.ID, i+1)
	}

	// Finalize ZIP
	if err := zipWriter.Close(); err != nil {
		h.logger.Error("failed to close zip", zap.Error(err))
		tmpFile.Close()
		os.Remove(tmpPath)
		downloadJobManager.SetFailed(job.ID, "Failed to finalize ZIP")
		return
	}
	tmpFile.Close()

	// Mark as ready
	downloadJobManager.SetReady(job.ID, tmpPath)
	h.logger.Info("zip job completed", zap.String("jobId", job.ID), zap.Int("files", len(usedFilenames)))

	// Schedule cleanup after 10 minutes
	go func() {
		time.Sleep(10 * time.Minute)
		downloadJobManager.Delete(job.ID)
	}()
}

// jobBelongsToShare is a constant-time comparison of the current share key
// to the one that created the job. We intentionally use subtle.ConstantTimeCompare
// to avoid any timing-oracle that might help an attacker confirm whether
// a specific job ID exists for a different share.
func jobBelongsToShare(job *DownloadJob, shareKey string) bool {
	if job == nil || shareKey == "" {
		return false
	}
	a := []byte(job.ShareKey)
	b := []byte(shareKey)
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare(a, b) == 1
}

// GetDownloadJobStatus returns the status of a download job
func (h *ShareHandler) GetDownloadJobStatus(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "jobID")
	if jobID == "" {
		http.Error(w, "Job ID required", http.StatusBadRequest)
		return
	}
	if !isValidJobID(jobID) {
		http.Error(w, "Invalid job ID format", http.StatusBadRequest)
		return
	}

	job := downloadJobManager.Get(jobID)
	// Return a generic 404 whether the job does not exist OR belongs to
	// another share. We intentionally do not distinguish between the two
	// so that an attacker cannot enumerate job IDs across shares.
	if job == nil || !jobBelongsToShare(job, middleware.GetShareKey(r.Context())) {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

// DownloadJobFile serves the completed ZIP file
func (h *ShareHandler) DownloadJobFile(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "jobID")
	if jobID == "" {
		http.Error(w, "Job ID required", http.StatusBadRequest)
		return
	}
	if !isValidJobID(jobID) {
		http.Error(w, "Invalid job ID format", http.StatusBadRequest)
		return
	}

	job := downloadJobManager.Get(jobID)
	if job == nil || !jobBelongsToShare(job, middleware.GetShareKey(r.Context())) {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}

	if job.Status != "ready" {
		http.Error(w, "Job not ready", http.StatusConflict)
		return
	}

	// Serve the file. Filename is sanitized in DownloadAssets via
	// sanitizeFilename but we double-check here because it appears in
	// Content-Disposition which must not contain CR/LF or double quotes.
	safeName := sanitizeFilename(job.Filename)
	if safeName == "" {
		safeName = "immich-download.zip"
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, safeName))
	w.Header().Set("Cache-Control", "no-store")

	http.ServeFile(w, r, job.FilePath)
}

// isValidJobID checks that a job ID is exactly 32 lowercase hex characters,
// the format produced by generateJobID. This prevents path-traversal shaped
// job IDs from ever reaching the map and gives a cheap front-line filter
// against fuzzing.
func isValidJobID(id string) bool {
	if len(id) != 32 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// sanitizeFilename removes unsafe characters from a filename
func sanitizeFilename(name string) string {
	unsafe := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|", "\n", "\r"}
	result := name
	for _, char := range unsafe {
		result = strings.ReplaceAll(result, char, "_")
	}
	result = strings.Trim(result, " .")
	if len(result) > 100 {
		result = result[:100]
	}
	return result
}

// getUniqueFilename ensures filenames are unique in the ZIP
func getUniqueFilename(filename string, used map[string]int) string {
	if count, exists := used[filename]; exists {
		ext := filepath.Ext(filename)
		base := strings.TrimSuffix(filename, ext)
		filename = fmt.Sprintf("%s_%d%s", base, count+1, ext)
		used[filename] = count + 1
	} else {
		used[filename] = 1
	}
	return filename
}

// getExtensionForMimeType returns a file extension for a MIME type
func getExtensionForMimeType(mimeType string) string {
	extensions := map[string]string{
		"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
		"image/webp": ".webp", "image/heic": ".heic", "video/mp4": ".mp4",
		"video/quicktime": ".mov", "video/webm": ".webm",
	}
	if ext, ok := extensions[mimeType]; ok {
		return ext
	}
	return ""
}
