package immich

import (
	"encoding/json"
	"fmt"
)

// Duration is an asset duration. Immich v2 returns the classic
// "H:MM:SS.000000" string; Immich v3 returns numeric milliseconds (or null).
// This type accepts all three and always marshals back to the classic string
// form the web app expects.
type Duration string

func (d *Duration) UnmarshalJSON(raw []byte) error {
	if len(raw) == 0 || string(raw) == "null" {
		*d = ""
		return nil
	}

	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		*d = Duration(asString)
		return nil
	}

	var ms float64
	if err := json.Unmarshal(raw, &ms); err != nil {
		return fmt.Errorf("duration must be a string or a number of milliseconds, got %s", raw)
	}
	*d = formatDurationMs(ms)
	return nil
}

// formatDurationMs renders milliseconds as the classic "H:MM:SS.000000" form.
func formatDurationMs(ms float64) Duration {
	if ms <= 0 {
		return ""
	}
	total := int64(ms)
	hours := total / 3_600_000
	minutes := (total % 3_600_000) / 60_000
	seconds := (total % 60_000) / 1000
	millis := total % 1000
	return Duration(fmt.Sprintf("%d:%02d:%02d.%03d000", hours, minutes, seconds, millis))
}
