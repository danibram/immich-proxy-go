package handlers

import (
	"github.com/danibram/immich-proxy-go/internal/config"
	"github.com/danibram/immich-proxy-go/internal/immich"
)

// applyEffectiveShareOptions applies proxy-level gates to shared-link flags exposed
// to the public UI/API. Returns effectiveShowMetadata for sanitize* helpers.
func applyEffectiveShareOptions(link *immich.SharedLink, opts config.OptionsConfig) bool {
	if link == nil {
		return false
	}
	effectiveShowMetadata := opts.ShowMetadata && link.ShowMetadata
	link.AllowDownload = opts.AllowDownload && link.AllowDownload
	link.ShowMetadata = effectiveShowMetadata
	return effectiveShowMetadata
}
