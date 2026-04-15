import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { MenuItemOptions } from '@cardstack/boxel-ui/helpers';

import {
  baseRealm,
  realmURL,
  testRealmURL,
  type Loader,
} from '@cardstack/runtime-common';

import type {
  CardDef,
  GetMenuItemParams,
} from 'https://cardstack.com/base/card-api';

import { setupRenderingTest } from '../helpers/setup';

let getDefaultCardMenuItems: (
  card: CardDef,
  params: GetMenuItemParams,
) => MenuItemOptions[];

class DummyCard {
  static hasCustomEditTemplate = false;
  constructor(
    public id?: string,
    public title?: string,
  ) {}
}

class DummyCardWithCustomTemplates extends DummyCard {
  static hasCustomEditTemplate = true;
  static hasCustomIsolatedTemplate = true;
}

module('Unit | CardDef menu items', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  hooks.beforeEach(function (this: any) {
    loader = getService('loader-service').loader;
  });
  hooks.beforeEach(async function () {
    let mod: any = await loader.import(`${baseRealm.url}menu-items`);
    getDefaultCardMenuItems = mod.getDefaultCardMenuItems;
  });

  test('interact context includes Copy Card URL and (when editable) New Card of This Type and Delete', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-1',
      'One',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
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

  test('interact edit format includes "Toggle Standard View" for a card with a custom edit template', function (assert: Assert) {
    let card = new DummyCardWithCustomTemplates(
      'https://example.com/realm/card-5',
      'Five',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      commandContext: {} as any,
      format: 'edit',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.ok(
      texts.includes('Toggle Standard View'),
      'contains Toggle Standard View',
    );
  });

  test('interact edit format includes "Toggle Custom View" when already in standard view', function (assert: Assert) {
    let card = new DummyCardWithCustomTemplates(
      'https://example.com/realm/card-5b',
      'FiveB',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      commandContext: {} as any,
      format: 'edit',
      useBaseTemplate: true,
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.ok(
      texts.includes('Toggle Custom View'),
      'contains Toggle Custom View',
    );
  });

  test('interact isolated format shows only the isolated toggle, not the edit toggle', function (assert: Assert) {
    let card = new DummyCardWithCustomTemplates(
      'https://example.com/realm/card-6',
      'Six',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      commandContext: {} as any,
      format: 'isolated',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.strictEqual(
      texts.filter((t) => t === 'Toggle Standard View').length,
      1,
      'contains exactly one toggle (isolated, not edit)',
    );
  });

  test('interact context omits toggle for a card without a custom edit template', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-6b',
      'SixB',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      commandContext: {} as any,
      format: 'edit',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.notOk(
      texts.includes('Toggle Standard View'),
      'does not include Toggle Standard View when no custom edit template',
    );
  });

  test('interact context omits toggle when not editable', function (assert: Assert) {
    let card = new DummyCardWithCustomTemplates(
      'https://example.com/realm/card-7',
      'Seven',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: false,
      cardCrudFunctions: {},
      menuContext: 'interact',
      commandContext: {} as any,
      format: 'edit',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.notOk(
      texts.includes('Toggle Standard View'),
      'does not include Toggle Standard View when canEdit is false',
    );
  });

  test('interact isolated format includes "Toggle Standard View" for a card with a custom isolated template', function (assert: Assert) {
    let card = new DummyCardWithCustomTemplates(
      'https://example.com/realm/card-8',
      'Eight',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      commandContext: {} as any,
      format: 'isolated',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.ok(
      texts.includes('Toggle Standard View'),
      'contains Toggle Standard View',
    );
  });

  test('interact isolated format includes "Toggle Custom View" when already in standard view', function (assert: Assert) {
    let card = new DummyCardWithCustomTemplates(
      'https://example.com/realm/card-8b',
      'EightB',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      commandContext: {} as any,
      format: 'isolated',
      useBaseTemplate: true,
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.ok(
      texts.includes('Toggle Custom View'),
      'contains Toggle Custom View',
    );
  });

  test('interact edit format shows only the edit toggle, not the isolated toggle', function (assert: Assert) {
    let card = new DummyCardWithCustomTemplates(
      'https://example.com/realm/card-9',
      'Nine',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      commandContext: {} as any,
      format: 'edit',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.strictEqual(
      texts.filter((t) => t === 'Toggle Standard View').length,
      1,
      'contains exactly one toggle (edit, not isolated)',
    );
  });

  test('interact context omits isolated toggle for a card without a custom isolated template', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-9b',
      'NineB',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      commandContext: {} as any,
      format: 'isolated',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.notOk(
      texts.includes('Toggle Standard View'),
      'does not include Toggle Standard View when no custom isolated template',
    );
  });

  test('ai-assistant context contains Copy to Workspace when editable', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-2',
      'Two',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
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
    let items = getDefaultCardMenuItems(card, {
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
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'code-mode-playground',
      commandContext: {} as any,
      format: 'isolated',
    });

    let hasCreateListing = items.some((i: MenuItemOptions) =>
      i.label.includes('Create Listing'),
    );
    let hasSampleDataTagged = items.some((i: MenuItemOptions) =>
      (i.tags || []).includes('playground-sample-data'),
    );

    assert.ok(hasCreateListing, 'contains Create Listing');
    assert.ok(
      hasSampleDataTagged,
      'contains items tagged playground-sample-data',
    );
  });

  test('code-mode-playground omits Create Listing for index card', function (assert: Assert) {
    let card = new DummyCard(
      `${testRealmURL}index`,
      'Workspace Index',
    ) as unknown as CardDef;
    (card as unknown as Record<symbol, URL>)[realmURL] = new URL(testRealmURL);

    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'code-mode-playground',
      commandContext: {} as any,
      format: 'isolated',
    });

    let hasCreateListing = items.some(
      (i: MenuItemOptions) => i.label === 'Create Listing',
    );
    assert.notOk(hasCreateListing, 'does not contain Create Listing');
  });

  test('code-mode-preview includes Copy Card URL and Open in Interact Mode', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-4',
      'Four',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
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
