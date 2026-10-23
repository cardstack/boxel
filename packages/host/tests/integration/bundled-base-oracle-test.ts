import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { Loader, getField } from '@cardstack/runtime-common';
import { moduleProvenanceOf } from '@cardstack/runtime-common/loader-plugin';

import { getTypes } from '@cardstack/host/utils/file-def-attributes-extractor';

import { setupRenderingTest } from '../helpers/setup';

module('Integration | bundled base oracle', function (hooks) {
  setupRenderingTest(hooks);

  test('the loader names a class in a module it was never asked for', async function (assert) {
    let loader = getService('loader-service').loader;
    let { DocxDef } = await loader.import<any>('@cardstack/base/docx-file-def');
    let officeField = getField(DocxDef, 'officeMetadata');

    assert.deepEqual(
      Loader.identify(officeField!.card),
      {
        module: '@cardstack/base/file-formats/metadata-fields',
        name: 'OfficeMetadataField',
      },
      'OfficeMetadataField is named by the module that declares it',
    );
  });

  // The payoff. `getTypes` walks a prototype chain and stops at the first level
  // it cannot name, so bundling a leaf def beside its parent used to truncate
  // the types a file is indexed under — a file tree filtering on `FileDef`
  // then showed nothing. Both are bundled here, and every level is pinned: a
  // length check would pass on a chain whose middle names the wrong module.
  test('an adoption chain stays whole when parent and leaf are both bundled', async function (assert) {
    let loader = getService('loader-service').loader;
    let { PngDef } = await loader.import<any>('@cardstack/base/png-image-def');

    assert.deepEqual(
      getTypes(PngDef).map((t: any) => `${t.module}#${t.name}`),
      [
        '@cardstack/base/png-image-def#PngDef',
        '@cardstack/base/image-file-def#RasterImageDef',
        '@cardstack/base/card-api#ImageDef',
        '@cardstack/base/card-api#FileDef',
        '@cardstack/base/card-api#BaseDef',
      ],
      'every level names the module that declares it',
    );
  });

  // A module that re-exports a class it did not declare must not take the
  // credit for it, whichever module the loader was asked for first.
  // `image-file-def` is that shape — `import { ImageDef } from './card-api';
  // export { ImageDef }; export default ImageDef;` — and it is bundled here.
  //
  // Serving order cannot be staged in a test: `Loader.loaders` is static, so a
  // class the app already captured stays captured whatever a fresh loader
  // does. What makes the answer order-independent is that only a declarer
  // marks a class, so the class's mark names `card-api` and nothing else can
  // overwrite it. That is asserted directly, beside the ref it produces.
  test('a re-exporter does not take the credit for a class it borrows', async function (assert) {
    let loader = getService('loader-service').loader;
    let { ImageDef } = await loader.import<any>(
      '@cardstack/base/image-file-def',
    );

    assert.deepEqual(
      moduleProvenanceOf(ImageDef),
      { module: '@cardstack/base/card-api', name: 'ImageDef' },
      'ImageDef is marked by card-api, the module that declares it',
    );
    assert.deepEqual(
      Loader.identify(ImageDef),
      { module: '@cardstack/base/card-api', name: 'ImageDef' },
      'so the ref names card-api however the modules were served',
    );
  });
});
