// Pretui — MediaViewer unit tests.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { MediaViewer } from './media-viewer';
import type { MediaAssetSpec } from '../internal/media-viewer';

module('Pretui | components/media-viewer', function (hooks) {
  setupCardTest(hooks);

  test('an image asset renders in an image frame', async function (assert) {
    const PHOTO: MediaAssetSpec = { src: '/lots/gyokuro.jpg', alt: 'Shaded tea rows' };
    await render(<template><MediaViewer @asset={{PHOTO}} /></template>);
    assert.strictEqual(document.querySelector('img')?.getAttribute('alt'), 'Shaded tea rows');
  });

  test('a file with a % in its name does not take the viewer down', async function (assert) {
    const ODD: MediaAssetSpec = { src: '/files/100%.bin' };
    await render(<template><MediaViewer @asset={{ODD}} /></template>);
    assert.true(document.body.textContent?.includes('100%.bin'), 'it names the file as written');
  });

  test('the fallback links only a safe source', async function (assert) {
    const SAFE: MediaAssetSpec = { src: 'https://example.com/report.bin' };
    await render(<template><MediaViewer @asset={{SAFE}} /></template>);
    assert.strictEqual(document.querySelector('.pretui-mviewer-link')?.getAttribute('href'), 'https://example.com/report.bin');
    const UNSAFE: MediaAssetSpec = { src: 'javascript:alert(1)', name: 'report.bin' };
    await render(<template><MediaViewer @asset={{UNSAFE}} /></template>);
    assert.strictEqual(document.querySelector('.pretui-mviewer-link'), null, 'no link for a script URL');
  });
});
