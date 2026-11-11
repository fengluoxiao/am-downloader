package mediaprep

import (
	"bytes"
	"crypto/sha256"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/itouakirai/mp4ff/mp4"
)

func TestFullAudioVerification(t *testing.T) {
	ffmpeg := os.Getenv("AM_TEST_FFMPEG")
	if ffmpeg == "" {
		t.Skip("set AM_TEST_FFMPEG to run real full-decode regression tests")
	}
	for _, codec := range []string{"alac", "eac3"} {
		t.Run(codec, func(t *testing.T) {
			filename := filepath.Join(t.TempDir(), "audio.m4a")
			args := []string{"-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-ar", "48000", "-ac", "2", "-c:a", codec, "-f", "mp4", filename}
			if output, err := exec.Command(ffmpeg, args...).CombinedOutput(); err != nil {
				t.Fatalf("generate %s: %v %s", codec, err, output)
			}
			original, err := os.ReadFile(filename)
			if err != nil {
				t.Fatal(err)
			}
			if err := Verify(filename, ffmpeg, 4000); err != nil {
				t.Fatalf("valid full track: %v", err)
			}
			unchanged, _ := os.ReadFile(filename)
			if sha256.Sum256(original) != sha256.Sum256(unchanged) {
				t.Fatal("verification modified the source")
			}
			if err := Verify(filename, ffmpeg, 12000); err == nil || !strings.Contains(err.Error(), "incomplete audio") {
				t.Fatalf("accepted shortened clean audio: %v", err)
			}
			parsed, err := mp4.DecodeFile(bytes.NewReader(original))
			if err != nil {
				t.Fatal(err)
			}
			stbl := parsed.Moov.Trak.Mdia.Minf.Stbl
			// Keep the container and first 3 seconds intact. Damage late compressed
			// frames, reproducing why checking only the header/start is inadequate.
			firstDamaged := uint32(stbl.Stsz.SampleNumber*3/4 + 1)
			offset := parsed.Mdat.PayloadAbsoluteOffset()
			for sample := uint32(1); sample < firstDamaged; sample++ {
				offset += uint64(stbl.Stsz.GetSampleSize(int(sample)))
			}
			end := parsed.Mdat.PayloadAbsoluteOffset() + uint64(len(parsed.Mdat.Data))
			for i := offset; i < end; i++ {
				original[i] = 0xff
			}
			if err := os.WriteFile(filename, original, 0600); err != nil {
				t.Fatal(err)
			}
			if err := Verify(filename, ffmpeg, 4000); err == nil {
				t.Fatal("accepted corruption near the end of a track")
			}
		})
	}
}

func TestVerificationRequiresDecoder(t *testing.T) {
	if err := Verify("audio.m4a", filepath.Join(t.TempDir(), "missing-ffmpeg"), 4000); err == nil {
		t.Fatal("missing decoder silently skipped verification")
	}
}
