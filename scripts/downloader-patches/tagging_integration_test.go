//go:build stagingintegration

package main

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"

	"github.com/Eyevinn/mp4ff/aac"
	"github.com/itouakirai/mp4ff/mp4"
	"github.com/zhaarey/go-mp4tag"
	"main/utils/mediaprep"
	"main/utils/stagedoutput"
	"main/utils/task"
)

func TestISO5FragmentedMetadataRoundTrip(t *testing.T) {
	tool := os.Getenv("AM_TEST_MP4BOX")
	if tool == "" {
		t.Skip("set AM_TEST_MP4BOX")
	}
	t.Setenv("PATH", filepath.Dir(tool)+string(os.PathListSeparator)+os.Getenv("PATH"))
	for _, fixtureCase := range []struct {
		codec string
		flat  bool
	}{{"aac", false}, {"ec3-joc", false}, {"aac", true}, {"ec3-joc", true}} {
		t.Run(fmt.Sprintf("%s/flat=%t", fixtureCase.codec, fixtureCase.flat), func(t *testing.T) {
			codec := fixtureCase.codec
			dir := t.TempDir()
			filename := filepath.Join(dir, "01. 中文歌曲.m4a")
			init := mp4.CreateEmptyInit()
			init.Ftyp = mp4.NewFtyp("iso5", 0, []string{"iso5", "iso6"})
			init.Children[0] = init.Ftyp
			init.AddEmptyTrack(48000, "audio", "und")
			var dec3 *mp4.Dec3Box
			if codec == "aac" {
				if err := init.Moov.Trak.SetAACDescriptor(aac.AAClc, 48000); err != nil {
					t.Fatal(err)
				}
			} else {
				dec3 = &mp4.Dec3Box{DataRate: 448, EC3Subs: []mp4.EC3Sub{{BSID: 16, ACMod: 7, LFEOn: 1}}, Reserved: []byte{1, 16}}
				if err := init.Moov.Trak.SetEC3Descriptor(dec3); err != nil {
					t.Fatal(err)
				}
			}
			var fixture, expectedMedia bytes.Buffer
			if err := init.Encode(&fixture); err != nil {
				t.Fatal(err)
			}
			// Synthetic compressed samples: MP4Box must copy these bytes verbatim,
			// including the opaque JOC payload, rather than transcode the audio.
			for i := 0; i < 3; i++ {
				data := bytes.Repeat([]byte{0x0b, 0x77, byte(i), 0x41}, 32)
				expectedMedia.Write(data)
				fragment, err := mp4.CreateFragment(uint32(i+1), 1)
				if err != nil {
					t.Fatal(err)
				}
				fragment.AddFullSample(mp4.FullSample{Sample: mp4.NewSample(0x02000000, 1536, uint32(len(data)), 0), DecodeTime: uint64(i * 1536), Data: data})
				if err := fragment.Encode(&fixture); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filename, fixture.Bytes(), 0600); err != nil {
				t.Fatal(err)
			}
			if fixtureCase.flat {
				// Also cover an already flattened file whose source brand survived
				// embedding: the header reported by the failing downloader is iso5.
				if log, err := exec.Command(tool, "-itags", "artist=AppleMusic", "-brand", "iso5", filename).CombinedOutput(); err != nil {
					t.Fatalf("iso5 embedding: %v %s", err, log)
				}
			}
			if original, err := mp4tag.Open(filename); err == nil {
				original.Close()
				t.Fatal("expected original iso5 header rejection")
			} else if _, ok := err.(*mp4tag.ErrUnsupportedFtyp); !ok {
				t.Fatalf("expected unsupported ftyp, got %v", err)
			}
			var cover bytes.Buffer
			if err := png.Encode(&cover, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
				t.Fatal(err)
			}
			coverPath := filepath.Join(dir, "cover.png")
			if err := os.WriteFile(coverPath, cover.Bytes(), 0600); err != nil {
				t.Fatal(err)
			}
			if err := mediaprep.Embed(filename, "artist=AppleMusic:cover="+coverPath); err != nil {
				t.Fatal(err)
			}
			track := &task.Track{SavePath: filename}
			track.Resp.Attributes.Name = "测试主题曲"
			track.Resp.Attributes.ArtistName = "测试歌手"
			track.Resp.Attributes.AlbumName = "测试专辑"
			track.Resp.Attributes.GenreNames = []string{"Pop"}
			if err := writeMP4Tags(track, "完整歌词"); err != nil {
				t.Fatal(err)
			}
			reader, err := mp4tag.Open(filename)
			if err != nil {
				t.Fatal(err)
			}
			tags, err := reader.Read()
			reader.Close()
			if err != nil {
				t.Fatal(err)
			}
			if tags.Title != "测试主题曲" || tags.Artist != "测试歌手" || tags.Album != "测试专辑" || tags.Lyrics != "完整歌词" {
				t.Fatalf("missing tags: %+v", tags)
			}
			if len(tags.Pictures) != 1 || !bytes.Equal(tags.Pictures[0].Data, cover.Bytes()) {
				t.Fatal("cover did not survive metadata writing")
			}
			result, err := os.ReadFile(filename)
			if err != nil {
				t.Fatal(err)
			}
			parsed, err := mp4.DecodeFile(bytes.NewReader(result))
			if err != nil {
				t.Fatal(err)
			}
			if parsed.Moov.Mvex != nil || parsed.Mdat == nil || !bytes.Equal(parsed.Mdat.Data, expectedMedia.Bytes()) {
				t.Fatal("not flattened or compressed audio bytes changed")
			}
			stbl := parsed.Moov.Trak.Mdia.Minf.Stbl
			if stbl.Stsz.SampleNumber != 3 || stbl.Stco == nil || len(stbl.Stco.ChunkOffset) == 0 {
				t.Fatal("invalid sample tables")
			}
			if uint64(stbl.Stco.ChunkOffset[0]) != parsed.Mdat.PayloadAbsoluteOffset() {
				t.Fatal("metadata rewriting broke the audio chunk offset")
			}
			if codec == "aac" && stbl.Stsd.Mp4a == nil {
				t.Fatal("AAC codec lost")
			}
			if dec3 != nil {
				if stbl.Stsd.EC3 == nil || stbl.Stsd.EC3.Dec3 == nil {
					t.Fatal("Dolby codec configuration lost")
				}
				var before, after bytes.Buffer
				dec3.Encode(&before)
				stbl.Stsd.EC3.Dec3.Encode(&after)
				if !bytes.Equal(before.Bytes(), after.Bytes()) {
					t.Fatal("Dolby/JOC dec3 configuration changed")
				}
			}
		})
	}
}

func TestRemuxFailurePreservesInput(t *testing.T) {
	tool := os.Getenv("AM_TEST_MP4BOX")
	if tool == "" {
		t.Skip("set AM_TEST_MP4BOX")
	}
	t.Setenv("PATH", filepath.Dir(tool)+string(os.PathListSeparator)+os.Getenv("PATH"))
	dir := t.TempDir()
	filename := filepath.Join(dir, "invalid.m4a")
	input := []byte("invalid media must not be overwritten")
	if err := os.WriteFile(filename, input, 0600); err != nil {
		t.Fatal(err)
	}
	if err := mediaprep.Embed(filename, "artist=AppleMusic"); err == nil {
		t.Fatal("expected remux failure")
	}
	got, err := os.ReadFile(filename)
	if err != nil || !bytes.Equal(got, input) {
		t.Fatal("input changed after failed remux")
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 1 {
		t.Fatal("remux temp files leaked")
	}
}

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
