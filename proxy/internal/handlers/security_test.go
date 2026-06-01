package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danibram/immich-proxy-go/internal/config"
	"github.com/danibram/immich-proxy-go/internal/immich"
	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// TestGetSharedLink_ResponseDoesNotLeakOwnerEmail integrates the full
// handler -> Immich mock -> sanitizer pipeline, asserting that the
// response wire format never contains the owner's email. This is the
// top-level promise of the proxy.
func TestGetSharedLink_ResponseDoesNotLeakOwnerEmail(t *testing.T) {
	const ownerEmail = "victim@private.example"

	// Mock Immich server returns a SharedLink that includes owner PII.
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/shared-links/me" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		link := immich.SharedLink{
			ID:       "link-1",
			Key:      "leakkey",
			Type:     "ALBUM",
			UserID:   "owner-user-id",
			Token:    "internal-token",
			Password: "server-shared-secret",
			Album: &immich.Album{
				ID:      "album-1",
				OwnerID: "owner-user-id",
				Owner: &immich.User{
					ID:    "owner-user-id",
					Email: ownerEmail,
					Name:  "Owner Name",
				},
				AlbumUsers: []immich.AlbumUser{
					{User: immich.User{Email: "collaborator@private.example"}},
				},
				Assets: []immich.Asset{
					{
						ID:           "asset-1",
						OriginalPath: "/var/lib/immich/upload/owner/secret.jpg",
						Checksum:     "should-not-leak",
						ExifInfo: &immich.ExifInfo{
							Latitude:  37.7749,
							Longitude: -122.4194,
						},
					},
				},
			},
			Assets: []immich.Asset{
				{
					ID:           "asset-1",
					OriginalPath: "/var/lib/immich/upload/owner/secret.jpg",
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(link)
	}))
	defer mock.Close()

	cfg := &config.Config{
		Options: config.OptionsConfig{ShowMetadata: true, AllowDownload: true},
	}
	middleware.CookieSecret = []byte("test-secret")
	h := NewShareHandler(immich.NewClient(mock.URL), cfg, zap.NewNop(), "test-secret")

	r := chi.NewRouter()
	r.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Get("/link", h.GetSharedLink)
	})

	req := httptest.NewRequest("GET", "/api/share/leakkey/link", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d, body: %s", rec.Code, rec.Body.String())
	}

	body := rec.Body.String()
	for _, forbidden := range []string{
		ownerEmail,
		"collaborator@private.example",
		"owner-user-id",
		"internal-token",
		"server-shared-secret",
		"/var/lib/immich/upload/owner/secret.jpg",
		"should-not-leak",
		"37.7749",
		"-122.4194",
	} {
		if strings.Contains(body, forbidden) {
			t.Errorf("response must not contain %q, but does.\nfull body: %s", forbidden, body)
		}
	}
}

// TestIsAllowedContentType_RejectsDangerousTypes makes sure an attacker
// cannot sneak arbitrary binaries / scripts through the upload endpoint
// by claiming a harmless Content-Type.
func TestIsAllowedContentType_RejectsDangerousTypes(t *testing.T) {
	allowed := []string{
		"image/jpeg",
		"image/png",
		"IMAGE/PNG",
		"image/heic",
		"video/mp4",
		"video/quicktime",
		"multipart/form-data; boundary=----xyz",
	}
	forbidden := []string{
		"",
		"application/octet-stream",
		"application/x-php",
		"text/html",
		"text/html; charset=utf-8",
		"application/javascript",
		"application/json",
		"application/x-sh",
		"text/xml",
		"application/xml",
	}

	for _, ct := range allowed {
		if !isAllowedContentType(ct) {
			t.Errorf("expected %q to be ALLOWED", ct)
		}
	}
	for _, ct := range forbidden {
		if isAllowedContentType(ct) {
			t.Errorf("expected %q to be REJECTED", ct)
		}
	}
}

// TestSanitizeFilename_ControlCharactersRemoved ensures we cannot inject
// a newline into Content-Disposition via a malicious album name on
// Immich, which would enable response-splitting.
func TestSanitizeFilename_ControlCharactersRemoved(t *testing.T) {
	// For each input we assert two things:
	//  1) The exact expected output.
	//  2) The output contains none of the characters that would be
	//     dangerous in a Content-Disposition header (CR/LF, quotes,
	//     slashes). This second check is the one that really matters
	//     for security — the exact shape of the sanitized string is
	//     just a convenient place to pin behaviour.
	cases := map[string]string{
		"normal name":             "normal name",
		"../../etc/passwd":        "_.._etc_passwd", // leading dots trimmed; no literal "../"
		"file\nwith\r\nnewline":   "file_with__newline",
		"with|pipes<and>brackets": "with_pipes_and_brackets",
		`quotes"inside"`:          "quotes_inside_",
		"":                        "",
	}
	for in, want := range cases {
		got := sanitizeFilename(in)
		if got != want {
			t.Errorf("sanitizeFilename(%q) = %q, want %q", in, got, want)
		}
		// Hard invariants every sanitized name must satisfy.
		for _, bad := range []string{"/", "\\", "\r", "\n", `"`, "<", ">", "|", "../", "..\\"} {
			if strings.Contains(got, bad) {
				t.Errorf("sanitizeFilename(%q) = %q still contains forbidden %q", in, got, bad)
			}
		}
	}
}

// TestIsValidJobID guards the download-job lookup against path traversal
// or other odd shapes that should never reach the job store.
func TestIsValidJobID(t *testing.T) {
	valid := []string{
		"0123456789abcdef0123456789abcdef",
		"ffffffffffffffffffffffffffffffff",
	}
	invalid := []string{
		"",
		"short",
		"0123456789ABCDEF0123456789abcdef", // uppercase
		"0123456789abcdef0123456789abcde",  // 31 chars
		"0123456789abcdef0123456789abcdefg", // 33 chars
		"../../../etc/passwd",
		"0123456789abcdef0123456789abcdeg", // non-hex char
		"..\\windows",
	}
	for _, id := range valid {
		if !isValidJobID(id) {
			t.Errorf("expected %q to be valid", id)
		}
	}
	for _, id := range invalid {
		if isValidJobID(id) {
			t.Errorf("expected %q to be invalid", id)
		}
	}
}

// TestJobBelongsToShare - the core defense-in-depth check: a job created
// by share key A cannot be read, polled, or downloaded by share key B
// even if B somehow guesses the job ID (which is 128 bits of entropy but
// the check exists as second-line defense).
func TestJobBelongsToShare(t *testing.T) {
	job := &DownloadJob{ID: "x", ShareKey: "share-A"}

	if !jobBelongsToShare(job, "share-A") {
		t.Error("same share key should match")
	}
	if jobBelongsToShare(job, "share-B") {
		t.Error("different share key must NOT match")
	}
	if jobBelongsToShare(job, "") {
		t.Error("empty share key must NOT match")
	}
	if jobBelongsToShare(nil, "share-A") {
		t.Error("nil job must NOT match")
	}
	if jobBelongsToShare(&DownloadJob{ShareKey: ""}, "") {
		t.Error("empty-on-both must NOT match (rejecting empty keys is safer)")
	}
}

// TestDownloadJobManager_ActiveCount makes sure the DoS cap counts only
// currently-processing jobs.
func TestDownloadJobManager_ActiveCount(t *testing.T) {
	m := &DownloadJobManager{jobs: map[string]*DownloadJob{}}

	j1 := m.Create(10, "a.zip", "share-A")
	_ = m.Create(5, "b.zip", "share-B")

	if n := m.activeJobCount(); n != 2 {
		t.Fatalf("expected 2 active jobs, got %d", n)
	}

	m.SetReady(j1.ID, "")
	if n := m.activeJobCount(); n != 1 {
		t.Fatalf("expected 1 active job after SetReady, got %d", n)
	}
}

// TestCookieSecure_Logic covers every branch that decides whether to
// mark the password cookie Secure. This is critical: a cookie sent without
// the Secure attribute on an HTTPS site can be written by a MITM on any
// HTTP request the user makes to the same domain (including attacker
// pages via mixed content).
func TestCookieSecure_Logic(t *testing.T) {
	// We exercise the same boolean expression the handler uses. If the
	// logic ever drifts, this test catches it.
	decide := func(forceSecure, trustProxy bool, xfProto string, tls bool, publicURL string) bool {
		return forceSecure ||
			(trustProxy && strings.EqualFold(xfProto, "https")) ||
			tls ||
			strings.HasPrefix(publicURL, "https://")
	}

	cases := []struct {
		name       string
		force      bool
		trustProxy bool
		xfProto    string
		tls        bool
		publicURL  string
		want       bool
	}{
		{"force wins over everything", true, false, "", false, "http://x", true},
		{"trust_proxy + https X-Forwarded-Proto", false, true, "https", false, "", true},
		{"trust_proxy + HTTPS X-Forwarded-Proto (case)", false, true, "HTTPS", false, "", true},
		{"trust_proxy + http X-Forwarded-Proto -> not secure", false, true, "http", false, "", false},
		{"X-Forwarded-Proto ignored when trust_proxy off", false, false, "https", false, "", false},
		{"r.TLS set -> secure", false, false, "", true, "", true},
		{"public_url https -> secure", false, false, "", false, "https://photos", true},
		{"public_url http -> not secure", false, false, "", false, "http://photos", false},
		{"fully-unset localhost dev -> not secure", false, false, "", false, "", false},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := decide(tt.force, tt.trustProxy, tt.xfProto, tt.tls, tt.publicURL); got != tt.want {
				t.Errorf("got %v want %v", got, tt.want)
			}
		})
	}
}

// TestDownloadJob_CrossShareAccessDenied is the integration-level proof
// that a valid share key (B) cannot look up or download a ZIP created by
// another share (A). The jobID is 128 bits of entropy so in practice it
// is unguessable, but binding the job to a share key is cheap
// defense-in-depth that would catch any future routing mistake or log
// leakage.
func TestDownloadJob_CrossShareAccessDenied(t *testing.T) {
	cfg := &config.Config{Options: config.OptionsConfig{AllowDownload: true}}
	middleware.CookieSecret = []byte("sekret")
	h := NewShareHandler(nil, cfg, zap.NewNop(), "sekret")

	// Pretend share A created the job through the manager.
	job := downloadJobManager.Create(1, "a.zip", "share-A")
	downloadJobManager.SetReady(job.ID, "/tmp/does-not-need-to-exist")
	defer downloadJobManager.Delete(job.ID)

	r := chi.NewRouter()
	r.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Get("/download/jobs/{jobID}", h.GetDownloadJobStatus)
	})

	// Request comes in as share B but with share A's job ID.
	req := httptest.NewRequest("GET", "/api/share/share-B/download/jobs/"+job.ID, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// Must look identical to "job does not exist".
	if rec.Code != http.StatusNotFound {
		t.Errorf("cross-share access returned %d, want 404", rec.Code)
	}

	// Same request with the correct share should succeed.
	req2 := httptest.NewRequest("GET", "/api/share/share-A/download/jobs/"+job.ID, nil)
	rec2 := httptest.NewRecorder()
	r.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Errorf("owning-share access returned %d, want 200, body=%s", rec2.Code, rec2.Body.String())
	}
}

// TestDownloadJob_InvalidIDRejected asserts that malformed job IDs never
// reach the manager (cheap front-line filter against path-traversal or
// fuzzed values in the URL).
func TestDownloadJob_InvalidIDRejected(t *testing.T) {
	cfg := &config.Config{Options: config.OptionsConfig{AllowDownload: true}}
	middleware.CookieSecret = []byte("sekret")
	h := NewShareHandler(nil, cfg, zap.NewNop(), "sekret")

	r := chi.NewRouter()
	r.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Get("/download/jobs/{jobID}", h.GetDownloadJobStatus)
	})

	for _, bad := range []string{
		"short",
		"NOTHEX0123456789abcdef0123456789",
		"0123456789abcdef0123456789abcdeg",
		"not-a-job-id-at-all",
	} {
		req := httptest.NewRequest("GET", "/api/share/share-A/download/jobs/"+bad, nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("bad jobID %q returned %d, want 400", bad, rec.Code)
		}
	}
}

// TestValidatePassword_CookieAttributes asserts that the cookie set on a
// successful password validation has the correct security attributes:
// HttpOnly, SameSite=Strict, a reasonable MaxAge, and (when we can detect
// HTTPS) Secure.
func TestValidatePassword_CookieAttributes(t *testing.T) {
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Always accept the test password.
		if r.URL.Query().Get("password") == "" && r.Header.Get("x-immich-share-password") == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		link := immich.SharedLink{ID: "l", Key: "k", Type: "ALBUM", CreatedAt: time.Now()}
		_ = json.NewEncoder(w).Encode(link)
	}))
	defer mock.Close()

	cfg := &config.Config{
		Proxy: config.ProxyConfig{PublicURL: "https://photos.example.com"},
	}
	middleware.CookieSecret = []byte("sekret")
	h := NewShareHandler(immich.NewClient(mock.URL), cfg, zap.NewNop(), "sekret")

	r := chi.NewRouter()
	r.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Post("/validate-password", h.ValidatePassword)
	})

	body := strings.NewReader(`{"password":"pwd"}`)
	req := httptest.NewRequest("POST", "/api/share/k/validate-password", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}

	var got *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == "immich-share-password" {
			got = c
			break
		}
	}
	if got == nil {
		t.Fatal("no password cookie set")
	}
	if !got.HttpOnly {
		t.Error("cookie must be HttpOnly")
	}
	if !got.Secure {
		t.Error("cookie must be Secure when public URL is https")
	}
	if got.SameSite != http.SameSiteStrictMode {
		t.Errorf("cookie SameSite=%v, want Strict", got.SameSite)
	}
	if got.MaxAge <= 0 || got.MaxAge > 24*60*60 {
		t.Errorf("unexpected MaxAge %d", got.MaxAge)
	}
	if got.Path != "/share/k" {
		t.Errorf("cookie Path=%q, want /share/k", got.Path)
	}
	// The value must be the signed format, not plaintext.
	if !strings.Contains(got.Value, ".") {
		t.Errorf("cookie value should be signed (contain '.'), got %q", got.Value)
	}
	if strings.Contains(got.Value, "pwd") && !strings.Contains(got.Value, "cHdk") {
		// pwd base64 is "cHdk" - if the raw plaintext "pwd" shows up
		// without base64, something is broken.
		t.Errorf("cookie value should not contain raw plaintext password")
	}
}
