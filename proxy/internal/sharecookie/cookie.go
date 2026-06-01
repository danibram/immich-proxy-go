// Package sharecookie signs and verifies immich-share-password cookies.
package sharecookie

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"
)

// Sign returns an HMAC-signed cookie value: base64(value).base64(signature).
func Sign(secret []byte, value string) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(value))
	signature := mac.Sum(nil)
	return base64.URLEncoding.EncodeToString([]byte(value)) + "." +
		base64.URLEncoding.EncodeToString(signature)
}

// Verify extracts the value when the signature is valid.
// Returns ("", nil) for malformed or invalid signatures (not an error).
func Verify(secret []byte, signedValue string) (string, error) {
	parts := strings.Split(signedValue, ".")
	if len(parts) != 2 {
		return "", nil
	}

	valueBytes, err := base64.URLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", err
	}

	signature, err := base64.URLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}

	mac := hmac.New(sha256.New, secret)
	mac.Write(valueBytes)
	expectedSig := mac.Sum(nil)

	if !hmac.Equal(signature, expectedSig) {
		return "", nil
	}

	return string(valueBytes), nil
}
