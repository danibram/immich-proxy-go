package handlers

import (
	"embed"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"go.uber.org/zap"
)

const posthogInjectMarker = "</head>"

// StaticHandler serves static files from the web directory
type StaticHandler struct {
	webDir         string
	embedFS        *embed.FS
	fileServer     http.Handler
	logger         *zap.Logger
	posthogEnabled bool
}

// NewStaticHandler creates a new static file handler
// If webDir is provided and exists, it serves from disk
// Otherwise, it will use the embedded filesystem if provided
func NewStaticHandler(webDir string, embedFS *embed.FS, posthogEnabled bool, logger *zap.Logger) *StaticHandler {
	h := &StaticHandler{
		webDir:         webDir,
		embedFS:        embedFS,
		logger:         logger,
		posthogEnabled: posthogEnabled,
	}

	// Try to serve from disk first
	if webDir != "" {
		if info, err := os.Stat(webDir); err == nil && info.IsDir() {
			h.fileServer = http.FileServer(http.Dir(webDir))
			logger.Info("serving static files from disk", zap.String("dir", webDir))
			return h
		}
	}

	// Fall back to embedded filesystem
	if embedFS != nil {
		subFS, err := fs.Sub(*embedFS, "web/dist")
		if err != nil {
			logger.Warn("failed to create sub filesystem", zap.Error(err))
		} else {
			h.fileServer = http.FileServer(http.FS(subFS))
			logger.Info("serving static files from embedded filesystem")
		}
	}

	return h
}

// ServeHTTP serves static files
func (h *StaticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.fileServer == nil {
		http.Error(w, "Static files not configured", http.StatusNotFound)
		return
	}

	// Clean the path
	path := r.URL.Path

	// Remove /share/{key} or /s/{key} prefix to get the actual file path
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(parts) >= 2 && (parts[0] == "share" || parts[0] == "s") {
		// Skip "share"/"s" and the key, serve the rest
		if len(parts) > 2 {
			path = "/" + strings.Join(parts[2:], "/")
		} else {
			path = "/"
		}
	}

	// For root path, serve index.html
	if path == "/" || path == "" {
		h.serveIndexHTML(w, r)
		return
	}

	// Check if file exists (for disk-based serving)
	if h.webDir != "" {
		filePath := filepath.Join(h.webDir, path)
		if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
			// Set cache headers for static assets
			// Assets with hashes (js, css) can be cached for a long time
			h.setCacheHeaders(w, path)

			// File exists, serve it
			r.URL.Path = path
			h.fileServer.ServeHTTP(w, r)
			return
		}
	}

	// File doesn't exist, serve index.html for SPA routing
	h.serveIndexHTML(w, r)
}

// setCacheHeaders sets appropriate cache headers based on file type
func (h *StaticHandler) setCacheHeaders(w http.ResponseWriter, path string) {
	// Assets in /assets/ folder typically have content hashes and can be cached long
	// e.g., /assets/index-abc123.js, /assets/style-def456.css
	if strings.HasPrefix(path, "/assets/") {
		// Cache for 1 year (immutable content with hash in filename)
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		return
	}

	// For other static files (favicon, etc), cache for shorter time
	switch {
	case strings.HasSuffix(path, ".ico"):
		w.Header().Set("Cache-Control", "public, max-age=86400") // 1 day
	case strings.HasSuffix(path, ".png"), strings.HasSuffix(path, ".jpg"), strings.HasSuffix(path, ".svg"):
		w.Header().Set("Cache-Control", "public, max-age=86400") // 1 day
	default:
		// Default: short cache with revalidation
		w.Header().Set("Cache-Control", "public, max-age=3600, must-revalidate") // 1 hour
	}
}

// ServeIndex serves the index.html file directly
func (h *StaticHandler) ServeIndex(w http.ResponseWriter, r *http.Request) {
	h.serveIndexHTML(w, r)
}

func (h *StaticHandler) serveIndexHTML(w http.ResponseWriter, r *http.Request) {
	if h.webDir == "" {
		http.Error(w, "Static files not configured", http.StatusNotFound)
		return
	}

	filePath := filepath.Join(h.webDir, "index.html")
	content, err := os.ReadFile(filePath)
	if err != nil {
		h.logger.Error("failed to read index.html", zap.String("path", filePath), zap.Error(err))
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	html := injectPostHogFlag(string(content), h.posthogEnabled)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, must-revalidate")
	w.Header().Set("Content-Length", strconv.Itoa(len(html)))
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(html))
}

func injectPostHogFlag(html string, enabled bool) string {
	snippet := fmt.Sprintf(
		`<script>window.__IPP_POSTHOG_ENABLED__=%s</script>`+"\n",
		strconv.FormatBool(enabled),
	)
	if idx := strings.Index(html, posthogInjectMarker); idx != -1 {
		return html[:idx] + snippet + html[idx:]
	}
	return snippet + html
}

// serveFile serves a specific file from the web directory
func (h *StaticHandler) serveFile(w http.ResponseWriter, r *http.Request, filename string, contentType string) {
	if h.webDir == "" {
		http.Error(w, "Static files not configured", http.StatusNotFound)
		return
	}

	filePath := filepath.Join(h.webDir, filename)
	file, err := os.Open(filePath)
	if err != nil {
		h.logger.Error("failed to open file", zap.String("path", filePath), zap.Error(err))
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	defer file.Close()

	// Get file info for content length
	info, err := file.Stat()
	if err != nil {
		http.Error(w, "Failed to get file info", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))

	// index.html should not be cached (may change on deploy)
	if filename == "index.html" {
		w.Header().Set("Cache-Control", "no-cache, must-revalidate")
	}

	w.WriteHeader(http.StatusOK)

	io.Copy(w, file)
}
