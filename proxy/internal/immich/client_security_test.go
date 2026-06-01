package immich

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestAddAssetToAlbum_JSONInjectionResistance guards the regression of
// building the album-add payload with fmt.Sprintf.
//
// The previous implementation was:
//     fmt.Sprintf(`{"ids":["%s"]}`, assetID)
// which lets a malicious assetID such as `"],"evil":"x` inject extra
// JSON fields. json.Marshal escapes quotes into \" and keeps the payload
// as a single { "ids": ["..."] } object.
func TestAddAssetToAlbum_JSONInjectionResistance(t *testing.T) {
	// Capture the body the client sends to Immich.
	var capturedBody []byte

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := NewClient(srv.URL)

	// Malicious payload trying to close the array, inject a new field,
	// and even a path-traversal-looking value.
	evilAssetID := `abc","extra":"pwned","ids":["../../etc/passwd`

	if err := c.AddAssetToAlbum("album-1", evilAssetID, "sharekey", ""); err != nil {
		t.Fatalf("request failed: %v", err)
	}

	if capturedBody == nil {
		t.Fatal("request body was not captured")
	}

	// Parse the body as JSON and assert it has the exact expected shape.
	var parsed struct {
		IDs   []string    `json:"ids"`
		Extra interface{} `json:"extra,omitempty"`
	}
	if err := json.Unmarshal(capturedBody, &parsed); err != nil {
		t.Fatalf("server received non-JSON body: %s", capturedBody)
	}

	if parsed.Extra != nil {
		t.Errorf("injection succeeded: extra field present in body: %s", capturedBody)
	}
	if len(parsed.IDs) != 1 {
		t.Errorf("expected exactly 1 id, got %d: %s", len(parsed.IDs), capturedBody)
	}
	if len(parsed.IDs) > 0 && parsed.IDs[0] != evilAssetID {
		t.Errorf("id not escaped properly: %q vs %q", parsed.IDs[0], evilAssetID)
	}

	// Also assert the raw body is exactly what we'd get from json.Marshal
	// and NOT the leaky fmt.Sprintf shape.
	expected, _ := json.Marshal(struct {
		IDs []string `json:"ids"`
	}{IDs: []string{evilAssetID}})
	if string(capturedBody) != string(expected) {
		t.Errorf("body mismatch.\n got: %s\nwant: %s", capturedBody, expected)
	}
}

// TestClient_PasswordNotInErrorResponses makes sure that when Immich
// returns an error, we don't leak the outgoing URL (which would contain
// the share key + password as query params) back to the caller.
func TestClient_PasswordNotInErrorResponses(t *testing.T) {
	const secretPassword = "super-secret-password-please-dont-leak"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Immich 500s us. The error text from Immich is usually short,
		// but even if it echoed back the URL, the proxy's error string
		// should not include the password.
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("boom"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	_, err := c.GetSharedLink("sharekey", secretPassword)
	if err == nil {
		t.Fatal("expected error")
	}

	if strings.Contains(err.Error(), secretPassword) {
		t.Errorf("error string leaks password: %v", err)
	}
}

func TestGetSharedLink_InvalidSlugUnauthorizedIsNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("slug"); got != "mei" {
			t.Fatalf("expected slug query mei, got %q", got)
		}

		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"Invalid share slug"}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	_, err := c.GetSharedLinkWithKeyType("mei", "", KeyTypeSlug)
	if !errors.Is(err, ErrSharedLinkNotFound) {
		t.Fatalf("expected ErrSharedLinkNotFound, got %v", err)
	}
}
