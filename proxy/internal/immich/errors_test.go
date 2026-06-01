package immich

import (
	"errors"
	"fmt"
	"testing"
)

func TestWrapTransportError(t *testing.T) {
	root := fmt.Errorf("connection refused")
	wrapped := wrapTransportError(root)
	if !errors.Is(wrapped, ErrUpstreamUnavailable) {
		t.Fatalf("expected ErrUpstreamUnavailable, got %v", wrapped)
	}
}
