package stagedoutput

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestWindowsSharingViolationIsRetriedUntilReleased(t *testing.T) {
	file := filepath.Join(t.TempDir(), "共享占用.m4a")
	if err := os.WriteFile(file, []byte("audio"), 0600); err != nil {
		t.Fatal(err)
	}
	name, err := windows.UTF16PtrFromString(file)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		time.Sleep(600 * time.Millisecond)
		windows.CloseHandle(handle)
		close(done)
	}()
	calls := 0
	err = RetryIO(func() error {
		calls++
		f, err := os.OpenFile(file, os.O_RDWR, 0600)
		if err != nil {
			return err
		}
		return f.Close()
	})
	<-done
	if err != nil || calls < 2 {
		t.Fatalf("sharing violation not retried: attempts=%d err=%v", calls, err)
	}
}
