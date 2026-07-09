package immich

import (
	"errors"
	"fmt"
)

// ErrUpstreamUnavailable indicates the Immich server could not be reached.
var ErrUpstreamUnavailable = errors.New("immich upstream unavailable")

func wrapTransportError(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%w: %w", ErrUpstreamUnavailable, err)
}

// AlbumAddError reports a non-2xx response from the album-add endpoint.
// Exposing the status code lets callers distinguish "Immich v3 already
// auto-added this upload" (403) from a genuine failure.
type AlbumAddError struct {
	StatusCode int
	Body       string
}

func (e *AlbumAddError) Error() string {
	return fmt.Sprintf("failed to add asset to album: status %d, body: %s", e.StatusCode, e.Body)
}
