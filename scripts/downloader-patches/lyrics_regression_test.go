package lyrics

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"main/utils/wrapperlite"
)

// Real service responses stay in the ignored cache, never in the repository.
func TestObservedLyrics(t *testing.T) {
	filename := os.Getenv("AM_TEST_TTML")
	if filename == "" {
		t.Skip("AM_TEST_TTML not supplied")
	}
	input, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	got, err := TtmlToLrc(string(input))
	if err != nil || strings.TrimSpace(got) == "" {
		t.Fatalf("observed lyrics conversion failed: %v", err)
	}
}

// Synthetic TTML exercises the optional metadata which caused download panics.
func TestOptionalLyricMetadata(t *testing.T) {
	metadata := `<head><metadata><iTunesMetadata><transliterations><transliteration><text for="other">romaji</text></transliteration></transliterations><translations><translation><text for="other">translation</text></translation></translations></iTunesMetadata></metadata></head>`
	tests := []struct{ name, timing, line, want string }{
		{"line without key", "Line", `<p begin="00:01.000">歌詞</p>`, "[00:01.00]歌詞"},
		{"line unmatched key", "Line", `<p begin="00:01.000" itunes:key="missing">歌詞</p>`, "[00:01.00]歌詞"},
		{"word without key", "Word", `<p><span begin="00:01.000" end="00:02.000">歌詞</span></p>`, "[00:01.00]<00:01.00>歌詞<00:02.00>"},
		{"word unmatched key", "Word", `<p itunes:key="missing"><span begin="00:01.000" end="00:02.000">歌詞</span></p>`, "[00:01.00]<00:01.00>歌詞<00:02.00>"},
		{"comments in line", "Line", `<p begin="00:01.000">歌<!-- comment --><span>詞</span></p>`, "[00:01.00]歌詞"},
		{"comments between words", "Word", `<p><!-- comment --><span begin="00:01.000" end="00:02.000">歌<!-- comment -->詞</span></p>`, "[00:01.00]<00:01.00>歌詞<00:02.00>"},
		{"quoted key is literal", "Line", `<p begin="00:01.000" itunes:key="x'[]">歌詞</p>`, "[00:01.00]歌詞"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ttml := `<tt xmlns:itunes="urn:test" itunes:timing="` + tc.timing + `">` + metadata + `<body><div>` + tc.line + `</div></body></tt>`
			got, err := TtmlToLrc(ttml)
			if err != nil || got != tc.want {
				t.Fatalf("got %q, %v; want %q", got, err, tc.want)
			}
		})
	}
}

func TestMalformedLyricsReturnErrors(t *testing.T) {
	for _, input := range []string{
		``, `<html/>`, `<tt/>`, `<tt><body>`,
		`<tt xmlns:itunes="urn:test" itunes:timing="Word"/>`,
		`<tt xmlns:itunes="urn:test" itunes:timing="Word"><body><div><p><span begin="00:01.000">missing end</span></p></div></body></tt>`,
	} {
		t.Run(input, func(t *testing.T) {
			if _, err := TtmlToLrc(input); err == nil {
				t.Fatal("expected a lyrics error")
			}
		})
	}
}

func TestLinkedLyricsArePreserved(t *testing.T) {
	line := `<tt xmlns:itunes="urn:test"><head><metadata><iTunesMetadata><transliterations><transliteration><text for="a">romaji</text></transliteration></transliterations><translations><translation><text for="a" text="translation"/></translation></translations></iTunesMetadata></metadata></head><body><div><p begin="00:01.000" itunes:key="a">歌詞</p></div></body></tt>`
	if got, err := TtmlToLrc(line); err != nil || got != "[00:01.00]translation\n[00:01.00]romaji" {
		t.Fatalf("line: %q, %v", got, err)
	}
	word := strings.ReplaceAll(line, `<tt xmlns:itunes="urn:test">`, `<tt xmlns:itunes="urn:test" itunes:timing="Word">`)
	word = strings.ReplaceAll(word, `>romaji</text>`, `><span begin="00:01.000">romaji</span></text>`)
	word = strings.ReplaceAll(word, `>歌詞</p>`, `><span begin="00:01.000" end="00:02.000">歌詞</span></p>`)
	if got, err := TtmlToLrc(word); err != nil || got != "[00:01.00]translation\n[00:01.00]<00:01.00>romaji" {
		t.Fatalf("word: %q, %v", got, err)
	}
	plain := `<tt xmlns:itunes="urn:test" itunes:timing="None"><body><div><p>plain lyrics</p></div></body></tt>`
	if got, err := TtmlToLrc(plain); err != nil || got != "plain lyrics" {
		t.Fatalf("plain: %q, %v", got, err)
	}
}

func TestLyricsHTTPConversion(t *testing.T) {
	oldClient := wrapperlite.Default
	t.Cleanup(func() { wrapperlite.Default = oldClient })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input := `<tt><body><div><p begin="00:01.000">ok</p></div></body></tt>`
		if r.URL.Query().Get("adamId") == "malformed" {
			input = `<tt/>`
		}
		json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]string{"lyrics": input}})
	}))
	defer server.Close()
	if _, err := wrapperlite.Init(server.URL); err != nil {
		t.Fatal(err)
	}
	if _, err := Get("malformed", "", "", "lrc"); err == nil {
		t.Fatal("expected conversion error")
	}
	if got, err := Get("valid", "", "", "lrc"); err != nil || got != "[00:01.00]ok" {
		t.Fatalf("next song: %q, %v", got, err)
	}
	if got, err := Get("malformed", "", "", "ttml"); err != nil || got != `<tt/>` {
		t.Fatalf("raw TTML: %q, %v", got, err)
	}
}
