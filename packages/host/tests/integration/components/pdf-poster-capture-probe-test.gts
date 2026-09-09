// TEMP DEBUG PROBE (will be reverted): exercises PdfPosterCapture's full
// async chain (loader shim -> fetch -> pdf.js -> canvas paint) in a real
// browser, outside the prerender capture route.
import { waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | TEMP pdf poster capture probe', function (hooks) {
  setupRenderingTest(hooks);

  test('pending clears after painting page 1 of a data-url PDF', async function (assert) {
    let { PdfPosterCapture } =
      await import('@cardstack/base/file-formats/pdf-captures');
    let pdfB64 =
      'JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1MiAwMDAwMCBuIAowMDAwMDAwMTAxIDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTY0CiUlRU9G';
    let model = {
      url: `data:application/pdf;base64,${pdfB64}`,
      name: 'probe.pdf',
      contentType: 'application/pdf',
    };
    await renderComponent(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style='position: relative; width: 170px; height: 250px;'>
          <PdfPosterCapture @model={{model}} />
        </div>
      </template>,
    );
    let cleared = false;
    try {
      await waitUntil(
        () => document.querySelector('[data-screenshot-pending]') == null,
        { timeout: 20000 },
      );
      cleared = true;
    } catch {
      // fall through to the assert below
    }
    assert.true(cleared, 'data-screenshot-pending cleared within 20s');
  });
});
