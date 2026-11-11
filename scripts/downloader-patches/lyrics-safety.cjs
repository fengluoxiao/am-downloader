// Apply small, checked changes to the pinned upstream parser. Optional metadata
// must never abort a download; invalid TTML is returned as an ordinary error.
module.exports = function patchLyrics(source) {
  let code = source.replace(/\r\n/g, '\n');
  const replace = (before, after, count = 1) => {
    if (code.split(before).length - 1 !== count) throw new Error(`Upstream lyrics parser changed: ${before}`);
    code = code.split(before).join(after);
  };
  replace('parsedTTML.FindElement("tt")', 'root', 9);
  replace('root.FindElement("body")', 'body', 2);
  replace('\tvar lrcLines []string', `
    root := parsedTTML.FindElement("tt")
    if root == nil { return "", errors.New("lyrics: missing TTML root") }
    body := root.FindElement("body")
    if body == nil { return "", errors.New("lyrics: missing TTML body") }
    var lrcLines []string`, 2);

  // Compare IDs directly; absent IDs and unmatched translation entries are normal.
  const links = [
    ['translit', 'transliterations', 'transliteration', 'lyric', 'text'],
    ['trans', 'translations', 'translation', 'lyric', '//text'],
    ['trans', 'transliterations', 'transliteration', 'item', 'text'],
    ['trans', 'translations', 'translation', 'item', '//text'],
  ];
  for (const [variable, plural, singular, line, selector] of links) {
    const pattern = new RegExp(`xpath := fmt\\.Sprintf\\([^\\n]+${line}\\.SelectAttr\\("itunes:key"\\)\\.Value\\)\\n([\\t ]+)${variable} := iTunesMetadata\\.FindElement\\("${plural}"\\)\\.FindElement\\("${singular}"\\)\\.FindElement\\(xpath\\)`);
    if (!pattern.test(code)) throw new Error(`Upstream lyrics metadata changed: ${plural}/${line}/${selector}`);
    code = code.replace(pattern, `${variable} := linkedLyricText(iTunesMetadata.FindElement("${plural}").FindElement("${singular}"), ${line})`);
  }
  replace('for i, span := range trans.ChildElements() {', 'for i, span := range optionalLyricChildren(trans) {');
  replace('var transTxt string', 'if trans != nil {\n\t\t\t\t\t\t\t\t\t\tvar transTxt string');
  replace('transLine = transBeginTime + transTxt\n\t\t\t\t\t\t\t\t\t\t}', 'transLine = transBeginTime + transTxt\n\t\t\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\t\t\t}');
  replace('lyric := lyrics.(*etree.Element)', 'lyric, ok := lyrics.(*etree.Element)\n\t\t\t\tif !ok { continue }');
  replace('endTime, err = parseTime(lyric.SelectAttr("end").Value, 1)', `endAttr := lyric.SelectAttr("end")
                if endAttr == nil { return "", errors.New("lyrics: syllable missing end time") }
                endTime, err = parseTime(endAttr.Value, 1)`);
  const unsafeChild = /} else {\n([\t ]+)textTmp = append\(textTmp, span\.\(\*etree\.Element\)\.Text\(\)\)/g;
  if ((code.match(unsafeChild) || []).length !== 2) throw new Error('Upstream lyric text iteration changed');
  code = code.replace(unsafeChild, '} else if element, ok := span.(*etree.Element); ok {\n$1textTmp = append(textTmp, element.Text())');
  return code + `
// Optional Apple translation/transliteration entries are linked by itunes:key.
func linkedLyricText(container, line *etree.Element) *etree.Element {
    if container == nil || line == nil { return nil }
    key := line.SelectAttrValue("itunes:key", "")
    if key == "" { return nil }
    for _, text := range container.FindElements(".//text") {
        if text.SelectAttrValue("for", "") == key { return text }
    }
    return nil
}

func optionalLyricChildren(element *etree.Element) []*etree.Element {
    if element == nil { return nil }
    return element.ChildElements()
}
`;
};
