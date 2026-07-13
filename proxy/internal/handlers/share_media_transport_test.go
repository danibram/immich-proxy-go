package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danibram/immich-proxy-go/internal/middleware"
	"github.com/go-chi/chi/v5"
)

// TestGetVideo_ForwardsRangeAndPassesThrough206 covers video seeking: the
// browser's Range header must reach Immich, and Immich's 206 Partial Content
// (with Content-Range / Accept-Ranges) must reach the browser untouched.
func TestGetVideo_ForwardsRangeAndPassesThrough206(t *testing.T) {
	var upstreamRange string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/shared-links/me":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"id": testLinkID1, "key": "valid-key", "type": "ALBUM",
			})
		case r.URL.Path == "/api/assets/"+testAssetID2+"/video/playback":
			upstreamRange = r.Header.Get("Range")
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Content-Range", "bytes 100-103/1000")
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusPartialContent)
			w.Write([]byte("abcd"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()

	handler, _ := setupTestHandler(t, upstream)
	router := chi.NewRouter()
	router.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Get("/assets/{assetID}/video/playback", handler.GetVideo)
	})

	req := httptest.NewRequest("GET", "/api/share/valid-key/assets/"+testAssetID2+"/video/playback", nil)
	req.Header.Set("Range", "bytes=100-103")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if upstreamRange != "bytes=100-103" {
		t.Errorf("expected Range header forwarded to upstream, got %q", upstreamRange)
	}
	if rec.Code != http.StatusPartialContent {
		t.Errorf("expected 206 passed through, got %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Range"); got != "bytes 100-103/1000" {
		t.Errorf("expected Content-Range passed through, got %q", got)
	}
	if got := rec.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Errorf("expected Accept-Ranges passed through, got %q", got)
	}
	if rec.Body.String() != "abcd" {
		t.Errorf("expected partial body passed through, got %q", rec.Body.String())
	}
}

// TestGetVideo_NoRangeHeaderMeansNoneForwarded guards against inventing a
// Range header when the browser did not send one.
func TestGetVideo_NoRangeHeaderMeansNoneForwarded(t *testing.T) {
	sawRange := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/shared-links/me":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"id": testLinkID1, "key": "valid-key", "type": "ALBUM",
			})
		default:
			if _, ok := r.Header["Range"]; ok {
				sawRange = true
			}
			w.Header().Set("Content-Type", "video/mp4")
			w.Write([]byte("full"))
		}
	}))
	defer upstream.Close()

	handler, _ := setupTestHandler(t, upstream)
	router := chi.NewRouter()
	router.Route("/api/share/{key}", func(r chi.Router) {
		r.Use(middleware.ExtractShareKey)
		r.Get("/assets/{assetID}/video/playback", handler.GetVideo)
	})

	req := httptest.NewRequest("GET", "/api/share/valid-key/assets/"+testAssetID2+"/video/playback", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if sawRange {
		t.Error("no Range header on the request, but one was forwarded upstream")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

// blockingReadCloser delivers an initial payload, then blocks forever until
// closed — the shape of a wedged upstream connection.
type blockingReadCloser struct {
	initial []byte
	closed  chan struct{}
}

func newBlockingReadCloser(initial []byte) *blockingReadCloser {
	return &blockingReadCloser{initial: initial, closed: make(chan struct{})}
}

func (b *blockingReadCloser) Read(p []byte) (int, error) {
	if len(b.initial) > 0 {
		n := copy(p, b.initial)
		b.initial = b.initial[n:]
		return n, nil
	}
	<-b.closed
	return 0, io.ErrClosedPipe
}

func (b *blockingReadCloser) Close() error {
	select {
	case <-b.closed:
	default:
		close(b.closed)
	}
	return nil
}

func TestCopyWithIdleTimeout_AbortsStalledStream(t *testing.T) {
	src := newBlockingReadCloser([]byte("hello"))
	var dst bytes.Buffer

	done := make(chan error, 1)
	go func() { done <- copyWithIdleTimeout(&dst, src, 50*time.Millisecond) }()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected an error from the aborted stream, got nil")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("copyWithIdleTimeout did not abort a stalled stream")
	}
	if dst.String() != "hello" {
		t.Errorf("expected bytes delivered before the stall to be flushed, got %q", dst.String())
	}
}

func TestCopyWithIdleTimeout_SlowButAliveStreamCompletes(t *testing.T) {
	pr, pw := io.Pipe()
	go func() {
		// Total duration (3 x 30ms) exceeds the idle window, but each gap is
		// under it: progress keeps the watchdog re-armed.
		for i := 0; i < 3; i++ {
			time.Sleep(30 * time.Millisecond)
			pw.Write([]byte("chunk"))
		}
		pw.Close()
	}()

	var dst bytes.Buffer
	if err := copyWithIdleTimeout(&dst, pr, 80*time.Millisecond); err != nil {
		t.Fatalf("expected slow-but-alive stream to complete, got %v", err)
	}
	if dst.String() != "chunkchunkchunk" {
		t.Errorf("expected full body, got %q", dst.String())
	}
}
