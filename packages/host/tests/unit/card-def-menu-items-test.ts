import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { MenuItemOptions } from '@cardstack/boxel-ui/helpers';

import {
  baseRealm,
  realmURL,
  testRealmURL,
  type Loader,
} from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type { CardDef, GetMenuItemParams } from '@cardstack/base/card-api';

let getDefaultCardMenuItems: (
  card: CardDef,
  params: GetMenuItemParams,
) => MenuItemOptions[];

class DummyCard {
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
      toolContext: {} as any,
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.ok(texts.includes('Copy Card URL'), 'contains Copy Card URL');
    assert.ok(texts.includes('Copy as Markdown'), 'contains Copy as Markdown');
    assert.ok(
      texts.includes('New Card of This Type'),
      'contains New Card of This Type',
    );
    assert.ok(texts.includes('Delete'), 'contains Delete');
  });

  test('interact edit format includes unchecked "Toggle Standard View" for card with custom template', function (assert: Assert) {
    let card = new DummyCardWithCustomTemplates(
      'https://example.com/realm/card-5',
      'Five',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      toolContext: {} as any,
      format: 'edit',
    });

    let item = items.find(
      (i: MenuItemOptions) => i.label === 'Toggle Standard View',
    );
    assert.ok(item, 'contains Toggle Standard View');
    assert.notOk(
      item?.checked,
      'Standard View is unchecked (custom template active)',
    );
  });

  test('interact edit format omits toggle for card without custom template', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-6b',
      'SixB',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      toolContext: {} as any,
      format: 'edit',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.notOk(
      texts.includes('Toggle Standard View'),
      'does not include Standard View when no custom edit template',
    );
  });

  test('interact edit format omits toggle when not editable', function (assert: Assert) {
    let card = new DummyCardWithCustomTemplates(
      'https://example.com/realm/card-7',
      'Seven',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: false,
      cardCrudFunctions: {},
      menuContext: 'interact',
      toolContext: {} as any,
      format: 'edit',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.notOk(
      texts.includes('Toggle Standard View'),
      'does not include Standard View when canEdit is false',
    );
  });

  test('interact isolated format includes unchecked "Toggle Standard View" for card with custom template', function (assert: Assert) {
    let card = new DummyCardWithCustomTemplates(
      'https://example.com/realm/card-8',
      'Eight',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      toolContext: {} as any,
      format: 'isolated',
    });

    let item = items.find(
      (i: MenuItemOptions) => i.label === 'Toggle Standard View',
    );
    assert.ok(item, 'contains Toggle Standard View');
    assert.notOk(
      item?.checked,
      'Standard View is unchecked (custom template active)',
    );
  });

  test('interact isolated format shows "Toggle Standard View" as checked when already in standard view', function (assert: Assert) {
    let card = new DummyCardWithCustomTemplates(
      'https://example.com/realm/card-8b',
      'EightB',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      toolContext: {} as any,
      format: 'isolated',
      useBaseTemplate: true,
    });

    let item = items.find(
      (i: MenuItemOptions) => i.label === 'Toggle Standard View',
    );
    assert.ok(item, 'contains Toggle Standard View');
    assert.ok(
      item?.checked,
      'Standard View is checked (standard template active)',
    );
  });

  test('interact isolated format omits isolated toggle for card without custom template', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-9b',
      'NineB',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: true,
      cardCrudFunctions: {},
      menuContext: 'interact',
      toolContext: {} as any,
      format: 'isolated',
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.notOk(
      texts.includes('Toggle Standard View'),
      'does not include Standard View when no custom isolated template',
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
      toolContext: {} as any,
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
      toolContext: {} as any,
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
      toolContext: {} as any,
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
      toolContext: {} as any,
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
      toolContext: {} as any,
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
