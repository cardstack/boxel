import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { Loader, getField } from '@cardstack/runtime-common';

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
  // then showed nothing. Both are bundled here.
  test('an adoption chain stays whole when parent and leaf are both bundled', async function (assert) {
    let loader = getService('loader-service').loader;
    let { PngDef } = await loader.import<any>('@cardstack/base/png-image-def');

    let types = getTypes(PngDef).map((t: any) => `${t.module}#${t.name}`);
    assert.true(
      types.length >= 3,
      `the chain reaches past the leaf: ${JSON.stringify(types)}`,
    );
    assert.true(
      types.some((t: string) => t.endsWith('#FileDef')),
      `the chain reaches FileDef: ${JSON.stringify(types)}`,
    );
  });
});
