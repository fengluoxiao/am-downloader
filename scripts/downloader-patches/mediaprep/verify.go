package mediaprep

import (
	"bytes"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// Verify decodes every audio sample without changing the source. A successful
// transfer or a readable MP4 header alone cannot detect a wrong fragment key.
func Verify(filename, ffmpeg string, expectedMillis int) error {
	if strings.TrimSpace(ffmpeg) == "" {
		ffmpeg = "ffmpeg"
	}
	var progress bytes.Buffer
	log := &boundedLog{}
	cmd := exec.Command(ffmpeg, "-nostdin", "-v", "error", "-xerror", "-err_detect", "explode",
		"-i", filename, "-map", "0:a:0", "-af", "asetpts=N/SR/TB", "-progress", "pipe:1",
		"-stats_period", "3600", "-f", "null", "-")
	cmd.Stdout, cmd.Stderr = &progress, log
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("full audio decode failed (FFmpeg required): %w: %s", err, strings.TrimSpace(log.String()))
	}
	if log.Len() > 0 {
		return fmt.Errorf("audio decoder reported errors: %s", strings.TrimSpace(log.String()))
	}
	decodedMicros := int64(0)
	finished := false
	for _, line := range strings.Split(progress.String(), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "out_time_us=") {
			decodedMicros, _ = strconv.ParseInt(strings.TrimPrefix(line, "out_time_us="), 10, 64)
		}
		if line == "progress=end" {
			finished = true
		}
	}
	if !finished || decodedMicros <= 0 {
		return fmt.Errorf("audio decoder did not finish a nonempty track")
	}
	// Catalog durations can include codec padding or differ by rounding. Count
	// decoded samples (asetpts removes timestamp gaps), allowing one second.
	if expectedMillis > 0 && decodedMicros+1000000 < int64(expectedMillis)*1000 {
		return fmt.Errorf("incomplete audio: decoded %.3fs, expected %.3fs", float64(decodedMicros)/1e6, float64(expectedMillis)/1000)
	}
	return nil
}

type boundedLog struct{ bytes.Buffer }

func (b *boundedLog) Write(p []byte) (int, error) {
	length := len(p)
	if remaining := 16384 - b.Len(); remaining > 0 {
		if len(p) > remaining {
			p = p[:remaining]
		}
		_, _ = b.Buffer.Write(p)
	}
	return length, nil
}
