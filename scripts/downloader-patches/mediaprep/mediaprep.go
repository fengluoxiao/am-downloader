// Package mediaprep flattens decrypted fragmented MP4 before adding metadata.
package mediaprep

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"main/utils/stagedoutput"
)

// Embed reimports compressed samples without decoding or encoding them. Merely
// adding iTunes tags can leave an iso5 brand and fragmented sample tables that
// go-mp4tag cannot handle. Keep the source until the remux succeeds.
func Embed(filename, tags string) error {
	f, err := os.CreateTemp(filepath.Dir(filename), ".am-remux-*.m4a")
	if err != nil {
		return err
	}
	output := f.Name()
	defer os.Remove(output)
	if err := f.Close(); err != nil {
		return err
	}
	cmd := exec.Command("MP4Box", "-add", filename, "-keep-utc", "-itags", tags, "-brand", "mp42", "-new", output)
	if log, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("MP4Box remux failed: %w: %s", err, log)
	}
	stat, err := os.Stat(output)
	if err != nil {
		return err
	}
	if stat.Size() == 0 {
		return fmt.Errorf("MP4Box remux produced an empty file")
	}
	return stagedoutput.RetryIO(func() error { return os.Rename(output, filename) })
}
