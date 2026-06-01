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
//
//	fmt.Sprintf(`{"ids":["%s"]}`, assetID)
//
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

func TestGetSharedLink_StalePasswordOnPublicShareFallsBackToPublicSlug(t *testing.T) {
	var seenQueries []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("slug"); got != "mei" {
			t.Fatalf("expected slug query mei, got %q", got)
		}

		seenQueries = append(seenQueries, r.URL.RawQuery)
		if r.URL.Query().Get("password") != "" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"message":"Shared link is not password protected","error":"Bad Request","statusCode":400}`))
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"d030e9c5-c173-40ef-8c9b-4dd1c9f88044",
			"key":"share-key",
			"type":"ALBUM",
			"createdAt":"2026-06-01T15:49:19.589Z",
			"expiresAt":null,
			"allowUpload":false,
			"allowDownload":false,
			"showMetadata":false,
			"description":"",
			"assets":[]
		}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	link, err := c.GetSharedLinkWithKeyType("mei", "stale-cookie-password", KeyTypeSlug)
	if err != nil {
		t.Fatalf("expected stale password fallback to succeed, got %v", err)
	}
	if link.ID != "d030e9c5-c173-40ef-8c9b-4dd1c9f88044" {
		t.Fatalf("unexpected link id %q", link.ID)
	}
	if len(seenQueries) != 2 {
		t.Fatalf("expected one password request and one fallback request, got %d: %v", len(seenQueries), seenQueries)
	}
	if !strings.Contains(seenQueries[0], "password=") {
		t.Fatalf("first request should include password, got %q", seenQueries[0])
	}
	if strings.Contains(seenQueries[1], "password=") {
		t.Fatalf("fallback request should drop password, got %q", seenQueries[1])
	}
}

func TestGetSharedLink_StalePasswordOnProtectedShareDoesNotBypass(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("slug"); got != "protected" {
			t.Fatalf("expected slug query protected, got %q", got)
		}

		if r.URL.Query().Get("password") == "" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"message":"Password required"}`))
			return
		}

		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"message":"Internal server error"}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	_, err := c.GetSharedLinkWithKeyType("protected", "stale-cookie-password", KeyTypeSlug)
	if err == nil {
		t.Fatal("must not bypass password protection by dropping password on 5xx")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Fatalf("expected upstream 500 to propagate, got %v", err)
	}
}

func TestGetThumbnail_StalePasswordOnProtectedShareDoesNotBypass(t *testing.T) {
	var seenQueries []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/assets/asset-1/thumbnail" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("slug"); got != "protected" {
			t.Fatalf("expected slug query protected, got %q", got)
		}

		seenQueries = append(seenQueries, r.URL.RawQuery)
		if r.URL.Query().Get("password") == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"message":"Internal server error"}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	resp, err := c.GetThumbnailWithKeyType("asset-1", "protected", "stale-cookie-password", "preview", KeyTypeSlug)
	if err != nil {
		t.Fatalf("expected response without transport error, got %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected status 500 to propagate, got %d", resp.StatusCode)
	}
	if len(seenQueries) != 1 {
		t.Fatalf("must not retry without password on 5xx, got %d requests: %v", len(seenQueries), seenQueries)
	}
	if !strings.Contains(seenQueries[0], "password=") {
		t.Fatalf("request should keep password, got %q", seenQueries[0])
	}
}

func TestGetThumbnail_StalePasswordOnPublicShareFallsBackToPublicSlug(t *testing.T) {
	var seenQueries []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/assets/asset-1/thumbnail" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("slug"); got != "mei" {
			t.Fatalf("expected slug query mei, got %q", got)
		}

		seenQueries = append(seenQueries, r.URL.RawQuery)
		if r.URL.Query().Get("password") != "" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"message":"Shared link is not password protected","error":"Bad Request","statusCode":400}`))
			return
		}

		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("jpeg"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	resp, err := c.GetThumbnailWithKeyType("asset-1", "mei", "stale-cookie-password", "preview", KeyTypeSlug)
	if err != nil {
		t.Fatalf("expected thumbnail fallback to succeed, got %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	if len(seenQueries) != 2 {
		t.Fatalf("expected one password request and one fallback request, got %d: %v", len(seenQueries), seenQueries)
	}
	if !strings.Contains(seenQueries[0], "password=") {
		t.Fatalf("first request should include password, got %q", seenQueries[0])
	}
	if strings.Contains(seenQueries[1], "password=") {
		t.Fatalf("fallback request should drop password, got %q", seenQueries[1])
	}
}
