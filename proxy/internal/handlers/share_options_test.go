package handlers

import (
	"testing"

	"github.com/danibram/immich-proxy-go/internal/config"
	"github.com/danibram/immich-proxy-go/internal/immich"
)

func TestApplyEffectiveShareOptions(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name             string
		opts             config.OptionsConfig
		link             immich.SharedLink
		wantDownload     bool
		wantMetadata     bool
		wantShowMetadata bool
	}{
		{
			name:             "both enabled",
			opts:             config.OptionsConfig{AllowDownload: true, ShowMetadata: true},
			link:             immich.SharedLink{AllowDownload: true, ShowMetadata: true},
			wantDownload:     true,
			wantMetadata:     true,
			wantShowMetadata: true,
		},
		{
			name:             "global download off",
			opts:             config.OptionsConfig{AllowDownload: false, ShowMetadata: true},
			link:             immich.SharedLink{AllowDownload: true, ShowMetadata: true},
			wantDownload:     false,
			wantMetadata:     true,
			wantShowMetadata: true,
		},
		{
			name:             "global metadata off",
			opts:             config.OptionsConfig{AllowDownload: true, ShowMetadata: false},
			link:             immich.SharedLink{AllowDownload: true, ShowMetadata: true},
			wantDownload:     true,
			wantMetadata:     false,
			wantShowMetadata: false,
		},
		{
			name:             "link metadata off",
			opts:             config.OptionsConfig{AllowDownload: true, ShowMetadata: true},
			link:             immich.SharedLink{AllowDownload: true, ShowMetadata: false},
			wantDownload:     true,
			wantMetadata:     false,
			wantShowMetadata: false,
		},
		{
			name:             "link download off",
			opts:             config.OptionsConfig{AllowDownload: true, ShowMetadata: true},
			link:             immich.SharedLink{AllowDownload: false, ShowMetadata: true},
			wantDownload:     false,
			wantMetadata:     true,
			wantShowMetadata: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			link := tc.link
			gotMeta := applyEffectiveShareOptions(&link, tc.opts)
			if link.AllowDownload != tc.wantDownload {
				t.Fatalf("AllowDownload: got %v want %v", link.AllowDownload, tc.wantDownload)
			}
			if link.ShowMetadata != tc.wantMetadata {
				t.Fatalf("ShowMetadata: got %v want %v", link.ShowMetadata, tc.wantMetadata)
			}
			if gotMeta != tc.wantShowMetadata {
				t.Fatalf("returned showMetadata: got %v want %v", gotMeta, tc.wantShowMetadata)
			}
		})
	}
}
