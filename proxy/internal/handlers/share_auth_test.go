package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidatePassword_Correct(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	body := strings.NewReader(`{"password": "secret123"}`)
	req := httptest.NewRequest("POST", "/api/share/password-protected/validate-password", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}

	var response map[string]bool
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !response["valid"] {
		t.Error("expected valid to be true")
	}

	cookies := rec.Result().Cookies()
	var foundCookie bool
	for _, c := range cookies {
		if c.Name == "immich-share-password" {
			if strings.Contains(c.Value, ".") {
				foundCookie = true
			}
			break
		}
	}
	if !foundCookie {
		t.Error("expected password cookie to be set with signed value")
	}
}

func TestValidatePassword_Incorrect(t *testing.T) {
	mockServer := MockImmichServer(t)
	defer mockServer.Close()

	_, router := setupTestHandler(t, mockServer)

	body := strings.NewReader(`{"password": "wrongpassword"}`)
	req := httptest.NewRequest("POST", "/api/share/password-protected/validate-password", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rec.Code)
	}
}
