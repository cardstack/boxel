import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { MenuItemOptions } from '@cardstack/boxel-ui/helpers';

import {
  baseRealm,
  testRealmURL,
  type Loader,
} from '@cardstack/runtime-common';

import type {
  CardDef,
  GetMenuItemParams,
} from 'https://cardstack.com/base/card-api';

import { setupRenderingTest } from '../helpers/setup';

let getDefaultMenuItems: (
  card: CardDef,
  params: GetMenuItemParams,
) => MenuItemOptions[];

class DummyCard {
  constructor(
    public id?: string,
    public title?: string,
  ) {}
}

module('Unit | menu-items', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  hooks.beforeEach(function (this: any) {
    loader = getService('loader-service').loader;
  });
  hooks.beforeEach(async function () {
    let mod: any = await loader.import(`${baseRealm.url}menu-items`);
    getDefaultMenuItems = mod.getDefaultMenuItems;
  });

  test('interact context includes Copy Card URL and (when editable) New Card of This Type and Delete', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-1',
      'One',
    ) as unknown as CardDef;
    let items = getDefaultMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      commandContext: {} as any,
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.ok(texts.includes('Copy Card URL'), 'contains Copy Card URL');
    assert.ok(
      texts.includes('New Card of This Type'),
      'contains New Card of This Type',
    );
    assert.ok(texts.includes('Delete'), 'contains Delete');
  });

  test('ai-assistant context contains Copy to Workspace when editable', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-2',
      'Two',
    ) as unknown as CardDef;
    let items = getDefaultMenuItems(card, {
      canEdit: false,
      cardCrudFunctions: {},
      menuContext: 'ai-assistant',
      menuContextParams: {
        canEditActiveRealm: true,
        activeRealmURL: testRealmURL,
      },
      commandContext: {} as any,
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.ok(
      texts.includes('Copy to Workspace'),
      'contains Copy to Workspace',
    );
  });

  test('ai-assistant context omits Copy to Workspace when not editable', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-2',
      'Two',
    ) as unknown as CardDef;
    let items = getDefaultMenuItems(card, {
      canEdit: false,
      cardCrudFunctions: {},
      menuContext: 'ai-assistant',
      menuContextParams: {
        canEditActiveRealm: false,
        activeRealmURL: testRealmURL,
      },
      commandContext: {} as any,
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.notOk(
      texts.includes('Copy to Workspace'),
      'does not include Copy to Workspace',
    );
  });

  test('code-mode-playground includes sample-data tagged items and Open in Code Mode', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-3',
      'Three',
    ) as unknown as CardDef;
    let items = getDefaultMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'code-mode-playground',
      commandContext: {} as any,
      format: 'isolated',
    });

    let hasCreateListing = items.some((i: MenuItemOptions) =>
      i.label.includes('Create listing with AI'),
    );
    let hasSampleDataTagged = items.some((i: MenuItemOptions) =>
      (i.tags || []).includes('playground-sample-data'),
    );

    assert.ok(hasCreateListing, 'contains Create listing with AI');
    assert.ok(
      hasSampleDataTagged,
      'contains items tagged playground-sample-data',
    );
  });

  test('code-mode-preview includes Copy Card URL and Open in Interact Mode', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-4',
      'Four',
    ) as unknown as CardDef;
    let items = getDefaultMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'code-mode-preview',
      commandContext: {} as any,
      format: 'isolated',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.ok(texts.includes('Copy Card URL'), 'contains Copy Card URL');
    assert.ok(
      texts.includes('Open in Interact Mode'),
      'contains Open in Interact Mode',
    );
  });
});
