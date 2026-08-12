import 'ses';

import { waitFor, waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { rri, type LooseCardResource } from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';
import CardStoreWithGarbageCollection from '@cardstack/host/lib/gc-card-store';

import {
  testRealmURL,
  testRRI,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  cleanWhiteSpace,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { BaseDef, CardDef, Format } from '@cardstack/base/card-api';
import type * as CardAPIModule from '@cardstack/base/card-api';

const baseCardApiModule = rri('https://cardstack.com/base/card-api');
const friendId = `${testRealmURL}Friend/buddy`;

// An authored realm module: served as source to the loader, so the
// classifier routes every render of it to the Capsule tier (RP-6.1 R4).
const gadgetSource = `
  import {
    CardDef,
    FieldDef,
    Component,
    contains,
    field,
    linksTo,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class BadgeField extends FieldDef {
    static displayName = 'Badge';
    @field label = contains(StringField);
    static embedded = class Embedded extends Component<typeof BadgeField> {
      <template>
        <span data-test-badge data-test-badge-format={{@format}}>
          {{if @model 'badge-present' 'badge-missing'}}
        </span>
      </template>
    };
  }

  export class Gadget extends CardDef {
    static displayName = 'Gadget';
    @field name = contains(StringField);
    @field badge = contains(BadgeField);
    @field partner = linksTo(CardDef);
    @field summary = contains(StringField, {
      computeVia: function () {
        return this.name + ' online';
      },
    });
    @field blank = contains(StringField, {
      computeVia: function () {
        return undefined;
      },
    });
    static isolated = class Isolated extends Component<typeof Gadget> {
      <template>
        <div data-test-gadget>
          <span data-test-gadget-name><@fields.name /></span>
          <span data-test-unknown-format><@fields.name
              @format='banana'
            /></span>
          <span data-test-computed><@fields.summary /></span>
          <span data-test-blank>[<@fields.blank />]</span>
          <div data-test-badge-slot><@fields.badge /></div>
          <div data-test-partner-slot><@fields.partner /></div>
        </div>
      </template>
    };
  }
`;

const explosiveSource = `
  import {
    CardDef,
    Component,
    contains,
    field,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Explosive extends CardDef {
    static displayName = 'Explosive';
    @field boom = contains(StringField, {
      computeVia: function () {
        throw new Error('conformance-fixture-compute-error');
      },
    });
    static isolated = class Isolated extends Component<typeof Explosive> {
      <template><div data-test-explosive><@fields.boom /></div></template>
    };
  }
`;

// Matrix cell: Sandbox x query-backed linksToMany. The modifier is only a
// deterministic classifier signal; the behavior under test is that the Host
// settles its Store-owned query before publishing the child's JSON:API
// execution document.
const queryGallerySource = `
  import {
    CardDef,
    Component,
    contains,
    field,
    linksToMany,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  import { modifier } from 'ember-modifier';

  const recipeRef = {
    module: '${testRRI('query-gallery')}',
    name: 'QueryRecipe',
  };
  const requiresSandbox = modifier(() => undefined);

  export class QueryRecipe extends CardDef {
    @field title = contains(StringField);
  }

  export class QueryGallery extends CardDef {
    @field recipes = linksToMany(() => QueryRecipe, {
      query: {
        filter: { type: recipeRef },
        sort: [{ by: 'title', on: recipeRef, direction: 'asc' }],
      },
    });
    static isolated = class Isolated extends Component<typeof QueryGallery> {
      <template>
        <div {{requiresSandbox}} data-test-query-gallery>
          {{@model.recipes.length}}
        </div>
      </template>
    };
  }
`;

async function renderThroughExecutionRenderer(card: BaseDef, format?: Format) {
  await renderComponent(
    class TestDriver extends GlimmerComponent {
      <template>
        <CardRenderer @card={{card}} @format={{format}} @execution='auto' />
      </template>
    },
  );
}

module('Integration | rp-conformance', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'gadget.gts': gadgetSource,
          'explosive.gts': explosiveSource,
          'query-gallery.gts': queryGallerySource,
          'QueryGallery/home.json': {
            data: {
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: testRRI('query-gallery'),
                  name: 'QueryGallery',
                },
              },
            },
          },
          'QueryRecipe/apple.json': {
            data: {
              attributes: { title: 'Apple' },
              meta: {
                adoptsFrom: {
                  module: testRRI('query-gallery'),
                  name: 'QueryRecipe',
                },
              },
            },
          },
          'QueryRecipe/banana.json': {
            data: {
              attributes: { title: 'Banana' },
              meta: {
                adoptsFrom: {
                  module: testRRI('query-gallery'),
                  name: 'QueryRecipe',
                },
              },
            },
          },
          'Friend/buddy.json': {
            data: {
              attributes: {
                cardInfo: { name: 'Linked Friend' },
              },
              meta: {
                adoptsFrom: { module: baseCardApiModule, name: 'CardDef' },
              },
            },
          },
        },
      }),
    );
  });

  setupCardLogs(hooks, async () =>
    getService('loader-service').loader.import('@cardstack/base/card-api'),
  );

  async function createFromResource(
    resource: LooseCardResource,
  ): Promise<CardDef> {
    let store = getService('store');
    return await store.__dangerousCreateFromSerialized(
      resource,
      { data: resource },
      new URL(testRealmURL),
    );
  }

  async function createGadget(
    overrides: Partial<LooseCardResource> = {},
  ): Promise<CardDef> {
    return await createFromResource({
      attributes: { name: 'Widget' },
      meta: { adoptsFrom: { module: testRRI('gadget'), name: 'Gadget' } },
      ...overrides,
    });
  }

  test('RP-6.1, RP-6.4: a trusted Base module mounts in the Direct tier with the tier stamped as a diagnostic', async function (assert) {
    let card = await createFromResource({
      attributes: { cardInfo: { name: 'Trusted Fixture' } },
      meta: { adoptsFrom: { module: baseCardApiModule, name: 'CardDef' } },
    });

    await renderThroughExecutionRenderer(card, 'isolated');
    await waitFor('[data-boxel-execution="direct"]', { timeout: 10000 });

    assert
      .dom('[data-boxel-execution="direct"]')
      .hasAttribute(
        'data-boxel-execution-reason',
        'trusted-boxel-module',
        'the routing decision is stamped alongside the tier',
      );
    assert
      .dom(
        '[data-boxel-execution="direct"] [data-test-base-template="isolated"]',
      )
      .exists('the trusted Base default template renders inside the slot');
    assert
      .dom('[data-boxel-execution="direct"]')
      .containsText('Trusted Fixture', 'visible output is the card content');
    assert
      .dom('[data-boxel-execution="capsule"]')
      .doesNotExist('a trusted module never mounts in an authored tier');
  });

  test('RP-6.1, RP-6.4: an authored realm module mounts in the Capsule tier with the tier stamped as a diagnostic', async function (assert) {
    let card = await createGadget();

    await renderThroughExecutionRenderer(card, 'isolated');
    await waitFor('[data-boxel-execution="capsule"] [data-test-gadget]', {
      timeout: 10000,
    });

    assert
      .dom('[data-boxel-execution="capsule"]')
      .hasAttribute(
        'data-boxel-execution-reason',
        'default-user-card',
        'the routing decision is stamped alongside the tier',
      );
    assert
      .dom('[data-test-gadget-name]')
      .hasText('Widget', 'the authored isolated template renders its content');
    assert
      .dom('[data-boxel-execution="direct"]')
      .doesNotExist('authored code never routes Direct');
  });

  test('RP-2.4: an unknown field format is silently ignored and the ambient defaults win', async function (assert) {
    let card = await createGadget();

    await renderThroughExecutionRenderer(card, 'isolated');
    await waitFor('[data-test-unknown-format]', { timeout: 10000 });

    assert
      .dom('[data-test-unknown-format]')
      .hasText(
        'Widget',
        'the field still renders its value in the ambient default format',
      );
    assert
      .dom('[data-test-unknown-format] input')
      .doesNotExist('the unknown format is not treated as an edit request');
  });

  test('RP-2.6: a contained field renders embedded inside an isolated card', async function (assert) {
    let card = await createGadget();

    await renderThroughExecutionRenderer(card, 'isolated');
    await waitFor('[data-test-badge-slot] [data-test-badge]', {
      timeout: 10000,
    });

    assert
      .dom('[data-test-badge-slot] [data-test-badge]')
      .hasAttribute(
        'data-test-badge-format',
        'embedded',
        'the child-format cascade resolves a nested FieldDef to embedded',
      );
  });

  test('RP-3.3: a contains composite value is never null', async function (assert) {
    // The instance document carries no `badge` attribute at all; the field
    // must still materialize as a fresh instance rather than null/undefined.
    let card = await createGadget();

    await renderThroughExecutionRenderer(card, 'isolated');
    await waitFor('[data-test-badge-slot] [data-test-badge]', {
      timeout: 10000,
    });

    assert
      .dom('[data-test-badge-slot] [data-test-badge]')
      .hasText(
        'badge-present',
        'an undeclared contains composite renders a fresh empty instance',
      );
  });

  test('RP-4.1, RP-4.3: computeVia is function-form and an undefined compute falls back to emptyValue', async function (assert) {
    let card = await createGadget();

    await renderThroughExecutionRenderer(card, 'isolated');
    await waitFor('[data-test-computed]', { timeout: 10000 });

    assert
      .dom('[data-test-computed]')
      .hasText(
        'Widget online',
        'a function-form computeVia renders its derived value',
      );
    let blank = document.querySelector('[data-test-blank]');
    assert.strictEqual(
      (blank?.textContent ?? '').replace(/\s+/g, ''),
      '[]',
      'a compute returning undefined renders the field emptyValue (nothing)',
    );
  });

  test('RP-2.6, RP-7.2, RP-7.3: an unloaded link reads undefined synchronously, renders absent rather than a spinner, and settles to the loaded card in the cascade format', async function (assert) {
    let card = await createGadget({
      relationships: { partner: { links: { self: friendId } } },
    });
    let api = await getService('loader-service').loader.import<
      typeof CardAPIModule
    >('@cardstack/base/card-api');

    // The getter is the lazy-load trigger: it returns undefined synchronously
    // and starts the fetch; loading is observable only via membership state.
    assert.strictEqual(
      (card as unknown as { partner?: unknown }).partner,
      undefined,
      'reading an unloaded link returns undefined synchronously',
    );
    assert.true(
      api.getRelationshipMembershipState(card, 'partner').isLoading,
      'the read starts the load, observable only via membership state',
    );

    await renderThroughExecutionRenderer(card, 'isolated');
    await waitFor(`[data-test-partner-slot] [data-test-card="${friendId}"]`, {
      timeout: 10000,
    });

    assert
      .dom(`[data-test-partner-slot] [data-test-card="${friendId}"]`)
      .containsText(
        'Linked Friend',
        'the loaded link renders through the normal setter path',
      );
    assert
      .dom(`[data-test-partner-slot] [data-test-card="${friendId}"]`)
      .hasAttribute(
        'data-test-card-format',
        'fitted',
        'a linked CardDef inside an isolated template renders fitted (the RP-2.6 cascade)',
      );
    assert
      .dom('[data-test-partner-slot] [aria-busy]')
      .doesNotExist('link loading never presents a spinner');
  });

  test('RP-10.2, RP-10.3: a card renders statically with no card context or CRUD functions provided', async function (assert) {
    // This module provides no CardContext, CardCrudFunctions, or permissions
    // providers anywhere, so this render is the degraded-context contract.
    let card = await createGadget();

    await renderThroughExecutionRenderer(card, 'isolated');
    await waitFor('[data-test-gadget]', { timeout: 10000 });

    assert
      .dom('[data-test-gadget]')
      .exists('the card renders statically without any CRUD or card context');
    assert
      .dom('[data-test-gadget-name]')
      .hasText('Widget', 'content is unaffected by the absent context plane');
  });

  test('RP-4.5, RP-11.4: a throwing computeVia fails the render and chrome presents the error', async function (assert) {
    let card = await createFromResource({
      attributes: {},
      meta: { adoptsFrom: { module: testRRI('explosive'), name: 'Explosive' } },
    });

    await renderThroughExecutionRenderer(card, 'isolated');
    await waitFor('.boxel-execution-error', { timeout: 10000 });

    assert
      .dom('.boxel-execution-error')
      .hasAttribute('role', 'alert', 'chrome owns the error presentation');
    assert
      .dom('.boxel-execution-error')
      .containsText('Unable to render this card');
    assert
      .dom('.boxel-execution-error')
      .containsText(
        'conformance-fixture-compute-error',
        'the underlying failure is surfaced by chrome, not the card',
      );
    assert
      .dom('[data-test-explosive]')
      .doesNotExist('no card content renders around the failure');
  });

  test('RP-14.4, RP-15.4: Direct and Capsule produce deep-equal semantic records for the same fixture', async function (assert) {
    let card = await createGadget({
      relationships: { partner: { links: { self: friendId } } },
    });

    let boxelExecution = getService('boxel-execution');
    let session = boxelExecution.createSession();
    try {
      let request = await boxelExecution.requestFor(
        card,
        'isolated',
        boxelExecution.surfaceId(),
      );
      let generation = await session.update(request);
      assert.ok(generation, 'the session produced a ready generation');
      assert.strictEqual(
        generation!.lease.decision.mode,
        'capsule',
        'the authored fixture routed to the Capsule tier',
      );
      let capsuleRecord = generation!.renderRecord;
      let directRecord = await getService(
        'direct-boxel-runtime',
      ).runtime.buildRenderRecord(card);

      assert.deepEqual(
        structuredClone(capsuleRecord),
        capsuleRecord,
        'the semantic record is structured-cloneable',
      );
      assert.deepEqual(
        capsuleRecord.boxel,
        directRecord.boxel,
        'BoxelDescription is identical across Direct and Capsule',
      );
      assert.deepEqual(
        capsuleRecord.instance.fields,
        directRecord.instance.fields,
        'ResolvedField projections are identical across Direct and Capsule',
      );
      assert.strictEqual(
        capsuleRecord.instance.id,
        directRecord.instance.id,
        'instance identity is identical across tiers',
      );
      assert.deepEqual(
        capsuleRecord.presentation,
        directRecord.presentation,
        'instance presentation is identical across tiers',
      );
    } finally {
      await session.destroy();
    }
  });

  // "Identity map: same canonical id + assignable class ⇒ the same instance
  // object, updated in place; ... One instance is keyed under its localId and
  // every known remote id; a remote id claimed by a second local id is a hard
  // error."
  test('RP-8.2: the identity map reuses one instance per canonical id for assignable classes, and a remote id claimed by a second local id is a hard error', async function (assert) {
    let idX = `${testRealmURL}Gadget/identity-probe`;
    let first = await createGadget({
      id: idX,
      attributes: { name: 'First' },
    });
    let second = await createGadget({
      id: idX,
      attributes: { name: 'Second' },
    });
    assert.strictEqual(
      second,
      first,
      'the same canonical id and class yield the same instance object',
    );
    assert.strictEqual(
      (first as unknown as { name?: string }).name,
      'Second',
      'the shared instance is updated in place, not replaced',
    );

    let asAncestor = await createFromResource({
      id: idX,
      attributes: {},
      meta: { adoptsFrom: { module: baseCardApiModule, name: 'CardDef' } },
    });
    assert.strictEqual(
      asAncestor,
      first,
      'an assignable (ancestor) class keeps the cached instance',
    );

    // A class the cached instance is not assignable to takes the
    // construct-fresh branch at the card-api layer, and the fresh instance's
    // new local id then claims a remote id the store already keys under the
    // original local id. Through the Host store the observable outcome of
    // that sequence is exactly the statement's hard error — the diagnostic
    // itself names both local ids, evidence that a fresh instance was
    // constructed and its registration refused.
    let idY = `${testRealmURL}Gadget/mismatch-probe`;
    await createFromResource({
      id: idY,
      attributes: {},
      meta: { adoptsFrom: { module: baseCardApiModule, name: 'CardDef' } },
    });
    await assert.rejects(
      createGadget({
        id: idY,
        attributes: { name: 'Fresh' },
      }),
      /conflicting instance id in store/,
      'a second local id claiming an already-keyed remote id is a hard error',
    );
  });

  // "Side-loaded resources enter only via resourceFrom(doc, id) matching
  // data.id ...; an absent included entry yields not-loaded."
  test('RP-8.3: a side-loaded resource resolves synchronously from the document, while an absent included entry yields not-loaded', async function (assert) {
    let api = await getService('loader-service').loader.import<
      typeof CardAPIModule
    >('@cardstack/base/card-api');

    // No included entry for the referenced id: the relationship is
    // not-loaded (a pure-read observation; nothing has been fetched yet).
    let unloaded = await createGadget({
      relationships: { partner: { links: { self: friendId } } },
    });
    assert.strictEqual(
      api.getRelationshipMembershipState(unloaded, 'partner').membership?.[0]
        ?.kind,
      'not-loaded',
      'an absent included entry yields the not-loaded state',
    );

    // The same reference with the resource side-loaded in `included`
    // materializes during deserialization: the link is present
    // synchronously, before any fetch could have completed. Side-loading is
    // keyed by resource linkage — the relationship's `data.id` matching the
    // included entry's `data.id` (never `links.self`) — so the relationship
    // carries both, exactly as a realm-served document does.
    let store = getService('store');
    let resource: LooseCardResource = {
      attributes: { name: 'Widget' },
      relationships: {
        partner: {
          links: { self: friendId },
          data: { type: 'card', id: friendId },
        },
      },
      meta: { adoptsFrom: { module: testRRI('gadget'), name: 'Gadget' } },
    };
    let withIncluded = await store.__dangerousCreateFromSerialized(
      resource,
      {
        data: resource,
        included: [
          {
            type: 'card',
            id: friendId,
            attributes: { cardInfo: { name: 'Linked Friend' } },
            meta: {
              adoptsFrom: { module: baseCardApiModule, name: 'CardDef' },
            },
          },
        ],
      } as unknown as Parameters<
        typeof store.__dangerousCreateFromSerialized
      >[1],
      new URL(testRealmURL),
    );
    let partner = (withIncluded as unknown as { partner?: CardDef }).partner;
    assert.ok(
      partner,
      'the side-loaded resource is present synchronously after deserialization',
    );
    assert.strictEqual(partner?.id, friendId);
    assert.strictEqual(
      api.getRelationshipMembershipState(withIncluded, 'partner')
        .membership?.[0]?.kind,
      'present',
      'the side-loaded relationship reads as present',
    );
  });

  // "An execution document carries absolute/canonical module identities and
  // explicit included resources; a consumer never derives a module base from
  // an instance id."
  test('RP-8.4: the execution document carries absolute module identities and explicit included resources', async function (assert) {
    let card = await createGadget({
      relationships: { partner: { links: { self: friendId } } },
    });
    // Reading the link starts its load (RP-7.2); wait for the target so the
    // serialized execution document can side-load it.
    (card as unknown as { partner?: unknown }).partner;
    await waitUntil(
      () =>
        Boolean((card as unknown as { partner?: unknown }).partner) === true,
      { timeout: 10000 },
    );

    let boxelExecution = getService('boxel-execution');
    let request = await boxelExecution.requestFor(
      card,
      'isolated',
      boxelExecution.surfaceId(),
    );
    let rootAdoptsFrom = request.document.data?.meta?.adoptsFrom as
      | { module?: string }
      | undefined;
    assert.strictEqual(
      rootAdoptsFrom?.module,
      testRRI('gadget'),
      "the primary resource's adoptsFrom module is absolute/canonical, never relative to the instance id",
    );
    let included = request.document.included ?? [];
    let partnerResource = included.find(
      (candidate) => candidate.id === friendId,
    );
    assert.ok(
      partnerResource,
      'the loaded link target crosses as an explicit included resource',
    );
    let partnerAdoptsFrom = partnerResource?.meta?.adoptsFrom as
      | { module?: string }
      | undefined;
    // The canonical spelling of a registered realm's module is its scoped
    // identifier (the opaque RealmResourceIdentifier form RP-8.1 mandates),
    // so derive the expectation from the live VirtualNetwork mapping rather
    // than assuming the raw URL spelling.
    let canonicalBaseModule =
      getService('network').virtualNetwork.unresolveURL(baseCardApiModule);
    assert.strictEqual(
      partnerAdoptsFrom?.module,
      canonicalBaseModule,
      "the included resource's module identity is the absolute/canonical form",
    );
    assert.false(
      (partnerAdoptsFrom?.module ?? '.').startsWith('.'),
      "the included module identity is never spelled relative to the delivering document's instance ids",
    );
  });

  test('RP-7.2, RP-8.4: a query-backed relationship settles before its Sandbox execution document crosses the boundary', async function (assert) {
    let store = getService('store');
    let card = (await store.get(`${testRealmURL}QueryGallery/home`)) as CardDef;

    let boxelExecution = getService('boxel-execution');
    let request = await boxelExecution.requestFor(
      card,
      'isolated',
      boxelExecution.surfaceId(),
    );
    let classification = await boxelExecution.classifyForExecution(
      request.moduleIdentifier,
      request.source,
    );
    assert.strictEqual(
      classification.tier,
      'sandbox',
      'the fixture is admitted to the Sandbox tier',
    );
    let recipesRelationship = request.document.data?.relationships?.recipes;
    let relationshipIds =
      recipesRelationship &&
      !Array.isArray(recipesRelationship) &&
      Array.isArray(recipesRelationship.data)
        ? recipesRelationship.data.map((item) =>
            'id' in item ? item.id : undefined,
          )
        : [];

    assert.ok(request.hostProjection, 'the Host projection is available');
    let projectedRecipes = request.hostProjection?.fields.find(
      (field) => field.fieldName === 'recipes',
    )?.value as { id?: string | null }[] | undefined;
    assert.deepEqual(
      projectedRecipes?.map((item) => item.id),
      [`${testRealmURL}QueryRecipe/apple`, `${testRealmURL}QueryRecipe/banana`],
      'the canonical Host projection settles the query before any execution tier consumes it',
    );

    assert.deepEqual(
      relationshipIds,
      [`${testRealmURL}QueryRecipe/apple`, `${testRealmURL}QueryRecipe/banana`],
      'the child snapshot carries the settled, sorted query membership',
    );
    let hasResolvedQueryLink = Boolean(
      recipesRelationship &&
      !Array.isArray(recipesRelationship) &&
      recipesRelationship.links?.search,
    );
    assert.ok(
      hasResolvedQueryLink,
      'the umbrella relationship marks the bounded membership as a Host-resolved query result',
    );
    assert.deepEqual(
      (request.document.included ?? []).map((item) => item.id).sort(),
      [testRRI('QueryRecipe/apple'), testRRI('QueryRecipe/banana')],
      'the matching cards cross as bounded included resources, not a Store/search capability',
    );

    let cardService = getService('card-service');
    let api = await cardService.getAPI();
    let network = getService('network');
    let boundaryStore = new CardStoreWithGarbageCollection(
      new Map(),
      fetch,
      network.virtualNetwork,
    );
    let boundaryCopy = await api.createFromSerialized(
      request.document.data,
      request.document,
      rri(testRealmURL),
      { store: boundaryStore },
    );
    assert.strictEqual(
      ((api.peekAtField(boundaryCopy, 'recipes') ?? []) as CardDef[]).length,
      2,
      'the ordinary relationship deserializer hydrates both included records',
    );
    assert.strictEqual(
      (boundaryCopy as CardDef & { recipes: CardDef[] }).recipes.length,
      2,
      'the execution document reconstructs the authorized query seed without a Host Store',
    );

    // Do not assert against `[data-test-query-gallery]` in the parent
    // document here. During an origin-isolated Sandbox boot that selector
    // belongs to the inert prerender placeholder, not the live child DOM;
    // treating it as the child made this test observe stale server HTML while
    // the actual child already held both records. The reconstruction above is
    // the protocol invariant this suite owns. Live iframe presentation is
    // covered by the Sandbox transport suite and the cross-origin browser
    // smoke corpus.
  });

  test('RP-2.4: an explicit renderable root format sets the rendered format', async function (assert) {
    let card = await createFromResource({
      attributes: { cardInfo: { name: 'Trusted Fixture' } },
      meta: { adoptsFrom: { module: baseCardApiModule, name: 'CardDef' } },
    });

    await renderThroughExecutionRenderer(card, 'embedded');
    await waitFor('[data-test-field-component-card]', { timeout: 10000 });

    assert
      .dom('[data-test-field-component-card]')
      .hasAttribute(
        'data-boxel-card-format',
        'embedded',
        'an explicit member of the renderable inventory wins',
      );
    assert.ok(
      cleanWhiteSpace(
        document.querySelector('[data-test-field-component-card]')
          ?.textContent ?? '',
      ).includes('Trusted Fixture'),
      'the embedded template renders the card content',
    );
  });
});
