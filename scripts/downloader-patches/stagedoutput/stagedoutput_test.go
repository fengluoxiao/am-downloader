package stagedoutput

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
)

func TestConcurrentTracks(t *testing.T) {
	dir := t.TempDir()
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			dest := filepath.Join(dir, fmt.Sprintf("%02d. 中文歌曲 (LIVE).m4a", i))
			o, err := New(dest)
			if err != nil {
				t.Error(err)
				return
			}
			defer o.Close()
			if _, err := os.Stat(dest); !errors.Is(err, os.ErrNotExist) {
				t.Error("unfinished media is visible")
			}
			data := bytes.Repeat([]byte(fmt.Sprintf("audio and tags for track %d\n", i)), 8000)
			if err := os.WriteFile(o.Path, data, 0600); err != nil {
				t.Error(err)
				return
			}
			got, err := o.Commit(o.Path)
			if err != nil {
				t.Error(err)
				return
			}
			if got != dest {
				t.Error("receipt must use destination path")
			}
			actual, err := os.ReadFile(dest)
			if err != nil || !bytes.Equal(data, actual) {
				t.Errorf("track %d was corrupted: %v", i, err)
			}
		}()
	}
	wg.Wait()
	parts, _ := filepath.Glob(filepath.Join(dir, ".am-download-*"))
	if len(parts) != 0 {
		t.Errorf("unclosed publish files: %v", parts)
	}
}

func TestIdenticalNamesHaveUniqueWorkspacesAndTagTempBasenames(t *testing.T) {
	a, err := New(filepath.Join(t.TempDir(), "01. Intro.m4a"))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := New(filepath.Join(t.TempDir(), "01. Intro.m4a"))
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if a.Path == b.Path || filepath.Base(a.Path) == filepath.Base(b.Path) {
		t.Fatal("track/tag temporary names collide")
	}
}

func TestConvertedOutputKeepsOriginal(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "无损歌曲.m4a")
	o, err := New(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer o.Close()
	converted := o.Path[:len(o.Path)-4] + ".flac"
	if err := os.WriteFile(o.Path, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(converted, []byte("converted"), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := o.Commit(converted)
	if err != nil {
		t.Fatal(err)
	}
	if got != dest[:len(dest)-4]+".flac" {
		t.Fatal("converted receipt path changed")
	}
	for file, want := range map[string]string{dest: "original", got: "converted"} {
		data, err := os.ReadFile(file)
		if err != nil || string(data) != want {
			t.Fatalf("%s: %s %v", file, data, err)
		}
	}
}

func TestFailedPublishPreservesCompletedLocalFileAndExistingDestination(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "existing.m4a")
	o, err := New(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(o.dir)
	if err := os.WriteFile(dest, []byte("existing user file"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(o.Path, []byte("completed new file"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := o.Commit(o.Path); err == nil {
		t.Fatal("must not replace an existing song")
	}
	o.Close()
	for file, want := range map[string]string{dest: "existing user file", o.Path: "completed new file"} {
		data, err := os.ReadFile(file)
		if err != nil || string(data) != want {
			t.Fatalf("%s: %s %v", file, data, err)
		}
	}
}

func TestRetryOnlyTransientErrors(t *testing.T) {
	calls := 0
	if err := RetryIO(func() error {
		calls++
		if calls < 3 {
			return fmt.Errorf("locked: %w", syscall.EBUSY)
		}
		return nil
	}); err != nil || calls != 3 {
		t.Fatal(err, calls)
	}
	calls = 0
	err := RetryIO(func() error { calls++; return os.ErrPermission })
	if !errors.Is(err, os.ErrPermission) || calls != 1 {
		t.Fatal("permission errors must fail immediately")
	}
}
