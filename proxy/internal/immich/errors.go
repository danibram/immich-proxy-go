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
