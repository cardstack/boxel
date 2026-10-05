// Pretui — the media asset helpers: pure functions, no DOM.
import { module, test } from 'qunit';
import { basenameOf, safeHref } from './media-viewer';

module('Pretui | internal/media-viewer', function () {
  test('basenameOf decodes the file name, and keeps a malformed one as written', function (assert) {
    assert.strictEqual(basenameOf('/files/Tasting%20notes.pdf'), 'Tasting notes.pdf');
    assert.strictEqual(basenameOf('/files/100%.png'), '100%.png', 'a stray % does not throw');
    assert.strictEqual(basenameOf('/files/lot.png?v=2#top'), 'lot.png');
    assert.strictEqual(basenameOf('data:image/png;base64,AAAA'), 'Untitled asset');
  });

  test('safeHref links only http(s) and blob URLs', function (assert) {
    assert.strictEqual(safeHref('https://example.com/a.mp4'), 'https://example.com/a.mp4');
    assert.strictEqual(safeHref('/files/a.mp4'), '/files/a.mp4', 'a relative path resolves to http(s)');
    assert.strictEqual(safeHref('blob:https://example.com/1234'), 'blob:https://example.com/1234');
    assert.strictEqual(safeHref('javascript:alert(1)'), undefined);
    assert.strictEqual(safeHref('JavaScript:alert(1)'), undefined, 'case does not help');
    assert.strictEqual(safeHref('data:text/html,<b>x</b>'), undefined);
    assert.strictEqual(safeHref(undefined), undefined);
  });
});
