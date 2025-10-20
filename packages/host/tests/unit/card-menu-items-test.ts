import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { type MenuItemOptions } from '@cardstack/boxel-ui/helpers';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import type {
  CardDef,
  GetCardMenuItemParams,
} from 'https://cardstack.com/base/card-api';

import { setupRenderingTest } from '../helpers/setup';

let getDefaultCardMenuItems: (
  card: CardDef,
  params: GetCardMenuItemParams,
) => MenuItemOptions[];

class DummyCard {
  constructor(
    public id?: string,
    public title?: string,
  ) {}
}

module('Unit | card-menu-items', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  hooks.beforeEach(function (this: any) {
    loader = getService('loader-service').loader;
  });
  hooks.beforeEach(async function () {
    let mod: any = await loader.import(`${baseRealm.url}card-menu-items`);
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

  test('ai-assistant context contains Copy to Workspace', function (assert: Assert) {
    let card = new DummyCard(
      'https://example.com/realm/card-2',
      'Two',
    ) as unknown as CardDef;
    let items = getDefaultCardMenuItems(card, {
      canEdit: false,
      cardCrudFunctions: {},
      menuContext: 'ai-assistant',
      commandContext: {} as any,
    });

    let texts = items.map((i: MenuItemOptions) => i.label);
    assert.ok(
      texts.includes('Copy to Workspace'),
      'contains Copy to Workspace',
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
      i.label.includes('Create listing with AI'),
    );
    let listingItem = items.find(
      (i: MenuItemOptions) => i.label === 'Create listing with AI',
    );
    let hasSampleDataTagged = items.some((i: MenuItemOptions) =>
      (i.tags || []).includes('playground-sample-data'),
    );

    assert.ok(hasCreateListing, 'contains Create listing with AI');
    assert.false(
      listingItem?.disabled,
      'Create listing with AI is enabled when user can edit',
    );
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
    let items = getDefaultCardMenuItems(card, {
      canEdit: false,
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
    assert.ok(
      texts.includes('Create listing with AI'),
      'contains Create listing with AI',
    );
    let listingItem = items.find(
      (i: MenuItemOptions) => i.label === 'Create listing with AI',
    );
    assert.true(
      listingItem?.disabled,
      'Create listing with AI is disabled when user cannot edit',
    );
  });
});
