package runv4

import (
	"fmt"

	temarimod "github.com/WorldObservationLog/Temari/bindings/go"
	"github.com/grafov/m3u8"
	"main/utils/wrapperlite"
)

// Only the reader accesses this cache. Workers borrow handles until eg.Wait;
// Close must run after that wait, including when a later key request fails.
type trackTemplates struct {
	client  *wrapperlite.Client
	adamID  string
	byURI   map[string]*temarimod.Temari
	current *temarimod.Temari
}

func newTrackTemplates(client *wrapperlite.Client, adamID string) *trackTemplates {
	return &trackTemplates{client: client, adamID: adamID, byURI: make(map[string]*temarimod.Temari)}
}

func (t *trackTemplates) ForSegment(segments []*m3u8.MediaSegment, index int) (*temarimod.Temari, error) {
	if index < 0 || index >= len(segments) || segments[index] == nil {
		return nil, fmt.Errorf("fragment %d: segment number out of sync", index)
	}
	key := segments[index].Key
	if key == nil {
		return t.current, nil // EXT-X-KEY remains in force until changed.
	}
	if key.Method == "NONE" {
		t.current = nil
		return nil, nil
	}
	if key.Method != "SAMPLE-AES" || key.URI == "" {
		return nil, fmt.Errorf("fragment %d: unsupported or missing encryption key", index)
	}
	tmpl := t.byURI[key.URI]
	if tmpl == nil {
		var err error
		if key.URI == prefetchKey {
			tmpl, err = prefetchTemplate(t.client)
		} else {
			tmpl, err = fetchTemplate(t.client, t.adamID, key.URI)
		}
		if err != nil {
			return nil, fmt.Errorf("fragment %d: get decryption template: %w", index, err)
		}
		t.byURI[key.URI] = tmpl
	}
	t.current = tmpl
	return tmpl, nil
}

func (t *trackTemplates) Close() {
	for uri, tmpl := range t.byURI {
		if uri != prefetchKey { // Shared across tracks for the process lifetime.
			tmpl.Close()
		}
		delete(t.byURI, uri)
	}
	t.current = nil
}
