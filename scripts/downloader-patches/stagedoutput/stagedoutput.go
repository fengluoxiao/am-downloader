// Package stagedoutput keeps media editing local and publishes finished files.
package stagedoutput

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

type Output struct {
	Path        string
	destination string
	dir         string
	preserve    bool
}

func New(destination string) (*Output, error) {
	dir, err := os.MkdirTemp("", "am-track-")
	if err != nil {
		return nil, err
	}
	// The basename is unique too: the tag library names its own temporary files
	// using the media basename and a millisecond timestamp in the system temp dir.
	return &Output{
		Path:        filepath.Join(dir, filepath.Base(dir)+filepath.Ext(destination)),
		destination: destination, dir: dir,
	}, nil
}

func (o *Output) Close() {
	if !o.preserve {
		_ = os.RemoveAll(o.dir)
	}
}

// RetryIO retries only transient sharing/locking errors, never bad media or
// missing paths. Each attempt must close all file handles before returning.
func RetryIO(fn func() error) error {
	for attempt := 0; ; attempt++ {
		err := fn()
		transient := errors.Is(err, syscall.EBUSY) ||
			(runtime.GOOS == "windows" && (errors.Is(err, syscall.Errno(32)) || errors.Is(err, syscall.Errno(33))))
		if err == nil || !transient || attempt >= 40 {
			return err
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// Commit publishes the primary output and, when conversion kept it, the tagged
// original. Only completed files receive their final names on the destination.
func (o *Output) Commit(primary string) (string, error) {
	if filepath.Dir(primary) != o.dir {
		return "", fmt.Errorf("output is outside track workspace: %s", primary)
	}
	final := strings.TrimSuffix(o.destination, filepath.Ext(o.destination)) + filepath.Ext(primary)
	if err := publish(primary, final); err != nil {
		o.preserve = true
		return "", fmt.Errorf("publishing failed; completed local file kept at %s: %w", primary, err)
	}
	if primary != o.Path {
		if _, err := os.Stat(o.Path); err == nil {
			if err := publish(o.Path, o.destination); err != nil {
				o.preserve = true
				return "", fmt.Errorf("publishing original failed; local file kept at %s: %w", o.Path, err)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			o.preserve = true
			return "", err
		}
	}
	return final, nil
}

func publish(source, destination string) error {
	// Copy into a unique sibling before renaming, so a network disconnect does
	// not leave a truncated .m4a that a later download mistakes for a success.
	out, err := os.CreateTemp(filepath.Dir(destination), ".am-download-*.part")
	if err != nil {
		return err
	}
	temp := out.Name()
	defer os.Remove(temp)
	in, err := os.Open(source)
	if err != nil {
		_ = out.Close()
		return err
	}
	_, copyErr := io.Copy(out, in)
	inErr := in.Close()
	var syncErr error
	if copyErr == nil {
		syncErr = out.Sync()
	}
	outErr := out.Close()
	if err := errors.Join(copyErr, inErr, syncErr, outErr); err != nil {
		return err
	}
	return RetryIO(func() error {
		if _, err := os.Stat(destination); err == nil {
			return fmt.Errorf("destination already exists: %s", destination)
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return os.Rename(temp, destination)
	})
}
