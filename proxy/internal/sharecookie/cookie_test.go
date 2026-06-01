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
	// Keep in sync with e2e/scripts/assert-proxy.sh (stale password cookie vector).
	const want = "c3RhbGUtcGFzc3dvcmQtZnJvbS1hbm90aGVyLXNoYXJl.z3XQleAhHpf-MgTQS9fgvqCyrYCNK0g6TIeUBMgp0T0="
	secret := []byte("e2e-cookie-secret-change-me")
	password := "stale-password-from-another-share"
	got := Sign(secret, password)
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}
