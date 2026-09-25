import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as DocxDefModule from '@cardstack/base/docx-file-def';
import type * as MetadataFieldsModule from '@cardstack/base/file-formats/metadata-fields';
import type * as OfficeCapturesModule from '@cardstack/base/file-formats/office-captures';
import type * as PptxDefModule from '@cardstack/base/pptx-file-def';
import type * as XlsxDefModule from '@cardstack/base/xlsx-file-def';

// The Office families' poster capture, rendered directly: which branch the
// extracted structure selects is decided by synchronous getters over the
// file's fields, so it is observable here without a capture engine. The
// realm-server suite covers the other half of the contract — that the
// resulting slot lands on the file row and reaches the fitted cell.
module('Integration | office poster capture', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let OfficePosterCapture: typeof OfficeCapturesModule.OfficePosterCapture;
  let DocxDef: typeof DocxDefModule.DocxDef;
  let PptxDef: typeof PptxDefModule.PptxDef;
  let XlsxDef: typeof XlsxDefModule.XlsxDef;
  let OfficeMetadataField: typeof MetadataFieldsModule.OfficeMetadataField;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    ({ OfficePosterCapture } = await loader.import<typeof OfficeCapturesModule>(
      `${baseRealm.url}file-formats/office-captures`,
    ));
    ({ DocxDef } = await loader.import<typeof DocxDefModule>(
      `${baseRealm.url}docx-file-def`,
    ));
    ({ PptxDef } = await loader.import<typeof PptxDefModule>(
      `${baseRealm.url}pptx-file-def`,
    ));
    ({ XlsxDef } = await loader.import<typeof XlsxDefModule>(
      `${baseRealm.url}xlsx-file-def`,
    ));
    ({ OfficeMetadataField } = await loader.import<typeof MetadataFieldsModule>(
      `${baseRealm.url}file-formats/metadata-fields`,
    ));
  });

  function fileAttrs(name: string, contentType: string) {
    return {
      id: `http://example.com/files/${name}`,
      url: `http://example.com/files/${name}`,
      sourceUrl: `http://example.com/files/${name}`,
      name,
      contentType,
    };
  }

  const DOCX_TYPE =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const PPTX_TYPE =
    'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const XLSX_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  test('a document with no extracted first unit captures the typed placeholder', async function (assert) {
    // No officeMetadata at all — the shape an oversize or fact-less package
    // leaves behind. The family's static previewKind still types the paper.
    let file = new DocxDef(fileAttrs('empty.docx', DOCX_TYPE));
    await renderComponent(
      <template><OfficePosterCapture @model={{file}} /></template>,
    );
    assert
      .dom('[data-test-office-poster-placeholder]')
      .hasAttribute('data-kind', 'word', 'the placeholder is typed');
    assert.dom('[data-test-office-placeholder-badge]').hasText('DOCX');
    assert
      .dom('[data-test-office-placeholder-count]')
      .doesNotExist('no structural count without metadata');
    assert
      .dom('[data-test-office-poster-page]')
      .doesNotExist('the text-flow branch does not render');
  });

  test('metadata without a preview payload still captures the placeholder, with its count', async function (assert) {
    let file = new DocxDef({
      ...fileAttrs('facts-only.docx', DOCX_TYPE),
      officeMetadata: new OfficeMetadataField({ kind: 'word', pageCount: 12 }),
    });
    await renderComponent(
      <template><OfficePosterCapture @model={{file}} /></template>,
    );
    assert.dom('[data-test-office-poster-placeholder]').exists();
    assert.dom('[data-test-office-placeholder-count]').hasText('12 pages');
    assert.dom('[data-test-office-poster-page]').doesNotExist();
  });

  test('a document whose text flow opens with a title leads with it, not the filename', async function (assert) {
    let file = new DocxDef({
      ...fileAttrs('plan.docx', DOCX_TYPE),
      officeMetadata: new OfficeMetadataField({
        kind: 'word',
        pageCount: 3,
        previewJson: JSON.stringify({
          blocks: [
            { style: 'title', text: 'Quarterly Plan' },
            { style: 'body', text: 'The opening paragraph.' },
          ],
          truncated: false,
        }),
      }),
    });
    await renderComponent(
      <template><OfficePosterCapture @model={{file}} /></template>,
    );
    assert.dom('[data-test-office-poster-page]').exists();
    assert
      .dom('[data-test-office-poster-placeholder]')
      .doesNotExist('the placeholder branch does not render');
    assert
      .dom('[data-test-office-poster-heading]')
      .doesNotExist('no synthetic heading above the document title');
    assert
      .dom('[data-test-office-poster-page] [data-style="title"]')
      .hasText('Quarterly Plan');
  });

  test('a document whose text flow has no title gets the filename as its heading', async function (assert) {
    let file = new DocxDef({
      ...fileAttrs('memo.docx', DOCX_TYPE),
      officeMetadata: new OfficeMetadataField({
        kind: 'word',
        previewJson: JSON.stringify({
          blocks: [{ style: 'body', text: 'Just prose.' }],
          truncated: false,
        }),
      }),
    });
    await renderComponent(
      <template><OfficePosterCapture @model={{file}} /></template>,
    );
    assert.dom('[data-test-office-poster-heading]').hasText('memo');
    assert
      .dom('[data-test-office-poster-page] [data-style="body"]')
      .hasText('Just prose.');
  });

  test('a deck and a workbook select their own first-unit branches', async function (assert) {
    let deck = new PptxDef({
      ...fileAttrs('deck.pptx', PPTX_TYPE),
      officeMetadata: new OfficeMetadataField({
        kind: 'presentation',
        slideCount: 2,
        previewJson: JSON.stringify({
          slides: [{ index: 1, title: 'Unicorns', bullets: ['are real'] }],
          truncated: false,
        }),
      }),
    });
    await renderComponent(
      <template><OfficePosterCapture @model={{deck}} /></template>,
    );
    assert.dom('[data-test-office-poster-slide]').containsText('Unicorns');
    assert.dom('[data-test-office-poster-placeholder]').doesNotExist();

    let book = new XlsxDef({
      ...fileAttrs('sheet.xlsx', XLSX_TYPE),
      officeMetadata: new OfficeMetadataField({
        kind: 'spreadsheet',
        sheetCount: 1,
        previewJson: JSON.stringify({
          sheets: [{ name: 'Data', rows: [['a', 'b']], truncated: false }],
        }),
      }),
    });
    await renderComponent(
      <template><OfficePosterCapture @model={{book}} /></template>,
    );
    assert.dom('[data-test-office-poster-sheet] td').exists({ count: 2 });
    assert.dom('[data-test-office-poster-placeholder]').doesNotExist();
  });

  test('a deck whose first slide carries no text captures the typed placeholder', async function (assert) {
    let deck = new PptxDef({
      ...fileAttrs('blank.pptx', PPTX_TYPE),
      officeMetadata: new OfficeMetadataField({
        kind: 'presentation',
        slideCount: 1,
        previewJson: JSON.stringify({
          slides: [{ index: 1, bullets: [] }],
          truncated: false,
        }),
      }),
    });
    await renderComponent(
      <template><OfficePosterCapture @model={{deck}} /></template>,
    );
    assert
      .dom('[data-test-office-poster-placeholder]')
      .hasAttribute('data-kind', 'presentation');
    assert.dom('[data-test-office-placeholder-badge]').hasText('PPTX');
    assert.dom('[data-test-office-placeholder-count]').hasText('1 slide');
    assert.dom('[data-test-office-poster-slide]').doesNotExist();
  });
});
