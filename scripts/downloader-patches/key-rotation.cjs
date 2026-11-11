// Patch the pinned reader, keeping template ownership outside its worker group.
module.exports = function patchKeyRotation(source) {
  let code = source.replace(/\r\n/g, '\n');
  const replace = (before, after) => {
    if (code.split(before).length !== 2) throw new Error(`Upstream key reader changed: ${before}`);
    code = code.replace(before, after);
  };
  replace(`\t// Per-track template (not the shared prefetch) is closed when the run ends
\t// to free the native Rust handle.
\tvar trackTmpl *temarimod.Temari
\tdefer func() {
\t\tif trackTmpl != nil && trackTmpl != prefetchTmpl {
\t\t\ttrackTmpl.Close()
\t\t}
\t}()`, `\t// Keep every template alive until all decrypt workers have stopped.
\ttemplates := newTrackTemplates(client, adamId)
\tdefer templates.Close()`);
  replace('\t\tvar tmpl *temarimod.Temari\n', '');
  const start = code.indexOf('\t\t\tsegment := playlistSegments[i]');
  const end = code.indexOf('\n\t\t\t// 将任务发送给 Workers', start);
  if (start < 0 || end < 0 || !code.slice(start, end).includes('key != nil && i < 2')) {
    throw new Error('Upstream fragment key selection changed');
  }
  code = code.slice(0, start) + `\t\t\ttmpl, keyErr := templates.ForSegment(playlistSegments, i)
\t\t\tif keyErr != nil { return keyErr }
` + code.slice(end);
  replace(`\t\t\tif frag == nil {
\t\t\t\tbreak // 读到文件末尾
\t\t\t}`, `\t\t\tif frag == nil {
\t\t\t\tif i < len(playlistSegments) && playlistSegments[i] != nil {
\t\t\t\t\treturn fmt.Errorf("incomplete media: missing fragment %d", i)
\t\t\t\t}
\t\t\t\tbreak
\t\t\t}`);
  replace(`\t\tif err == io.EOF {
\t\t\treturn nil, offset, nil
\t\t}`, `\t\tif err == io.EOF {
\t\t\tif frag.Moof != nil { return nil, offset, io.ErrUnexpectedEOF }
\t\t\treturn nil, offset, nil
\t\t}`);
  replace('if err := eg.Wait(); err != nil && !errors.Is(err, context.Canceled) {', 'if err := eg.Wait(); err != nil {');
  replace('\t\tschemeType := ti.Sinf.Schm.SchemeType', `\t\tif tmpl == nil { return errors.New("encrypted fragment has no decryption template") }
\t\tschemeType := ti.Sinf.Schm.SchemeType`);
  // METHOD=NONE has no KEYFORMAT and explicitly ends the inherited key.
  replace('!bytes.Contains(lineBytes, keyFormat) {', '!bytes.Contains(lineBytes, keyFormat) && !bytes.Contains(lineBytes, []byte("METHOD=NONE")) {');
  return code;
};
