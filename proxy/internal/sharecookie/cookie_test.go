package sharecookie

import "testing"

func TestSignAndVerify(t *testing.T) {
	secret := []byte("test-secret")
	password := "secret123"

	signed := Sign(secret, password)
	got, err := Verify(secret, signed)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got != password {
		t.Fatalf("expected %q, got %q", password, got)
	}
}

func TestVerifyRejectsInvalidSignature(t *testing.T) {
	secret := []byte("test-secret")
	signed := Sign(secret, "secret123")
	// Corrupt the signature segment.
	signed = signed[:len(signed)-1] + "x"
	got, err := Verify(secret, signed)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got != "" {
		t.Fatalf("expected empty password, got %q", got)
	}
}

func TestSign_e2eStalePasswordVector(t *testing.T) {
	// Keep in sync with e2e/scripts/assert-share-security.sh (stale password cookie vector).
	const want = "c3RhbGUtcGFzc3dvcmQtZnJvbS1hbm90aGVyLXNoYXJl.z3XQleAhHpf-MgTQS9fgvqCyrYCNK0g6TIeUBMgp0T0="
	secret := []byte("e2e-cookie-secret-change-me")
	password := "stale-password-from-another-share"
	got := Sign(secret, password)
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestSign_e2eProtectedSharePasswordVectors(t *testing.T) {
	secret := []byte("e2e-cookie-secret-change-me")
	const wantA = "ZTJlLXNlY3JldC1wYXNzd29yZA==.dU9FzS-9iBYtJrkHaz-fVSaCT3Jia0KkqcBR5ih1L-g="
	const wantB = "YW5vdGhlci1lMmUtcGFzc3dvcmQ=.HT4XDlf7oalXlaCB-cNLwg50-LNm3VyDDENZtltgGc4="
	if Sign(secret, "e2e-secret-password") != wantA {
		t.Fatalf("protected A cookie vector mismatch")
	}
	if Sign(secret, "another-e2e-password") != wantB {
		t.Fatalf("protected B cookie vector mismatch")
	}
}
