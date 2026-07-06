package immich

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestPasswordShare_V3TokenLogin verifies the Immich v3 password flow: the
// client logs in once through /api/shared-links/login, then replays the
// immich_shared_link_token cookie on authenticated requests. The token must
// be cached so repeated calls do not re-login.
func TestPasswordShare_V3TokenLogin(t *testing.T) {
	logins := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/shared-links/login":
			logins++
			if r.URL.Query().Get("slug") != "protected" {
				t.Errorf("login missing slug auth, got %q", r.URL.RawQuery)
			}
			http.SetCookie(w, &http.Cookie{Name: "immich_shared_link_token", Value: "tok-123"})
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"id":"link-1"}`))
		case "/api/shared-links/me":
			cookie, err := r.Cookie("immich_shared_link_token")
			if err != nil || cookie.Value != "tok-123" {
				// v3 behavior: without the token cookie the password share is locked.
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"message":"Password required"}`))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"id":"link-1","key":"k","type":"ALBUM","assets":[]}`))
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL)

	for i := 0; i < 3; i++ {
		link, err := c.GetSharedLinkWithKeyType("protected", "secret", KeyTypeSlug)
		if err != nil {
			t.Fatalf("call %d: expected v3 token login to unlock the share, got %v", i, err)
		}
		if link.ID != "link-1" {
			t.Fatalf("call %d: unexpected link %+v", i, link)
		}
	}

	if logins != 1 {
		t.Errorf("expected exactly 1 login (token cached), got %d", logins)
	}
}

// TestPasswordShare_WrongPasswordStays401 ensures a rejected login does not
// break the error contract: the share request still returns the upstream 401.
func TestPasswordShare_WrongPasswordStays401(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/shared-links/login":
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"message":"Invalid password"}`))
		case "/api/shared-links/me":
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"message":"Password required"}`))
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	_, err := NewClient(srv.URL).GetSharedLinkWithKeyType("protected", "wrong", KeyTypeSlug)
	if err != ErrPasswordRequired {
		t.Fatalf("expected ErrPasswordRequired, got %v", err)
	}
}

// TestPasswordShare_StalePasswordOnV3PublicShareReportsDrop covers the v3
// variant of the stale-cookie flow: the login probe answers 400 ("not
// password protected") and the actual request succeeds because v3 ignores
// the password — the client must still report the password as dropped so the
// handler clears the stale cookie.
func TestPasswordShare_StalePasswordOnV3PublicShareReportsDrop(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/shared-links/login":
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"message":"Shared link is not password protected"}`))
		case "/api/shared-links/me":
			// v3: password query param is ignored on public shares.
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"id":"link-pub","key":"k","type":"ALBUM","assets":[]}`))
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	link, dropped, err := NewClient(srv.URL).GetSharedLinkWithKeyTypeDroppedStalePassword("pub", "stale-cookie", KeyTypeSlug)
	if err != nil {
		t.Fatalf("public share with stale password must load, got %v", err)
	}
	if link.ID != "link-pub" {
		t.Fatalf("unexpected link: %+v", link)
	}
	if !dropped {
		t.Error("stale password on a v3 public share must be reported as dropped")
	}
}
