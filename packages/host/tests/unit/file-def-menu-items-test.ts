import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { MenuItemOptions } from '@cardstack/boxel-ui/helpers';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import type { GetMenuItemParams } from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import { setupRenderingTest } from '../helpers/setup';

let getDefaultFileMenuItems: (
  file: FileDef,
  params: GetMenuItemParams,
) => MenuItemOptions[];

class DummyFile {
  constructor(public id?: string) {}
}

module('Unit | FileDef menu items', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  hooks.beforeEach(function (this: any) {
    loader = getService('loader-service').loader;
  });
  hooks.beforeEach(async function () {
    let mod: any = await loader.import(`${baseRealm.url}file-api`);
    getDefaultFileMenuItems = mod.getDefaultFileMenuItems;
  });

  test('interact context includes Copy File URL', function (assert: Assert) {
    let file = new DummyFile(
      'https://example.com/realm/file-1.txt',
    ) as unknown as FileDef;
    let items = getDefaultFileMenuItems(file, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      commandContext: {} as any,
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.ok(texts.includes('Copy File URL'), 'contains Copy File URL');
  });

  test('code-mode-preview includes Copy File URL and Open in Interact Mode', function (assert: Assert) {
    let file = new DummyFile(
      'https://example.com/realm/file-3.txt',
    ) as unknown as FileDef;
    let items = getDefaultFileMenuItems(file, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'code-mode-preview',
      commandContext: {} as any,
      format: 'isolated',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.ok(texts.includes('Copy File URL'), 'contains Copy File URL');
    assert.ok(
      texts.includes('Open in Interact Mode'),
      'contains Open in Interact Mode',
    );
  });

  test('code-mode-playground includes Open in Code Mode', function (assert: Assert) {
    let file = new DummyFile(
      'https://example.com/realm/file-4.txt',
    ) as unknown as FileDef;
    let items = getDefaultFileMenuItems(file, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'code-mode-playground',
      commandContext: {} as any,
      format: 'isolated',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.ok(texts.includes('Copy File URL'), 'contains Copy File URL');
    assert.ok(
      texts.includes('Open in Interact Mode'),
      'contains Open in Interact Mode',
    );
    assert.ok(
      texts.includes('Open in Code Mode'),
      'contains Open in Code Mode',
    );
  });
});
