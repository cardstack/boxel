// Pretui — MediaInspector unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { MediaInspector } from './media-inspector';
import type { MediaAssetSpec } from '../internal/media-viewer';

const CLIP: MediaAssetSpec = {
  src: 'https://example.test/media/cupping.mp4',
  name: 'Cupping walkthrough',
  width: 1920,
  height: 1080,
  duration: 65,
  bytes: 1_500_000,
  tracks: [{ src: 'en.vtt', label: 'English', kind: 'captions', srclang: 'en' }],
  meta: { Codec: 'H.264', Format: 'mp4' },
};

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-media-inspector]') as HTMLElement;
}
function rows(): [string, string][] {
  let dl = root().querySelector('[data-test-pretui-kv]') as HTMLElement;
  let dts = Array.from(dl.querySelectorAll('dt'));
  return dts.map((dt) => [dt.textContent?.trim() as string, (dt.nextElementSibling as HTMLElement).textContent?.trim() as string]);
}

module('Pretui | components/media-inspector', function (hooks) {
  setupCardTest(hooks);

  test('derives the fact rows from the asset and appends the caller meta, machine values as Tokens', async function (assert) {
    await render(<template><MediaInspector @asset={{CLIP}} /></template>);
    assert.strictEqual(root().getAttribute('aria-label'), 'Details');
    assert.strictEqual(root().querySelector('.pretui-minspector-name')?.textContent?.trim(), 'Cupping walkthrough');
    let keys = rows().map(([k]) => k);
    assert.deepEqual(keys, ['Kind', 'Dimensions', 'Duration', 'Size', 'Captions', 'Codec', 'Format']);
    let byKey = Object.fromEntries(rows());
    assert.strictEqual(byKey['Dimensions'], '1920 × 1080');
    assert.strictEqual(byKey['Duration'], '1:05');
    assert.strictEqual(byKey['Size'], '1.4 MB', 'binary units (1,500,000 / 1024² ≈ 1.43), because that is what a file manager shows — decimal would read 1.5 MB');
    assert.strictEqual(byKey['Captions'], 'English');
    assert.strictEqual(byKey['Codec'], 'H.264');
    let tokens = Array.from(root().querySelectorAll('dd [data-test-pretui-token]')).map((t) => t.textContent?.trim());
    assert.deepEqual(tokens.sort(), ['1920 × 1080', '1:05', '1.4 MB', 'mp4'].sort(), 'Dimensions, Size, Duration and Format wear the Token dress; prose rows do not');
  });

  test('metaOnly drops the derived rows; a caller title names the section', async function (assert) {
    await render(<template><MediaInspector @asset={{CLIP}} @metaOnly={{true}} @title='Encoding' /></template>);
    assert.strictEqual(root().getAttribute('aria-label'), 'Encoding');
    assert.deepEqual(rows().map(([k]) => k), ['Codec', 'Format']);
  });

  test('omits rows it cannot fill and renders the footer block', async function (assert) {
    const BARE: MediaAssetSpec = { src: 'https://example.test/media/notes.png' };
    await render(<template><MediaInspector @asset={{BARE}}><:footer><button type='button' data-test-foot>Replace</button></:footer></MediaInspector></template>);
    assert.deepEqual(rows().map(([k]) => k), ['Kind'], 'no dimensions, duration, size or captions to report');
    assert.strictEqual(root().querySelector('.pretui-minspector-name')?.textContent?.trim(), 'notes.png');
    assert.ok(root().querySelector('.pretui-minspector-footer [data-test-foot]'));
  });
});
