package runv4

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	temarimod "github.com/WorldObservationLog/Temari/bindings/go"
	"github.com/grafov/m3u8"
	"github.com/itouakirai/mp4ff/mp4"
	"main/utils/structs"
	"main/utils/wrapperlite"
)

func TestDelayedKeyRotation(t *testing.T) {
	if err := Init(""); err != nil {
		t.Fatal(err)
	}
	golden := readTestdata(t, "template.json")
	requests := make(map[string]int)
	var requestsMu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uri := r.URL.Query().Get("uri")
		requestsMu.Lock()
		requests[uri]++
		requestsMu.Unlock()
		if uri != prefetchKey && r.URL.Query().Get("adamId") != "123" {
			t.Error("wrong track ID")
		}
		if strings.HasSuffix(uri, "/failed") {
			http.Error(w, "key unavailable", 500)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": json.RawMessage(golden)})
	}))
	defer srv.Close()
	client, err := wrapperlite.Init(srv.URL)
	if err != nil {
		t.Fatal(err)
	}

	// Both the real ALAC and Atmos playlists repeat the prefetch key for the
	// first two fragments, then switch at index 2 (roughly 30 seconds).
	playlist := `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:15
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="` + prefetchKey + `",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:15,
0.mp4
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="` + prefetchKey + `",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:15,
1.mp4
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://track/a",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:15,
2.mp4
#EXTINF:15,
3.mp4
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://track/b",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:15,
4.mp4
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://track/a",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:15,
5.mp4
#EXT-X-KEY:METHOD=NONE
#EXTINF:15,
6.mp4
#EXT-X-ENDLIST
`
	segments, err := parseMediaPlaylist(io.NopCloser(strings.NewReader(playlist)))
	if err != nil {
		t.Fatal(err)
	}
	cache := newTrackTemplates(client, "123")
	defer cache.Close()
	handles := make([]*temarimod.Temari, 6)
	for i := range handles {
		handles[i], err = cache.ForSegment(segments, i)
		if err != nil {
			t.Fatalf("fragment %d: %v", i, err)
		}
	}
	if handles[0] == nil || handles[0] != handles[1] || handles[0] == handles[2] ||
		handles[2] != handles[3] || handles[4] == handles[2] || handles[5] != handles[2] {
		t.Fatal("delayed/repeated key rotation assigned the wrong worker handles")
	}
	requestsMu.Lock()
	if requests["skd://track/a"] != 1 || requests["skd://track/b"] != 1 || requests[prefetchKey] > 1 {
		t.Fatalf("templates not reused: %v", requests)
	}
	requestsMu.Unlock()
	// Previously queued workers must still be able to decrypt after a switch.
	var wg sync.WaitGroup
	for _, handle := range handles {
		wg.Add(1)
		go func(h *temarimod.Temari) {
			defer wg.Done()
			got, err := h.Decrypt(readTestdata(t, "sample.ct"))
			if err != nil || !bytes.Equal(got, readTestdata(t, "sample.pt")) {
				t.Errorf("queued decrypt: %v", err)
			}
		}(handle)
	}
	wg.Wait()
	if got, err := cache.ForSegment(segments, 6); err != nil || got != nil {
		t.Fatal("METHOD=NONE did not clear the inherited key")
	}
	bad := []*m3u8.MediaSegment{{Key: &m3u8.Key{Method: "SAMPLE-AES", URI: "skd://track/failed"}}}
	if got, err := cache.ForSegment(bad, 0); err == nil || got != nil {
		t.Fatal("failed key fetch silently reused an old key")
	}
	cache.Close()
	cache.Close() // Cleanup is safe even on an error path with repeated URIs.
	for _, handle := range handles[2:] {
		if _, err := handle.Decrypt(nil); err == nil {
			t.Error("track template leaked after workers stopped")
		}
	}
	if _, err := handles[0].Decrypt(nil); err != nil {
		t.Fatal("closed the shared prefetch template")
	}
}

func TestSegmentKeyValidation(t *testing.T) {
	cache := newTrackTemplates(nil, "123")
	for _, index := range []int{-1, 0, 1} {
		if _, err := cache.ForSegment([]*m3u8.MediaSegment{nil}, index); err == nil {
			t.Errorf("accepted missing segment %d", index)
		}
	}
	for _, key := range []*m3u8.Key{{Method: "SAMPLE-AES"}, {Method: "AES-128", URI: "skd://track/a"}} {
		if _, err := cache.ForSegment([]*m3u8.MediaSegment{{Key: key}}, 0); err == nil {
			t.Error("accepted an invalid key")
		}
	}
	if got, err := cache.ForSegment([]*m3u8.MediaSegment{{}}, 0); err != nil || got != nil {
		t.Fatal("unencrypted segment rejected")
	}
	frag := mp4.NewFragment()
	frag.Moof = &mp4.MoofBox{Trafs: []*mp4.TrafBox{{Tfhd: &mp4.TfhdBox{TrackID: 1}}}}
	tracks := map[uint32]mp4.DecryptTrackInfo{1: {Sinf: &mp4.SinfBox{}}}
	if err := DecryptFragment(frag, tracks, nil); err == nil || !strings.Contains(err.Error(), "no decryption template") {
		t.Fatal("encrypted fragment without a key must fail before writing corrupted audio")
	}
}

func TestIncompleteMediaIsNotPublished(t *testing.T) {
	init := mp4.CreateEmptyInit()
	init.AddEmptyTrack(48000, "audio", "und")
	if err := init.Moov.Trak.SetEC3Descriptor(&mp4.Dec3Box{DataRate: 448, EC3Subs: []mp4.EC3Sub{{BSID: 16, ACMod: 7, LFEOn: 1}}}); err != nil {
		t.Fatal(err)
	}
	var header, fragment bytes.Buffer
	if err := init.Encode(&header); err != nil {
		t.Fatal(err)
	}
	frag, err := mp4.CreateFragment(1, 1)
	if err != nil {
		t.Fatal(err)
	}
	data := bytes.Repeat([]byte{0x0b, 0x77, 0, 0}, 32)
	frag.AddFullSample(mp4.FullSample{Sample: mp4.NewSample(0x02000000, 1536, uint32(len(data)), 0), Data: data})
	if err := frag.Encode(&fragment); err != nil {
		t.Fatal(err)
	}
	fixture := append(header.Bytes(), fragment.Bytes()...)
	segments := []*m3u8.MediaSegment{{Duration: 15}, {Duration: 15}, nil}
	for _, test := range []struct {
		name      string
		segments  []*m3u8.MediaSegment
		wantError bool
	}{
		{"complete", segments[:1], false},
		{"missing-final-fragment", segments, true},
		{"extra-fragment", nil, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			output := filepath.Join(t.TempDir(), "audio.m4a")
			err := downloadAndDecryptFile(nil, bytes.NewReader(fixture), output, "123", test.segments, int64(len(fixture)), structs.ConfigSet{MaxMemoryLimit: 1})
			if (err != nil) != test.wantError {
				t.Fatalf("pipeline result: %v", err)
			}
		})
	}
	// An EOF between moof and mdat must never look like a clean end of stream.
	var partial bytes.Buffer
	if err := frag.Moof.Encode(&partial); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReadNextFragment(&partial, 0); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("truncated fragment: %v", err)
	}
}
