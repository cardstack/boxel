import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { themeScope } from '@cardstack/boxel-ui/helpers';

import {
  checkRecordParity,
  describeParityReport,
  reportsParity,
} from '@cardstack/runtime-common/boxel-execution-conformance';
import { readBoxelValueReference } from '@cardstack/runtime-common/boxel-execution-protocol';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';
import type { Loader } from '@cardstack/runtime-common/loader';
import { rri } from '@cardstack/runtime-common/realm-identifiers';
import type { RealmResourceIdentifier } from '@cardstack/runtime-common/realm-identifiers';

import DirectBoxelRuntime from '@cardstack/host/lib/direct-boxel-runtime';
import type StoreService from '@cardstack/host/services/store';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import {
  setupBaseRealm,
  createFromSerialized,
  getRelationshipMembershipState,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef } from '@cardstack/base/card-api';

let loader: Loader;

const showModule = rri(`${testRealmURL}show`);
const showRef: CodeRef = { module: showModule, name: 'Show' };
const openingNight = rri(`${testRealmURL}Show/opening-night`);
const matinee = rri(`${testRealmURL}Show/matinee`);
const themedShow = rri(`${testRealmURL}Show/themed`);
const houseTheme = rri(`${testRealmURL}Theme/house`);
const importJob = rri(`${testRealmURL}Job/import`);

// Served as source rather than as pre-built classes, so the module reaches the
// adapter the way a realm's own module does: fetched, run through
// `transpileJS()`, and evaluated by the Host loader with its scoped-CSS side
// effect (RP-12.3) already applied.
const showSource = `
  import {
    CardDef,
    FieldDef,
    Component,
    contains,
    containsMany,
    field,
    linksTo,
    linksToMany,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  import CurrencyField from 'https://cardstack.com/base/currency';
  import { ProcessCard } from 'https://cardstack.com/base/process-card';

  export class VenueField extends FieldDef {
    static displayName = 'Venue';
    static configuration = { layout: { rows: 1, wrap: true } };
    @field name = contains(StringField);
    @field city = contains(StringField);
  }

  export class Job extends ProcessCard {
    static displayName = 'Job';
  }

  export class Show extends CardDef {
    static displayName = 'Show';
    static headerColor = '#ff8800';
    @field headline = contains(StringField, {
      configuration: { placeholder: 'Untitled show', layout: { columns: 2 } },
    });
    @field venue = contains(VenueField, {
      configuration: { layout: { rows: 3 } },
    });
    @field subtitle = contains(StringField);
    @field tags = containsMany(StringField);
    @field partner = linksTo(() => Show);
    @field price = contains(CurrencyField);
    @field revivals = linksToMany(() => Show, {
      query: { filter: { eq: { headline: 'Revival' } } },
    });
    @field billing = contains(StringField, {
      computeVia: function () {
        return this.headline + ' at the Majestic';
      },
    });
    static embedded = class Embedded extends Component<typeof Show> {
      <template>
        <div data-test-show>{{@model.headline}}</div>
        <style scoped>
          [data-test-show] { color: rebeccapurple; }
        </style>
      </template>
    };
  }
`;

function showDocument(
  id: string,
  headline: string,
  partner?: string,
  theme?: string,
) {
  return {
    data: {
      type: 'card',
      id,
      attributes: {
        headline,
        venue: { name: 'Majestic', city: 'Cairo' },
        tags: ['gala', 'premiere'],
        price: { code: 'EUR' },
      },
      relationships: {
        partner: partner
          ? { links: { self: partner }, data: { type: 'card', id: partner } }
          : { links: { self: null } },
        ...(theme ? { 'cardInfo.theme': { links: { self: theme } } } : {}),
      },
      meta: { adoptsFrom: { module: showModule, name: 'Show' } },
    },
  };
}

const THEME_CSS = ':root { --boxel-brand: seagreen; }';

function themeDocument() {
  return {
    data: {
      type: 'card',
      id: houseTheme,
      attributes: {
        cssVariables: THEME_CSS,
        cssImports: ['https://fonts.example/inter.css'],
      },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/card-api',
          name: 'Theme',
        },
      },
    },
  };
}

// Exercises the Direct tier end to end: real modules through the Host loader,
// a real Store-resident instance, and the one projection pipeline every other
// tier's adapter will use. Direct is the reference implementation of the
// contract (RP-0.5), so a semantic that cannot be expressed through these
// operations is an incomplete interface rather than a gap in one tier.
module('Integration | RP-14 Direct Boxel runtime', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'show.gts': showSource,
        'Show/opening-night.json': showDocument(
          openingNight,
          'Opening Night',
          matinee,
        ),
        'Show/matinee.json': showDocument(matinee, 'Matinee'),
        'Theme/house.json': themeDocument(),
        'Job/import.json': {
          data: {
            type: 'card',
            id: importJob,
            attributes: { progressDone: 3, progressTotal: 12 },
            meta: { adoptsFrom: { module: showModule, name: 'Job' } },
          },
        },
        'Show/themed.json': showDocument(
          themedShow,
          'Themed',
          undefined,
          houseTheme,
        ),
      },
    });
  });

  function newRuntime() {
    let cardService = getService('card-service');
    return new DirectBoxelRuntime(
      () => cardService.getAPI(),
      () => getService('loader-service').loader,
    );
  }

  async function retainedShow(runtime: DirectBoxelRuntime, id = openingNight) {
    let store = getService('store') as StoreService;
    let instance = (await store.get(id)) as CardDef;
    return runtime.retainInstance(instance);
  }

  // The projection reports the state an instance is in; the renderer is what
  // pulls a link into it (RP-7.2). So a test about what a themed card projects
  // arranges the link first, through the ordinary setter main's own editors
  // use, rather than depending on a fetch to land mid-test.
  async function retainedWithTheme(runtime: DirectBoxelRuntime) {
    let store = getService('store') as StoreService;
    let theme = await store.get(houseTheme);
    let instance = (await store.get(themedShow)) as CardDef;
    (
      instance as unknown as { cardInfo: Record<string, unknown> }
    ).cardInfo.theme = theme;
    await settled();
    return runtime.retainInstance(instance);
  }

  test('RP-14.2: every operation answers for a real card, and a released handle answers for nothing', async function (assert) {
    let runtime = newRuntime();
    assert.strictEqual(runtime.mode, 'direct');

    let type = await runtime.loadBoxel(showRef);
    let description = await runtime.describeBoxel(type);
    assert.deepEqual(description.ref, showRef);
    assert.strictEqual(description.boxelKind, 'card');
    assert.strictEqual(description.presentation.displayName, 'Show');
    assert.strictEqual(description.presentation.headerColor, '#ff8800');
    assert.false(description.executionHints.prefersFullSandbox);

    let instance = await retainedShow(runtime);
    let projection = await runtime.projectInstance(instance);
    assert.strictEqual(projection.id, openingNight);
    assert.deepEqual(projection.type, showRef);

    let headline = await runtime.getField(instance, 'headline');
    assert.strictEqual(headline?.kind, 'contains');
    assert.strictEqual(
      await runtime.getField(instance, 'nothing-declares-this'),
      undefined,
    );

    let serialized = await runtime.serializeCard(instance);
    assert.strictEqual(serialized.data.id, openingNight);
    assert.deepEqual(serialized.data.meta.adoptsFrom, {
      module: showModule,
      name: 'Show',
    });

    await runtime.dispose(instance);
    await assert.rejects(
      runtime.projectInstance(instance),
      /Unknown or released direct-instance handle/,
      'a released handle names nothing, rather than quietly answering about a card the caller no longer holds',
    );
  });

  test('RP-12.3: a module reaches the adapter through the Host loader, so nothing here compiles or rewrites it a second time', async function (assert) {
    let runtime = newRuntime();
    let type = await runtime.loadBoxel(showRef);
    let description = await runtime.describeBoxel(type);

    let exports = (await loader.import(showModule)) as Record<string, unknown>;
    let viaLoader = exports.Show as { name: string };
    assert.deepEqual(
      description.ref,
      showRef,
      'the adapter names the module the loader served',
    );
    assert.strictEqual(
      viaLoader.name,
      'Show',
      'and that module is the Host loader’s own — the adapter has no second module graph to resolve into',
    );

    let scoped = [...document.head.querySelectorAll('style')].some((style) =>
      style.textContent?.includes('rebeccapurple'),
    );
    assert.true(
      scoped,
      'the card’s <style scoped> was delivered by the canonical pipeline’s side-effect import, not by a stylesheet compiler of this adapter’s own',
    );
  });

  test('RP-14.1, RP-7.1: a loaded link projects as identity, and an unset one as absent — never as an expanded graph', async function (assert) {
    let runtime = newRuntime();
    let instance = await retainedShow(runtime);
    let projection = await runtime.projectInstance(instance);

    assert.deepEqual(
      readBoxelValueReference(projection.model.partner),
      { $boxel: { id: matinee, type: showRef } },
      'the linked card crosses as an id and a type, with none of its own data',
    );

    let partner = await retainedShow(runtime, matinee);
    assert.strictEqual(
      (await runtime.projectInstance(partner)).model.partner,
      null,
      'and an unset link is absent, the way the ordinary getter answers for it',
    );
  });

  test('RP-3.3, RP-14.1: contains composites expand in place, because they are embedded data and not a separate resource', async function (assert) {
    let runtime = newRuntime();
    let projection = await runtime.projectInstance(await retainedShow(runtime));

    assert.deepEqual(projection.model.venue, {
      name: 'Majestic',
      city: 'Cairo',
    });
    assert.deepEqual(projection.model.tags, ['gala', 'premiere']);
  });

  test('RP-4.1: a computeVia field’s value is projected, evaluated by the runtime that owns the definition', async function (assert) {
    let runtime = newRuntime();
    let projection = await runtime.projectInstance(await retainedShow(runtime));

    assert.strictEqual(
      projection.model.billing,
      'Opening Night at the Majestic',
      'the record carries the computed value; another tier computes the same member with its own copy of the same function',
    );
  });

  test('RP-5.1, RP-5.2: configuration resolves against the owning instance, and a type has none to resolve against', async function (assert) {
    let runtime = newRuntime();
    let instance = await retainedShow(runtime);

    let headline = await runtime.getField(instance, 'headline');
    assert.deepEqual(headline?.resolvedConfiguration, {
      placeholder: 'Untitled show',
      layout: { columns: 2 },
    });

    let venue = await runtime.getField(instance, 'venue');
    assert.deepEqual(
      venue?.resolvedConfiguration,
      { layout: { rows: 3, wrap: true } },
      'per-usage wins over the FieldDef static, merged one level deep',
    );

    let type = await runtime.loadBoxel(showRef);
    assert.strictEqual(
      (await runtime.getField(type, 'venue'))?.resolvedConfiguration,
      null,
      'a type has no instance to run resolution with, so it reports no configuration rather than an unresolved one',
    );
  });

  test('RP-9.1: a field reports computed and query-backed separately, and neither is the value', async function (assert) {
    let runtime = newRuntime();
    let fields = await runtime.getFields(await retainedShow(runtime));
    let byName = new Map(fields.map((field) => [field.fieldName, field]));

    assert.true(byName.get('billing')?.isComputed);
    assert.false(byName.get('headline')?.isComputed);
    assert.false(
      byName.get('partner')?.isQueryBacked,
      'a declared link is editable; a query-backed one never is',
    );
    assert.notOk(
      fields.some((field) => 'value' in field),
      'a field carries its declaration, and the projection’s model carries what it holds',
    );
  });

  test('RP-2.2, RP-2.3: the format inventory names each slot’s provider and tells an authored one from a trusted-Base fallback', async function (assert) {
    let runtime = newRuntime();
    let description = await runtime.describeBoxel(
      await runtime.loadBoxel(showRef),
    );
    let byFormat = new Map(
      description.formats.map((format) => [format.format, format.provider]),
    );

    assert.deepEqual(
      byFormat.get('embedded'),
      { kind: 'authored', ref: showRef },
      'the card declared this one, so the provider is the card',
    );
    assert.strictEqual(
      byFormat.get('isolated')?.kind,
      'trusted-base',
      'and the one it did not declare falls back to Base’s own, which is not authored output',
    );
  });

  test('RP-11.2: presentation carries the cardInfo mirrors the Host’s chrome reads', async function (assert) {
    let runtime = newRuntime();
    let projection = await runtime.projectInstance(await retainedShow(runtime));

    assert.strictEqual(
      projection.presentation.title,
      'Untitled Show',
      'the computed mirror’s own fallback, read as main reads it',
    );
    assert.false(projection.presentation.isThemed);
    assert.strictEqual(projection.presentation.themeScope, null);
  });

  test('RP-11.3: a card linking a Theme carries the scope token, the CSS, and the imports its container needs', async function (assert) {
    let runtime = newRuntime();
    let projection = await runtime.projectInstance(
      await retainedWithTheme(runtime),
    );
    let { presentation } = projection;

    assert.true(presentation.isThemed);
    assert.deepEqual(
      readBoxelValueReference(presentation.theme),
      {
        $boxel: {
          id: houseTheme,
          type: { module: rri('@cardstack/base/card-api'), name: 'Theme' },
        },
      },
      'the Theme crosses as a reference — resolving it is the graph walk a projection forbids',
    );
    assert.strictEqual(presentation.themeCss, THEME_CSS);
    assert.deepEqual(presentation.cssImports, [
      'https://fonts.example/inter.css',
    ]);
    assert.strictEqual(
      presentation.themeScope,
      themeScope(houseTheme, THEME_CSS),
      'and the scope is the content hash Base derives, so a tier’s stamped attribute matches the selector the stylesheet compiled against',
    );
  });

  test('RP-11.3: a card linking no Theme is unthemed, and carries no scope to stamp', async function (assert) {
    let runtime = newRuntime();
    let { presentation } = await runtime.projectInstance(
      await retainedShow(runtime),
    );

    assert.deepEqual(
      {
        isThemed: presentation.isThemed,
        theme: presentation.theme,
        themeScope: presentation.themeScope,
        themeCss: presentation.themeCss,
      },
      { isThemed: false, theme: null, themeScope: null, themeCss: null },
    );
  });

  test('RP-1.1: the adapter’s render entry is main’s memoized component, not a second one built beside it', async function (assert) {
    let runtime = newRuntime();
    let instance = await retainedShow(runtime);

    assert.strictEqual(
      runtime.getRenderComponent(instance),
      runtime.getRenderComponent(instance),
      'component identity is stable per instance, so a reactive re-render never remounts the tree',
    );
  });

  test('RP-14.1: the runtime’s diagnostic view reports a path the projection lacks, naming the type and the mode that produced it', async function (assert) {
    let runtime = newRuntime();
    let projection = await runtime.projectInstance(await retainedShow(runtime));
    let watched = runtime.watchProjectionPaths(
      projection,
      'isolated',
    ) as typeof projection & { model: Record<string, unknown> };
    let warned: string[] = [];
    let original = console.warn;
    console.warn = (message: string) => warned.push(message);
    try {
      assert.strictEqual(
        watched.model.runningTime,
        undefined,
        'nothing is synthesized for a member the pipeline does not project',
      );
      assert.strictEqual(watched.model.headline, 'Opening Night');
    } finally {
      console.warn = original;
    }

    assert.strictEqual(warned.length, 1);
    for (let named of ['projection.model.runningTime', 'Show from', 'direct']) {
      assert.true(
        warned[0].includes(named),
        `the report names ${named}: ${warned[0]}`,
      );
    }
  });

  test('RP-4.4, RP-5.4: a trusted Base value’s plain getter is carried, because getFields cannot see it', async function (assert) {
    let runtime = newRuntime();
    let projection = await runtime.projectInstance(await retainedShow(runtime));
    let price = projection.model.price as Record<string, unknown>;

    assert.strictEqual(price.code, 'EUR', 'the declared field');
    assert.strictEqual(
      price.symbol,
      '€',
      'and the plain getter Base’s own atom template reads as @model.symbol — invisible to getFields, so a model built from fields alone would render a different card',
    );

    let fields = await runtime.getFields(await retainedShow(runtime));
    assert.notOk(
      fields.some((field) => field.fieldName === 'symbol'),
      'and it is not a field, so it appears only in the model',
    );
  });

  test('RP-4.4, RP-5.4: an authored card inherits the trusted getters its Base templates read', async function (assert) {
    let runtime = newRuntime();
    let store = getService('store') as StoreService;
    let job = (await store.get(importJob)) as CardDef;
    let { model } = await runtime.projectInstance(runtime.retainInstance(job));

    // Job is authored and ProcessCard is trusted, so the walk has to step over
    // the authored class to reach these — and they are root-level members, not
    // members of a nested composite.
    assert.deepEqual(
      {
        percentComplete: model.percentComplete,
        progressLabel: model.progressLabel,
        statusLabel: model.statusLabel,
      },
      {
        percentComplete: 25,
        progressLabel: '3 of 12 items',
        statusLabel: 'running',
      },
      'the getters Base’s own template reads as @model.x, none of which getFields can see',
    );
  });

  test('RP-3.3: a field the instance never carried is present holding undefined, not null', async function (assert) {
    let runtime = newRuntime();
    // Materialized from a document carrying only `headline`, so `subtitle` was
    // never in the data bucket and reads as the field's declared empty value.
    // A realm-loaded card is the other case — its document serializes an
    // unauthored primitive as `null` — which is why this builds its own.
    let resource = {
      type: 'card',
      id: `${testRealmURL}Show/sparse`,
      attributes: { headline: 'Sparse' },
      meta: { adoptsFrom: { module: showModule, name: 'Show' } },
    };
    let instance = (await createFromSerialized(
      resource as never,
      { data: resource } as never,
      undefined,
    )) as CardDef;
    let { model } = await runtime.projectInstance(
      runtime.retainInstance(instance),
    );

    assert.strictEqual(
      (instance as unknown as Record<string, unknown>).subtitle,
      undefined,
      'the live instance reads the declared empty value, which is undefined for every primitive but Boolean',
    );
    assert.true(
      'subtitle' in model,
      'the member is present, so nothing routes it through the missing-path diagnostic',
    );
    assert.strictEqual(
      model.subtitle,
      undefined,
      'and it holds what the instance holds — which leaves null meaning a value the field actually has',
    );
  });

  test('RP-7.6: a query-backed field that has not run projects as an empty membership', async function (assert) {
    let runtime = newRuntime();
    let { model } = await runtime.projectInstance(await retainedShow(runtime));

    assert.deepEqual(
      model.revivals,
      [],
      'which is also what a search that ran and matched nothing projects — the record has no spelling for the difference, and a tier reading it shows "no results" for a query that has not started',
    );
  });

  test('RP-9.1, RP-7.6: a query-backed relationship reports as query-backed and is not computed', async function (assert) {
    let runtime = newRuntime();
    let fields = await runtime.getFields(await retainedShow(runtime));
    let revivals = fields.find((field) => field.fieldName === 'revivals');

    assert.deepEqual(
      {
        isComputed: revivals?.isComputed,
        isQueryBacked: revivals?.isQueryBacked,
        kind: revivals?.kind,
      },
      { isComputed: false, isQueryBacked: true, kind: 'linksToMany' },
      'a query-backed link is never editable and is not computed, so isComputed alone could not state RP-9.1’s rule',
    );
  });

  test('RP-7.1, RP-7.2: a projection reports a not-loaded link without starting its load', async function (assert) {
    let runtime = newRuntime();
    // Materialized from a document that names the link but carries no
    // `included` entry for it, so `partner` starts not-loaded — the state a
    // projection must be able to report without changing it.
    let resource = {
      type: 'card',
      id: `${testRealmURL}Show/lonely`,
      attributes: { headline: 'Lonely' },
      relationships: { partner: { links: { self: matinee } } },
      meta: { adoptsFrom: { module: showModule, name: 'Show' } },
    };
    let instance = (await createFromSerialized(
      resource as never,
      { data: resource } as never,
      undefined,
    )) as CardDef;

    let before = getRelationshipMembershipState(instance, 'partner');
    assert.deepEqual(
      { kind: before.membership?.[0]?.kind, isLoading: before.isLoading },
      { kind: 'not-loaded', isLoading: false },
      'the link starts not-loaded and nothing is in flight',
    );

    let projection = await runtime.projectInstance(
      runtime.retainInstance(instance),
    );

    let after = getRelationshipMembershipState(instance, 'partner');
    assert.deepEqual(
      { kind: after.membership?.[0]?.kind, isLoading: after.isLoading },
      { kind: 'not-loaded', isLoading: false },
      'and the projection left it there — a fetch it started would show as in flight here, and a failed one would plant a terminal sentinel on a link no render asked for',
    );
    assert.strictEqual(
      projection.model.partner,
      null,
      'a non-present slot projects as absent, which is what the ordinary getter answers for it',
    );
  });

  test('RP-14.4: Direct’s records for a real card are read as data by the parity harness with direct registered', async function (assert) {
    let runtime = newRuntime();
    let instance = await retainedShow(runtime);
    let report = checkRecordParity({
      fixture: openingNight,
      tiers: [
        {
          mode: 'direct',
          description: await runtime.describeBoxel(
            await runtime.loadBoxel(showRef),
          ),
          projection: await runtime.projectInstance(instance),
        },
      ],
      registeredModes: ['direct'],
    });

    assert.true(reportsParity(report), describeParityReport(report));
    assert.strictEqual(report.inspections, 2);
  });

  test('RP-14.2: a definition the runtime cannot identify fails loudly, whatever a caller wanted the instance for', async function (assert) {
    let runtime = newRuntime();
    let resource = {
      type: 'card',
      attributes: { headline: 'Nowhere' },
      meta: {
        adoptsFrom: { module: `${testRealmURL}absent`, name: 'Missing' },
      },
    };

    for (let purpose of ['host-display', 'indexing'] as const) {
      await assert.rejects(
        runtime.createFromSerialized(
          resource as never,
          { data: resource } as never,
          undefined as unknown as RealmResourceIdentifier,
          purpose,
        ),
        /not found|Cannot find card/i,
        `${purpose} is not lenient here either — Direct is main, and the Host’s chrome is what presents the failure`,
      );
    }
  });
});
