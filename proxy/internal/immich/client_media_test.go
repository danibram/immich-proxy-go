package immich

import (
	"net/http"
	"testing"
	"time"
)

// TestClientTimeoutSplit pins the two-client transport contract:
//   - JSON/API calls keep a hard total deadline (no API response should take
//     30s end to end);
//   - media streaming must have NO total timeout — http.Client.Timeout keeps
//     counting during body streaming, so any total deadline kills long video
//     transfers mid-body. Hanging phases are bounded per-step instead.
func TestClientTimeoutSplit(t *testing.T) {
	c := NewClient("http://immich.test")

	if c.httpClient.Timeout != 30*time.Second {
		t.Errorf("API client total timeout = %v, want 30s", c.httpClient.Timeout)
	}
	if c.mediaClient.Timeout != 0 {
		t.Errorf("media client total timeout = %v, want 0 (none)", c.mediaClient.Timeout)
	}

	transport, ok := c.mediaClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("media client transport is %T, want *http.Transport", c.mediaClient.Transport)
	}
	if transport.ResponseHeaderTimeout != 30*time.Second {
		t.Errorf("ResponseHeaderTimeout = %v, want 30s", transport.ResponseHeaderTimeout)
	}
	if transport.TLSHandshakeTimeout != 10*time.Second {
		t.Errorf("TLSHandshakeTimeout = %v, want 10s", transport.TLSHandshakeTimeout)
	}
	if transport.MaxIdleConnsPerHost != 16 {
		t.Errorf("MaxIdleConnsPerHost = %d, want 16 (thumbnail bursts)", transport.MaxIdleConnsPerHost)
	}
	if transport.DialContext == nil {
		t.Error("media transport must bound dialing with an explicit DialContext")
	}
}
