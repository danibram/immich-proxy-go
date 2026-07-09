package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/danibram/immich-proxy-go/internal/config"
	"github.com/danibram/immich-proxy-go/internal/handlers"
	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func main() {
	// Parse command line flags
	configPath := flag.String("config", "", "Path to config file")
	webDir := flag.String("web-dir", "./web/dist", "Path to web static files directory")
	flag.Parse()

	// Initialize logger
	logConfig := zap.NewProductionConfig()
	logConfig.EncoderConfig.TimeKey = "timestamp"
	logConfig.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder

	logger, err := logConfig.Build()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	// Load configuration
	cfg, err := config.Load(*configPath)
	if err != nil {
		logger.Fatal("Failed to load configuration", zap.Error(err))
	}

	// Generate cookie secret if not provided
	cookieSecret := cfg.Security.CookieSecret
	if cookieSecret == "" {
		secretBytes := make([]byte, 32)
		if _, err := rand.Read(secretBytes); err != nil {
			logger.Fatal("Failed to generate cookie secret", zap.Error(err))
		}
		cookieSecret = hex.EncodeToString(secretBytes)
		logger.Warn("No cookie secret configured, using auto-generated secret (cookies won't persist across restarts)")
	}

	// Set cookie secret for middleware
	middleware.CookieSecret = []byte(cookieSecret)

	// Propagate the trust_proxy_headers flag into the middleware package.
	// Safe default is false: without it, clients cannot spoof their IP
	// via X-Forwarded-For / X-Real-IP to bypass rate limiting.
	middleware.TrustProxyHeaders = cfg.Security.TrustProxyHeaders

	logger.Info("Configuration loaded",
		zap.String("immich_url", cfg.Immich.URL),
		zap.Int("port", cfg.Proxy.Port),
		zap.Int("rate_limit", cfg.Security.RateLimit),
		zap.Int("password_rate_limit", cfg.Security.PasswordRateLimit),
		zap.Int64("max_upload_size_mb", cfg.Security.MaxUploadSize),
		zap.Bool("trust_proxy_headers", cfg.Security.TrustProxyHeaders),
		zap.Bool("force_secure_cookies", cfg.Security.ForceSecureCookies),
	)

	if cfg.Security.TrustProxyHeaders {
		logger.Warn("trust_proxy_headers is enabled - ensure this instance ONLY receives traffic through a trusted reverse proxy that strips/replaces X-Forwarded-For")
	}

	cfg.Analytics.PostHog.Normalize()
	if cfg.Analytics.PostHog.Enabled && !cfg.Analytics.PostHog.Active() {
		logger.Warn("analytics.posthog.enabled is true but api_key is empty; PostHog will not initialize")
	}

	posthogCSP := cfg.Analytics.PostHog.CSPDirective()

	// Create Immich client
	client := immich.NewClient(cfg.Immich.URL)

	// Create rate limiters
	generalLimiter := middleware.NewRateLimiter(cfg.Security.RateLimit, time.Minute, logger)
	passwordLimiter := middleware.NewRateLimiter(cfg.Security.PasswordRateLimit, time.Minute, logger)

	// Create handlers
	shareHandler := handlers.NewShareHandler(client, cfg, logger, cookieSecret)
	staticHandler := handlers.NewStaticHandler(*webDir, nil, cfg.Analytics.PostHog, cfg.Options.CacheTTL, logger)

	// Create router
	r := chi.NewRouter()

	// Global middleware
	r.Use(chiMiddleware.RequestID)
	// chiMiddleware.RealIP rewrites r.RemoteAddr from X-Forwarded-For /
	// X-Real-IP. Only enable it when the operator has opted in to trusting
	// those headers, otherwise any client could spoof their IP.
	if cfg.Security.TrustProxyHeaders {
		r.Use(chiMiddleware.RealIP)
	}
	r.Use(middleware.Logger(logger))
	r.Use(middleware.Recovery(logger))
	// Use the configurable security headers so operators can enable HSTS
	// via config without editing code.
	r.Use(middleware.SecurityHeadersWithConfig(middleware.SecureHeadersConfig{
		EnableHSTS: cfg.Security.EnableHSTS,
		PostHog:    posthogCSP,
	}))
	// Note: Rate limiting is applied per-route, not globally
	// Thumbnails are excluded to allow smooth scrolling of large albums
	r.Use(chiMiddleware.Compress(5))

	// CORS configuration
	// IMPORTANT: In production with a reverse proxy, you SHOULD configure
	// security.allowed_origins or proxy.public_url explicitly
	corsOptions := cors.Options{
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Immich-Share-Key", "X-Immich-Share-Password"},
		ExposedHeaders:   []string{"Content-Length", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}

	if len(cfg.Security.AllowedOrigins) > 0 {
		// Explicit allowlist - most secure option
		corsOptions.AllowedOrigins = cfg.Security.AllowedOrigins
		logger.Info("CORS configured with explicit allowed origins",
			zap.Strings("origins", cfg.Security.AllowedOrigins))
	} else if cfg.Proxy.PublicURL != "" {
		// Use public URL as single allowed origin
		corsOptions.AllowedOrigins = []string{cfg.Proxy.PublicURL}
		logger.Info("CORS configured with public URL origin",
			zap.String("origin", cfg.Proxy.PublicURL))
	} else {
		// Fallback: reject all cross-origin requests (safest default)
		// This effectively disables CORS - only same-origin requests will work
		logger.Warn("No CORS origins configured - cross-origin requests will be rejected. " +
			"Configure security.allowed_origins or proxy.public_url for production use.")
		corsOptions.AllowOriginFunc = func(r *http.Request, origin string) bool {
			// Reject all cross-origin requests when not configured
			// Same-origin requests don't send Origin header, so this is safe
			return false
		}
	}
	r.Use(cors.Handler(corsOptions))

	// Health check
	r.Get("/healthcheck", handlers.HealthCheck())
	r.Get("/health", handlers.HealthCheck())

	// Share routes - both /share/{key} and /s/{key} (slug) formats
	shareRoutes := func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Use(middleware.ValidateShareKey) // Validate share key format
		r.Use(middleware.NoCache)
		r.Use(middleware.NoIndex) // Keep shared albums out of search engines

		// API endpoints
		r.Route("/api", func(r chi.Router) {
			// Hotlink protection - blocks direct URL access to API endpoints
			// When enabled, requests must come from the web app (checked via Sec-Fetch-* headers)
			if cfg.Security.HotlinkProtection {
				r.Use(middleware.HotlinkProtection(cfg.Proxy.PublicURL))
			}

			// Rate-limited endpoints (API calls that could be abused)
			r.Group(func(r chi.Router) {
				r.Use(generalLimiter.Limit)

				// Shared link info
				r.Get("/shared-links/me", shareHandler.GetSharedLink)

				// Albums
				r.Get("/albums/{albumID}", shareHandler.GetAlbum)

				// Asset details (EXIF/filename) — fetched lazily by the viewer
				// because Immich v3 album listings no longer include them
				r.Get("/assets/{assetID}", shareHandler.GetAssetInfo)

				// Downloads and uploads
				r.Get("/assets/{assetID}/original", shareHandler.GetOriginal)
				r.Get("/assets/{assetID}/video/playback", shareHandler.GetVideo)
				r.Post("/assets/download", shareHandler.DownloadAssets)
				r.Get("/download/jobs/{jobID}", shareHandler.GetDownloadJobStatus)
				r.Get("/download/jobs/{jobID}/file", shareHandler.DownloadJobFile)
				r.Post("/assets", shareHandler.UploadAsset)
				// Pre-upload dedupe: which checksums already exist upstream
				r.Post("/upload-check", shareHandler.UploadCheck)
			})

			// Password validation with strict rate limiting
			r.With(passwordLimiter.Limit).Post("/shared-links/me/password", shareHandler.ValidatePassword)

			// Thumbnails - NO rate limiting (needed for smooth scrolling)
			r.Get("/assets/{assetID}/thumbnail", shareHandler.GetThumbnail)
			// Extensioned variant (thumbnail.webp / thumbnail.jpg) so CDNs with
			// extension-based cache eligibility (Cloudflare default) edge-cache
			// thumbnails without a custom Cache Rule. Same handler behavior;
			// the legacy extensionless route stays for old clients.
			r.Get("/assets/{assetID}/thumbnail.{ext}", shareHandler.GetThumbnailExt)
		})

		// OpenGraph cover image for link unfurling. Deliberately OUTSIDE the
		// hotlink-protected /api group: the callers are unfurl bots (Slack,
		// WhatsApp, …) that send no Sec-Fetch headers. It 404s for
		// password-protected / invalid shares, so nothing leaks.
		r.With(generalLimiter.Limit).Get("/og-cover", shareHandler.ServeOGImage)

		// Serve the SPA shell for all other paths under the share. The shell is
		// enriched with per-share OpenGraph meta for public shares.
		serveShareIndex := func(w http.ResponseWriter, r *http.Request) {
			staticHandler.RenderIndexWithHead(w, r, shareHandler.ShareIndexHead(r))
		}
		r.Get("/*", serveShareIndex)
		r.Get("/", serveShareIndex)
	}

	r.Route("/share/{key}", shareRoutes)
	r.Route("/s/{key}", shareRoutes) // Support short /s/ URL format

	// Handle /share and /share/ without key - show error
	r.Get("/share", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
	})
	r.Get("/share/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
	})
	r.Get("/s", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
	})
	r.Get("/s/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
	})

	// Static files for SolidJS app
	r.Get("/assets/*", staticHandler.ServeHTTP)
	r.Get("/favicon.ico", staticHandler.ServeHTTP)
	r.Get("/favicon.svg", staticHandler.ServeHTTP)

	// Landing page (SolidJS app)
	r.Get("/", staticHandler.ServeIndex)

	// Start server
	addr := fmt.Sprintf(":%d", cfg.Proxy.Port)
	server := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	logger.Info("Starting server", zap.String("addr", addr))
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatal("Server failed", zap.Error(err))
	}
}
