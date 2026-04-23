package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

// TestRedactQuery_SensitiveKeys is a pure-function guard: any of the
// well-known "secret" query parameters MUST come back [REDACTED]. If the
// proxy ever forwards / logs a query with a password, and we grow the
// habit of trusting r.URL.RawQuery in logs, this is the gate that keeps
// plaintext out of the structured logs shipped to disk/Loki/SIEM.
func TestRedactQuery_SensitiveKeys(t *testing.T) {
	cases := []struct {
		in   string
		keep []string // must be present (key names remain)
		gone []string // must NOT be present (values must be redacted)
	}{
		{
			in:   "password=supersecret",
			keep: []string{"password", "REDACTED"},
			gone: []string{"supersecret"},
		},
		{
			in:   "key=leakykey&size=preview",
			keep: []string{"key", "REDACTED", "size=preview"},
			gone: []string{"leakykey"},
		},
		{
			in:   "slug=my-album&password=x",
			keep: []string{"slug", "password", "REDACTED"},
			gone: []string{"my-album", "x=", "x&"},
		},
		{
			in:   "token=oauthbearer&ok=1",
			keep: []string{"token", "REDACTED", "ok=1"},
			gone: []string{"oauthbearer"},
		},
		{
			in:   "harmless=hello&other=world",
			keep: []string{"harmless=hello", "other=world"},
			gone: []string{"REDACTED"},
		},
		{
			in:   "",
			keep: nil,
			gone: []string{"REDACTED"},
		},
	}

	for _, tc := range cases {
		got := redactQuery(tc.in)
		for _, k := range tc.keep {
			if !strings.Contains(got, k) {
				t.Errorf("redactQuery(%q) = %q, expected it to contain %q", tc.in, got, k)
			}
		}
		for _, g := range tc.gone {
			if strings.Contains(got, g) {
				t.Errorf("redactQuery(%q) = %q, expected it NOT to contain %q", tc.in, got, g)
			}
		}
	}
}

// TestRedactQuery_CaseInsensitive guards against an attacker uppercasing
// the param name to slip past our denylist.
func TestRedactQuery_CaseInsensitive(t *testing.T) {
	got := redactQuery("PASSWORD=oops")
	if strings.Contains(got, "oops") {
		t.Errorf("expected redaction regardless of casing, got %q", got)
	}
	got = redactQuery("Key=leak")
	if strings.Contains(got, "leak") {
		t.Errorf("expected key= to be redacted case-insensitively, got %q", got)
	}
}

// TestLogger_RedactsQueryInStructuredLogs wires the Logger middleware up
// to an in-memory zap observer and ensures no secret value ever ends up
// in the `query` field.
func TestLogger_RedactsQueryInStructuredLogs(t *testing.T) {
	core, logs := observer.New(zapcore.InfoLevel)
	logger := zap.New(core)

	handler := Logger(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/test?password=hunter2&key=leaky&ok=1", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	entries := logs.All()
	if len(entries) == 0 {
		t.Fatal("expected at least one log entry")
	}
	for _, e := range entries {
		for k, v := range e.ContextMap() {
			s, _ := v.(string)
			if strings.Contains(s, "hunter2") || strings.Contains(s, "leaky") {
				t.Errorf("log field %q leaked secret: %v", k, v)
			}
		}
	}
}
