package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMediaQualityDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Options.DownloadQuality() != QualityOriginal {
		t.Fatalf("download quality = %q", cfg.Options.DownloadQuality())
	}
	if cfg.Options.ZoomQuality() != QualityPreview {
		t.Fatalf("zoom quality = %q", cfg.Options.ZoomQuality())
	}
}

func TestLoadRejectsInvalidMediaQuality(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("options:\n  max_download_quality: huge\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("expected invalid quality to fail config loading")
	}
}
