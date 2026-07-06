package handlers

import (
	"github.com/danibram/immich-proxy-go/internal/config"
	"github.com/danibram/immich-proxy-go/internal/immich"
	"go.uber.org/zap"
)

// ShareHandler handles shared link requests
type ShareHandler struct {
	client       *immich.Client
	config       *config.Config
	logger       *zap.Logger
	cookieSecret []byte
	authzCache   *shareAuthzCache
}

// NewShareHandler creates a new share handler
func NewShareHandler(client *immich.Client, cfg *config.Config, logger *zap.Logger, cookieSecret string) *ShareHandler {
	return &ShareHandler{
		client:       client,
		config:       cfg,
		logger:       logger,
		cookieSecret: []byte(cookieSecret),
		authzCache:   newShareAuthzCache(),
	}
}
