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
