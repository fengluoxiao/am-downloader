//go:build stagingintegration

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"

	"github.com/zhaarey/go-mp4tag"
	"main/utils/stagedoutput"
	"main/utils/task"
)

func TestConcurrentRealMetadataAndPublication(t *testing.T) {
	tool := os.Getenv("AM_TEST_MP4BOX")
	if tool == "" {
		t.Skip("set AM_TEST_MP4BOX to test real media metadata writing")
	}
	root := t.TempDir()
	srt := filepath.Join(root, "fixture.srt")
	if err := os.WriteFile(srt, []byte("1\n00:00:00,000 --> 00:00:01,000\nfixture\n"), 0600); err != nil {
		t.Fatal(err)
	}
	seed := filepath.Join(root, "fixture.m4a")
	for _, args := range [][]string{{"-add", srt, "-new", seed}, {"-itags", "artist=AppleMusic", seed}} {
		if output, err := exec.Command(tool, args...).CombinedOutput(); err != nil {
			t.Fatalf("MP4Box: %v %s", err, output)
		}
	}
	fixture, err := os.ReadFile(seed)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			album := fmt.Sprintf("专辑 %d", i)
			dir := filepath.Join(root, album)
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Error(err)
				return
			}
			dest := filepath.Join(dir, "03. 相同曲名 (LIVE).m4a")
			o, err := stagedoutput.New(dest)
			if err != nil {
				t.Error(err)
				return
			}
			defer o.Close()
			if err := os.WriteFile(o.Path, fixture, 0600); err != nil {
				t.Error(err)
				return
			}
			track := &task.Track{SavePath: o.Path}
			track.Resp.Attributes.Name = "相同曲名 (LIVE)"
			track.Resp.Attributes.ArtistName = "测试歌手"
			track.Resp.Attributes.GenreNames = []string{"Pop"}
			track.Resp.Attributes.TrackNumber = 3
			track.Resp.Attributes.DiscNumber = 1
			track.Resp.Attributes.AlbumName = album
			if err := writeMP4Tags(track, "歌词 "+album); err != nil {
				t.Error(err)
				return
			}
			published, err := o.Commit(o.Path)
			if err != nil {
				t.Error(err)
				return
			}
			mp4, err := mp4tag.Open(published)
			if err != nil {
				t.Error(err)
				return
			}
			defer mp4.Close()
			tags, err := mp4.Read()
			if err != nil {
				t.Error(err)
				return
			}
			if tags.Album != album || tags.Lyrics != "歌词 "+album || tags.Title != "相同曲名 (LIVE)" {
				t.Errorf("metadata crossed between tracks: %+v", tags)
			}
		}()
	}
	wg.Wait()
}
