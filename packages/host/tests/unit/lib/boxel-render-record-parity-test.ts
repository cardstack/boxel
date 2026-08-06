import 'ses';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { themeScope, themeScopedCss } from '@cardstack/boxel-ui/helpers';

import type {
  BoxelInstanceHandle,
  BoxelRenderRecord,
  JSONValue,
  LooseCardResource,
  LooseSingleCardDocument,
  RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import BoxelExecutionEngine, {
  type BoxelExecutionRequest,
} from '@cardstack/host/lib/boxel-execution-engine';
import {
  projectBoxelExecutionDocument,
  projectHostBoxelSemantics,
  type HostBoxelProjection,
} from '@cardstack/host/lib/boxel-projection';
import BoxelRuntimeRouter from '@cardstack/host/lib/boxel-runtime-router';
import type { BoxelSourceClassification } from '@cardstack/host/lib/boxel-source-classifier';
import CapsuleBoxelRuntime from '@cardstack/host/lib/capsule-boxel-runtime';
import CapsuleModuleEvaluator from '@cardstack/host/lib/capsule-module-evaluator';
import DirectBoxelRuntime from '@cardstack/host/lib/direct-boxel-runtime';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type * as CardAPIModule from '@cardstack/base/card-api';

const showModule = `${testRealmURL}show`;

function isTrustedModule(moduleIdentifier: string): boolean {
  return (
    moduleIdentifier.startsWith('@cardstack/') ||
    moduleIdentifier.startsWith('https://cardstack.com/base/')
  );
}
const showId = `${testRealmURL}Show/opening-night`;
const partnerId = `${testRealmURL}Show/matinee`;

const fixtureSource = `
  import {
    CardDef,
    FieldDef,
    Component,
    contains,
    containsMany,
    field,
    linksTo,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class VenueField extends FieldDef {
    static displayName = 'Venue';
    static configuration = { icon: 'stage', layout: { rows: 1, wrap: true } };
    @field name = contains(StringField);
  }

  export class Show extends CardDef {
    static displayName = 'Show';
    @field headline = contains(StringField, {
      description: 'Top billing for the show',
      configuration: { placeholder: 'Untitled show', layout: { columns: 2 } },
    });
    @field venue = contains(VenueField, {
      configuration: { layout: { rows: 3 } },
    });
    @field tags = containsMany(StringField);
    @field partner = linksTo(() => Show);
    @field billing = contains(StringField, {
      computeVia: function () {
        return this.headline + ' at the Majestic';
      },
    });
    static embedded = class Embedded extends Component<typeof Show> {
      <template><div data-test-show>{{@model.headline}}</div></template>
    };
  }
`;

function fixtureDocument(): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      id: showId,
      attributes: {
        headline: 'Opening Night',
        venue: { name: 'Majestic' },
        tags: ['gala', 'premiere'],
      },
      relationships: {
        partner: {
          links: { self: partnerId },
          data: { type: 'card', id: partnerId },
        },
      },
      meta: {
        adoptsFrom: { module: showModule, name: 'Show' },
      },
    },
    included: [
      {
        type: 'card',
        id: partnerId,
        attributes: {
          headline: 'Matinee',
          tags: [],
        },
        relationships: {
          partner: { links: { self: null } },
        },
        meta: {
          adoptsFrom: { module: showModule, name: 'Show' },
        },
      },
    ],
  } as unknown as LooseSingleCardDocument;
}

const placeModule = `${testRealmURL}place`;
const placeId = `${testRealmURL}Place/one`;
const guideId = `${testRealmURL}Guide/notes`;
const reviewerAId = `${testRealmURL}Reviewer/a`;
const reviewerBId = `${testRealmURL}Reviewer/b`;
const themedPlaceId = `${testRealmURL}Place/dark-mode`;
// A realm target distinct from `testRealmURL`, scoped by a temporary
// `VirtualNetwork` mapping only for the theme-scope-token test below —
// deliberately not the realm the other fixtures already live in, so
// registering (and cleaning up) that mapping cannot alias or collide with
// them.
const themeRealmTarget = 'https://theme-realm-parity-test.example/';
const themeId = `${themeRealmTarget}Theme/midnight`;
const themeCssVariables =
  ':root{--accent:#2dd4a7;}\n.dark{--background:#0b0f0e;}';

// `cardInfo.theme` is `CardInfoField`'s own `linksTo(Theme)` (card-api.gts),
// present on every `CardDef` for free — no fixture source changes needed,
// only the JSON:API relationship, exactly like `Place`'s own `guide`/
// `reviewers` relationships above but at the nested dotted path a `contains`
// field's own `linksTo` uses.
function themedPlaceDocument(): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      id: themedPlaceId,
      attributes: {
        coordinate: { x: 1, y: 2 },
        entries: [],
      },
      relationships: {
        'cardInfo.theme': {
          links: { self: themeId },
          data: { type: 'card', id: themeId },
        },
      },
      meta: {
        adoptsFrom: { module: placeModule, name: 'Place' },
      },
    },
    included: [
      {
        type: 'card',
        id: themeId,
        attributes: {
          cssVariables: themeCssVariables,
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'Theme',
          },
        },
      },
    ],
  } as unknown as LooseSingleCardDocument;
}

const placeFixtureSource = `
  import {
    CardDef,
    FieldDef,
    contains,
    containsMany,
    field,
    linksTo,
    linksToMany,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  import NumberField from 'https://cardstack.com/base/number';

  export class CoordinateField extends FieldDef {
    static displayName = 'Coordinate';
    @field x = contains(NumberField);
    @field y = contains(NumberField);
  }

  export class EntryField extends FieldDef {
    static displayName = 'Entry';
    @field fieldPath = contains(StringField);
  }

  export class Guide extends CardDef {
    static displayName = 'Guide';
    @field notes = containsMany(StringField);
  }

  export class Reviewer extends CardDef {
    static displayName = 'Reviewer';
    @field name = contains(StringField);
  }

  export class Place extends CardDef {
    static displayName = 'Place';
    @field coordinate = contains(CoordinateField);
    @field entries = containsMany(EntryField);
    @field guide = linksTo(Guide);
    @field reviewers = linksToMany(Reviewer);
    get cardTitle() {
      return 'Place ' + this.coordinate.x + ',' + this.coordinate.y;
    }
    // Mirrors the guide-cascade shape: authored code on the linking card
    // reads a linked card's own containsMany field.
    get guideNoteCount() {
      return (this.guide?.notes ?? []).length;
    }
  }
`;

function placeDocument(): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      id: placeId,
      attributes: {
        coordinate: { x: 42.2528, y: -73.7907 },
        entries: [{ fieldPath: 'a.b' }, { fieldPath: 'c.d' }],
      },
      relationships: {
        guide: {
          links: { self: guideId },
          data: { type: 'card', id: guideId },
        },
        'reviewers.0': {
          links: { self: reviewerAId },
          data: { type: 'card', id: reviewerAId },
        },
        'reviewers.1': {
          links: { self: reviewerBId },
          data: { type: 'card', id: reviewerBId },
        },
      },
      meta: {
        adoptsFrom: { module: placeModule, name: 'Place' },
      },
    },
    included: [
      {
        type: 'card',
        id: guideId,
        attributes: {
          notes: ['north wing', 'south wing'],
        },
        meta: {
          adoptsFrom: { module: placeModule, name: 'Guide' },
        },
      },
      {
        type: 'card',
        id: reviewerAId,
        attributes: { name: 'Ada' },
        meta: {
          adoptsFrom: { module: placeModule, name: 'Reviewer' },
        },
      },
      {
        type: 'card',
        id: reviewerBId,
        attributes: { name: 'Bo' },
        meta: {
          adoptsFrom: { module: placeModule, name: 'Reviewer' },
        },
      },
    ],
  } as unknown as LooseSingleCardDocument;
}

module('Unit | Boxel render record parity', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'show.gts': fixtureSource,
          'place.gts': placeFixtureSource,
        },
      }),
    );
  });

  setupCardLogs(hooks, async () =>
    getService('loader-service').loader.import('@cardstack/base/card-api'),
  );

  test('Direct and Capsule produce one BoxelRenderRecord shape for the same fixture', async function (assert) {
    let loader = getService('loader-service').loader;
    let network = getService('network');
    let api = await loader.import<typeof CardAPIModule>(
      '@cardstack/base/card-api',
    );

    let requestDocument = fixtureDocument();
    let resource = requestDocument.data as LooseCardResource;
    let relativeTo = showId as RealmResourceIdentifier;

    // The Host materializes the canonical Store-backed instance; Direct
    // renders over that identity (the trusted path the execution engine uses).
    let canonical = await api.createFromSerialized(
      resource as never,
      requestDocument as never,
      relativeTo,
    );

    let direct = new DirectBoxelRuntime(
      async () => api,
      () => loader,
    );
    let directHandle = direct.retainCanonicalInstance(canonical);
    let directRecord = await direct.buildRenderRecord(directHandle);

    let evaluator = new CapsuleModuleEvaluator('@test:record-parity', {
      fetch: network.authedFetch,
      resolveImport: network.resolveImport,
      virtualNetwork: network.virtualNetwork,
    });
    let capsule = new CapsuleBoxelRuntime(evaluator);
    try {
      let referenceDocument = structuredClone(requestDocument);
      let projectedDocument = projectBoxelExecutionDocument(
        canonical,
        requestDocument,
        api,
        isTrustedModule,
      );
      let hostProjection = projectHostBoxelSemantics(canonical, api);
      assert.deepEqual(
        requestDocument,
        referenceDocument,
        'projection returns a new document without mutating its input',
      );

      let capsuleHandle = await capsule.createFromSerialized(
        projectedDocument.data as LooseCardResource,
        projectedDocument,
        relativeTo,
        'host-display',
      );
      capsule.adoptHostProjection(capsuleHandle, hostProjection);
      let capsuleRecord = await capsule.buildRenderRecord(capsuleHandle);

      // Direct is the reference implementation (RP-14.4): the description,
      // instance identity, resolved fields, and instance presentation must be
      // deep-equal across tiers.
      assert.deepEqual(
        capsuleRecord.boxel,
        directRecord.boxel,
        'BoxelDescription is identical across Direct and Capsule',
      );
      assert.strictEqual(
        capsuleRecord.instance.id,
        directRecord.instance.id,
        'instance identity is identical across tiers',
      );
      assert.deepEqual(
        capsuleRecord.instance.fields,
        directRecord.instance.fields,
        'ResolvedField projections are identical across tiers',
      );
      assert.deepEqual(
        capsuleRecord.presentation,
        directRecord.presentation,
        'instance presentation is identical across tiers',
      );

      // The record model carries declared field values in the canonical
      // projected shape. The Capsule may additionally surface JSON-safe
      // authored getter results; declared fields and id must still agree.
      for (let { fieldName } of directRecord.instance.fields) {
        assert.deepEqual(
          capsuleRecord.instance.model[fieldName],
          directRecord.instance.model[fieldName],
          `model value for '${fieldName}' is identical across tiers`,
        );
      }
      assert.strictEqual(
        capsuleRecord.instance.model.id,
        directRecord.instance.model.id,
        'model id is identical across tiers',
      );

      // Shape probes pin the reference semantics themselves so an
      // equal-but-wrong pair of records cannot pass silently.
      let fieldsByName = new Map(
        directRecord.instance.fields.map((field) => [field.fieldName, field]),
      );
      // `partner` is a *loaded* linksTo target whose resource was
      // side-loaded in `included` (RP-8.3): on main, a template or getter
      // reads its fields straight through the model (RP-7.1's present
      // state), so it must materialize here too, not collapse to a bare
      // `$boxel` reference. RP-0.1: main's observed behavior is the
      // contract this branch's protocol draft must match.
      let partnerValue = fieldsByName.get('partner')?.value as
        | Record<string, unknown>
        | null
        | undefined;
      assert.strictEqual(
        partnerValue?.id,
        partnerId,
        'a loaded, side-loaded linksTo target keeps its instance id (RP-8.1, RP-8.3)',
      );
      assert.strictEqual(
        partnerValue?.headline,
        'Matinee',
        "a loaded linksTo target's own fields materialize through the model, matching main's ordinary-getter read (RP-7.1)",
      );
      assert.deepEqual(
        partnerValue?.tags,
        [],
        "a loaded linksTo target's own containsMany fields expand too (RP-3.3)",
      );
      assert.strictEqual(
        partnerValue?.partner,
        null,
        "a loaded target's own not-set relationship stays absent, bounding expansion depth to what the document actually side-loaded (RP-7.1, RP-8.4)",
      );
      assert.notOk(
        (partnerValue as { $boxel?: unknown } | undefined)?.$boxel,
        'a loaded link is materialized data, not a bare $boxel reference stub',
      );
      assert.deepEqual(
        fieldsByName.get('headline')?.resolvedConfiguration,
        { placeholder: 'Untitled show', layout: { columns: 2 } },
        'per-usage configuration is resolved into the record',
      );
      assert.deepEqual(
        fieldsByName.get('venue')?.resolvedConfiguration,
        { icon: 'stage', layout: { rows: 3, wrap: true } },
        'FieldDef-static and per-usage configuration merge with per-usage winning',
      );
      assert.deepEqual(
        fieldsByName.get('headline')?.presentation,
        { description: 'Top billing for the show' },
        'field presentation carries the authored description',
      );
      assert.true(
        Boolean(fieldsByName.get('billing')?.value),
        'computed field values materialize in the record',
      );
      assert.true(
        directRecord.instance.fields.every((field) => field.writable === false),
        'writability requires an explicit Host grant and defaults to false',
      );
      let embedded = directRecord.boxel.formats.find(
        (format) => format.format === 'embedded',
      );
      assert.deepEqual(
        embedded?.provider,
        {
          kind: 'authored',
          ref: { module: showModule as RealmResourceIdentifier, name: 'Show' },
        },
        'an authored format names its declaring class as provider',
      );
      let isolated = directRecord.boxel.formats.find(
        (format) => format.format === 'isolated',
      );
      assert.strictEqual(
        isolated?.provider.kind,
        'trusted-base',
        'an undeclared format falls back to its trusted Base provider',
      );
    } finally {
      capsule.destroy();
    }
  });

  test('nested contains/containsMany/loaded-linksTo values survive into the projected render model', async function (assert) {
    let loader = getService('loader-service').loader;
    let network = getService('network');
    let api = await loader.import<typeof CardAPIModule>(
      '@cardstack/base/card-api',
    );

    let requestDocument = placeDocument();
    let resource = requestDocument.data as LooseCardResource;
    let relativeTo = placeId as RealmResourceIdentifier;

    let canonical = await api.createFromSerialized(
      resource as never,
      requestDocument as never,
      relativeTo,
    );

    let direct = new DirectBoxelRuntime(
      async () => api,
      () => loader,
    );
    let directHandle = direct.retainCanonicalInstance(canonical);
    let directRecord = await direct.buildRenderRecord(directHandle);

    let evaluator = new CapsuleModuleEvaluator('@test:record-parity-nested', {
      fetch: network.authedFetch,
      resolveImport: network.resolveImport,
      virtualNetwork: network.virtualNetwork,
    });
    let capsule = new CapsuleBoxelRuntime(evaluator);
    try {
      let projectedDocument = projectBoxelExecutionDocument(
        canonical,
        requestDocument,
        api,
        isTrustedModule,
      );
      let hostProjection = projectHostBoxelSemantics(canonical, api);

      let capsuleHandle = await capsule.createFromSerialized(
        projectedDocument.data as LooseCardResource,
        projectedDocument,
        relativeTo,
        'host-display',
      );
      capsule.adoptHostProjection(capsuleHandle, hostProjection);
      let capsuleRecord = await capsule.buildRenderRecord(capsuleHandle);

      // This is exactly the shape `boxel-execution-renderer.gts` binds as
      // `@model` for the authored isolated/edit templates (RP-3.2): a
      // `contains` field must stay the live-equivalent expanded object, not
      // collapse to the field instance's own bare `$boxel` reference.
      assert.deepEqual(
        capsuleRecord.instance.model.coordinate,
        { x: 42.2528, y: -73.7907 },
        'a contains(FieldDef) composite keeps its nested attributes in the Capsule render model',
      );
      assert.deepEqual(
        directRecord.instance.model.coordinate,
        { x: 42.2528, y: -73.7907 },
        'a contains(FieldDef) composite keeps its nested attributes in the Direct render model',
      );

      assert.deepEqual(
        capsuleRecord.instance.model.entries,
        [{ fieldPath: 'a.b' }, { fieldPath: 'c.d' }],
        "a containsMany(FieldDef) keeps each entry's attributes in the Capsule render model",
      );
      assert.deepEqual(
        directRecord.instance.model.entries,
        [{ fieldPath: 'a.b' }, { fieldPath: 'c.d' }],
        "a containsMany(FieldDef) keeps each entry's attributes in the Direct render model",
      );

      // `guide` is a loaded linksTo target whose resource was side-loaded in
      // `included`: RP-7.1's present state reads through the model exactly
      // like main, so it must materialize, not collapse to a `$boxel`
      // reference stub (this is the same mechanism as the coordinate/entries
      // cases above, applied to a relationship instead of a composite).
      let capsuleGuide = capsuleRecord.instance.model.guide as
        | Record<string, unknown>
        | null
        | undefined;
      let directGuide = directRecord.instance.model.guide as
        | Record<string, unknown>
        | null
        | undefined;
      for (let [label, guide] of [
        ['Capsule', capsuleGuide],
        ['Direct', directGuide],
      ] as const) {
        assert.strictEqual(
          guide?.id,
          guideId,
          `a loaded, side-loaded linksTo target keeps its instance id in the ${label} render model (RP-8.1, RP-8.3)`,
        );
        assert.deepEqual(
          guide?.notes,
          ['north wing', 'south wing'],
          `a loaded linksTo target's own containsMany field materializes in the ${label} render model (RP-7.1, RP-3.3)`,
        );
        assert.notOk(
          (guide as { $boxel?: unknown } | undefined)?.$boxel,
          `a loaded link is materialized data in the ${label} render model, not a bare $boxel reference stub`,
        );
      }

      // `reviewers` is a `linksToMany` with two loaded, side-loaded targets —
      // this is what an isolated-format plural view iterates through
      // `@model.reviewers` (RP-3.2, RP-7.1). Regression coverage for the
      // browser-verified bug: reading relationship state off the raw peeked
      // array conflates "not yet resolved" with "absent" and silently drops
      // present slots to a shorter (or empty) array with no error. The fix
      // reads membership through `getRelationshipMembershipState` (RP-7.1's
      // sanctioned observation) instead, so cardinality only ever reflects
      // the field's actual `present` slots.
      for (let [label, model] of [
        ['Capsule', capsuleRecord.instance.model],
        ['Direct', directRecord.instance.model],
      ] as const) {
        let reviewers = model.reviewers as Record<string, unknown>[];
        assert.strictEqual(
          reviewers?.length,
          2,
          `both linksToMany items materialize in the ${label} render model (RP-7.1 present state)`,
        );
        assert.deepEqual(
          reviewers?.map((reviewer) => reviewer.name),
          ['Ada', 'Bo'],
          `each linksToMany item's own fields materialize, in document order, in the ${label} render model`,
        );
        assert.deepEqual(
          reviewers?.map((reviewer) => reviewer.id),
          [reviewerAId, reviewerBId],
          `each linksToMany item keeps its instance id in the ${label} render model`,
        );
      }

      // An authored getter reading those same nested values, exercised
      // through the production entry point (evaluateCardProjection over the
      // canonical snapshot) rather than the render model directly.
      assert.strictEqual(
        capsuleRecord.presentation.title,
        'Place 42.2528,-73.7907',
        'an authored getter reads nested contains values through the same projection',
      );
      // Mirrors the guide-cascade shape: an authored getter on the linking
      // card reads a loaded linked card's own containsMany field.
      assert.strictEqual(
        capsuleRecord.instance.model.guideNoteCount,
        2,
        "an authored getter on the linking card reads the linked card's containsMany field",
      );
    } finally {
      capsule.destroy();
    }
  });

  test('a card whose cardInfo.theme links a Theme card carries the theme scope token into its render record presentation', async function (assert) {
    // Regression coverage for the branch's Capsule render path rendering a
    // themed card unthemed. Two distinct defects, fixed in sequence:
    //
    // 1. The theme stylesheet (`@cardstack/boxel-ui/helpers/
    //    theme-scoped-css.ts`'s `themeScopedCss()`) installs correctly, but
    //    nothing stamped the `data-boxel-theme-scope` attribute its selector
    //    is anchored to — that attribute's value (`themeScope()`'s token)
    //    was never projected into the render record for a Capsule-mounted
    //    trusted `CardContainer` portal to stamp. Fixed by projecting the
    //    token into `presentation` (RP-5.4) for `BoxelExecutionRenderer`'s
    //    `themeScope` getter to stamp on its slot wrapper.
    // 2. Once stamped, the token's *value* still didn't match: the theme
    //    card's id crosses the execution boundary in absolute-URL form
    //    (`useAbsoluteURL: true` in `boxel-execution.ts`'s `requestFor`,
    //    RP-8.4's cross-boundary module-identity stability), but the theme
    //    stylesheet a realm's index/prerender pipeline installs is compiled
    //    against the theme's *registered scoped-identifier* form
    //    (`unresolveResourceInstanceURLs` in `runtime-common/url.ts` runs on
    //    every realm-served document — main's live `field-component.gts`
    //    render sees this same normalized form, never the raw URL). Fixed by
    //    normalizing the theme id through `VirtualNetwork.unresolveURL`
    //    (`HostBoxelProjectionOptions.unresolveURL`) before deriving the
    //    token.
    let loader = getService('loader-service').loader;
    let network = getService('network');
    let api = await loader.import<typeof CardAPIModule>(
      '@cardstack/base/card-api',
    );

    // A realm prefix scoped to this test, so the assertion below exercises
    // real `VirtualNetwork` normalization instead of assuming anything
    // about how the base or catalog realms happen to be mapped in the test
    // environment.
    let themeRealmPrefix = '@test-scope/theme-realm/';
    network.virtualNetwork.addRealmMapping(themeRealmPrefix, themeRealmTarget);
    try {
      let requestDocument = themedPlaceDocument();
      let resource = requestDocument.data as LooseCardResource;
      let relativeTo = themedPlaceId as RealmResourceIdentifier;

      let canonical = await api.createFromSerialized(
        resource as never,
        requestDocument as never,
        relativeTo,
      );

      let normalizedThemeId = network.virtualNetwork.unresolveURL(themeId);
      assert.strictEqual(
        normalizedThemeId,
        `${themeRealmPrefix}Theme/midnight`,
        'sanity: the registered realm mapping normalizes the absolute theme id to its scoped prefix form',
      );
      let expectedThemeScope = themeScope(normalizedThemeId, themeCssVariables);
      assert.ok(
        expectedThemeScope,
        'the fixture theme has both an id and CSS, so themeScope() itself resolves a token',
      );

      // Drift-proof per the defect-2 fix above: derive the expected token by
      // generating the actual stylesheet text `themeScopedCss` emits for
      // this theme and extracting the selector it embeds, rather than only
      // comparing against a hand-computed string — if `themeScopedCss`'s
      // output format (escaping, quoting) ever changes, this assertion
      // tracks it instead of silently passing against a stale expectation.
      let generatedStylesheet = themeScopedCss(
        expectedThemeScope,
        themeCssVariables,
      ).toString();
      let embeddedToken = /\[data-boxel-theme-scope="([^"]*)"\]/.exec(
        generatedStylesheet,
      )?.[1];
      assert.strictEqual(
        embeddedToken,
        expectedThemeScope,
        "themeScopedCss's own stylesheet output embeds the identical token",
      );

      let direct = new DirectBoxelRuntime(
        async () => api,
        () => loader,
        (url) => network.virtualNetwork.unresolveURL(url),
      );
      let directHandle = direct.retainCanonicalInstance(canonical);
      let directRecord = await direct.buildRenderRecord(directHandle);
      assert.strictEqual(
        directRecord.presentation.themeScope,
        expectedThemeScope,
        'Direct projects the same normalized theme scope token main computes',
      );

      let evaluator = new CapsuleModuleEvaluator('@test:record-parity-theme', {
        fetch: network.authedFetch,
        resolveImport: network.resolveImport,
        virtualNetwork: network.virtualNetwork,
      });
      let capsule = new CapsuleBoxelRuntime(evaluator);
      try {
        let projectedDocument = projectBoxelExecutionDocument(
          canonical,
          requestDocument,
          api,
          isTrustedModule,
        );
        let hostProjection = projectHostBoxelSemantics(canonical, api, {
          unresolveURL: (url) => network.virtualNetwork.unresolveURL(url),
        });
        assert.strictEqual(
          hostProjection.presentation.themeScope,
          expectedThemeScope,
          'the Host projection carries the normalized theme scope token before it ever crosses to a boundary tier',
        );

        let capsuleHandle = await capsule.createFromSerialized(
          projectedDocument.data as LooseCardResource,
          projectedDocument,
          relativeTo,
          'host-display',
        );
        capsule.adoptHostProjection(capsuleHandle, hostProjection);
        let capsuleRecord = await capsule.buildRenderRecord(capsuleHandle);

        // This is exactly the field `boxel-execution-renderer.gts`'s
        // `themeScope` getter reads off
        // `this.state.snapshot.current.renderRecord.presentation` to stamp
        // `data-boxel-theme-scope` on the capsule slot wrapper — the same
        // selector the already-installed theme stylesheet is anchored to.
        assert.strictEqual(
          capsuleRecord.presentation.themeScope,
          expectedThemeScope,
          'the Capsule render record carries the token the renderer stamps as data-boxel-theme-scope, matching the installed stylesheet',
        );
      } finally {
        capsule.destroy();
      }
    } finally {
      network.virtualNetwork.removeRealmMapping(themeRealmPrefix);
    }
  });

  test('a card with no cardInfo.theme link carries no theme scope token', async function (assert) {
    let loader = getService('loader-service').loader;
    let api = await loader.import<typeof CardAPIModule>(
      '@cardstack/base/card-api',
    );
    let requestDocument = placeDocument();
    let resource = requestDocument.data as LooseCardResource;
    let canonical = await api.createFromSerialized(
      resource as never,
      requestDocument as never,
      placeId as RealmResourceIdentifier,
    );
    let hostProjection = projectHostBoxelSemantics(canonical, api);
    assert.strictEqual(
      hostProjection.presentation.themeScope,
      null,
      'an unthemed card projects a null theme scope token, so the renderer omits the attribute entirely rather than stamping an empty one',
    );
  });
});

const settleSource: BoxelSourceClassification = {
  tier: 'capsule',
  reason: 'default-user-card',
  imports: [],
  signals: [],
  moduleGraph: [],
  propagatesToImporters: false,
};

const settleResource = {
  id: 'https://example.test/Place/one',
  type: 'card',
  attributes: {},
  relationships: {},
  meta: {
    adoptsFrom: {
      module: 'https://example.test/place',
      name: 'Place',
    },
  },
} as unknown as LooseCardResource;

const settleDocument = {
  data: settleResource,
} as unknown as LooseSingleCardDocument;

const settleBoxel: HostBoxelProjection['boxel'] = {
  protocolVersion: 1,
  requiredFeatures: [],
  ref: settleResource.meta!.adoptsFrom!,
  boxelKind: 'card',
  ancestors: [],
  fields: [],
  formats: [],
  presentation: {
    displayName: 'Place',
    headerColor: null,
    prefersWideFormat: false,
  },
  executionHints: { prefersFullSandbox: false },
};

const settlePresentation: HostBoxelProjection['presentation'] = {
  title: null,
  summary: null,
  thumbnailURL: null,
  theme: null,
  themeScope: null,
};

/**
 * Minimal `CapsuleBoxelRuntime`-shaped stub for exercising
 * `BoxelExecutionSession`'s RP-7.3 settle-republish wiring
 * (boxel-execution-engine.ts) in isolation, without a real SES compartment:
 * it remembers whatever `HostBoxelProjection` `adoptHostProjection` handed
 * it per instance and turns it into a `BoxelRenderRecord` the same way
 * `buildBoxelRenderRecord` does — declared field values become the model.
 */
class SettleStubCapsuleRuntime {
  readonly mode = 'capsule' as const;
  private projections = new Map<BoxelInstanceHandle, HostBoxelProjection>();
  private nextInstance = 0;
  disposed: BoxelInstanceHandle[] = [];

  async createFromSerialized(): Promise<BoxelInstanceHandle> {
    return `capsule-instance:${++this.nextInstance}` as BoxelInstanceHandle;
  }

  adoptHostProjection(
    card: BoxelInstanceHandle,
    projection: HostBoxelProjection,
  ): void {
    this.projections.set(card, projection);
  }

  async buildRenderRecord(
    card: BoxelInstanceHandle,
  ): Promise<BoxelRenderRecord> {
    let projection = this.projections.get(card);
    if (!projection) {
      throw new Error('no adopted projection for this handle');
    }
    let model: Record<string, unknown> = {};
    for (let field of projection.fields) {
      model[field.fieldName] = field.value;
    }
    if (projection.instanceId) {
      model.id = projection.instanceId;
    }
    return {
      protocolVersion: 1,
      boxel: settleBoxel,
      instance: {
        id: projection.instanceId,
        model: model as Record<string, JSONValue>,
        fields: projection.fields,
      },
      presentation: projection.presentation,
    };
  }

  async dispose(card: BoxelInstanceHandle): Promise<void> {
    this.disposed.push(card);
    this.projections.delete(card);
  }

  destroy(): void {}
}

module('Unit | Boxel execution engine settle republish', function () {
  test('a pending relationship settling republishes a fresh generation without blocking first paint (RP-7.3, RP-15.4)', async function (assert) {
    let capsule = new SettleStubCapsuleRuntime();
    let router = new BoxelRuntimeRouter(
      {} as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => {
        throw new Error('sandbox is not used by this fixture');
      },
    );
    let engine = new BoxelExecutionEngine(router, async () => settleSource);
    let session = engine.createSession();

    let onSettleCalls = 0;
    let resolveSettle:
      | ((value: HostBoxelProjection | undefined) => void)
      | undefined;
    let unsettledProjection: HostBoxelProjection = {
      boxel: settleBoxel,
      instanceId: settleResource.id!,
      fields: [
        {
          fieldName: 'reviewers',
          fieldType: {
            module:
              'https://cardstack.com/base/card-api' as RealmResourceIdentifier,
            name: 'CardDef',
          },
          kind: 'linksToMany',
          value: [],
          resolvedConfiguration: null,
          presentation: {},
          writable: false,
        },
      ],
      presentation: settlePresentation,
      onSettle: (signal) => {
        onSettleCalls++;
        return new Promise((resolve) => {
          resolveSettle = resolve;
          signal.addEventListener('abort', () => resolve(undefined));
        });
      },
    };

    let request: BoxelExecutionRequest = {
      principal: 'user:one',
      surfaceId: 'surface:one',
      trusted: false,
      format: 'isolated',
      moduleIdentifier: 'https://example.test/place',
      source: 'capsule',
      resource: settleResource,
      document: settleDocument,
      purpose: 'host-display',
      hostProjection: unsettledProjection,
    };

    let generations: BoxelRenderRecord[] = [];
    let unsubscribe = session.subscribe((snapshot) => {
      if (snapshot.current) {
        generations.push(snapshot.current.renderRecord);
      }
    });

    try {
      let first = await session.update(request);
      assert.ok(first, 'the first generation materializes');
      assert.deepEqual(
        first?.renderRecord.instance.model.reviewers,
        [],
        'RP-7.3: first paint renders the not-yet-settled relationship absent — never blocked on settlement',
      );
      assert.strictEqual(
        onSettleCalls,
        1,
        'the session started watching the reported settle exactly once for this generation',
      );

      let settledProjection: HostBoxelProjection = {
        ...unsettledProjection,
        fields: [
          {
            ...unsettledProjection.fields[0]!,
            value: [{ id: 'https://example.test/Reviewer/a', name: 'Ada' }],
          },
        ],
        onSettle: undefined,
      };
      let secondGenerationPromise = new Promise<BoxelRenderRecord>(
        (resolve) => {
          let unsubscribeSecond = session.subscribe((snapshot) => {
            if (
              snapshot.current &&
              snapshot.current.generation !== first?.generation
            ) {
              unsubscribeSecond();
              resolve(snapshot.current.renderRecord);
            }
          });
        },
      );
      resolveSettle?.(settledProjection);
      let second = await secondGenerationPromise;

      assert.deepEqual(
        second.instance.model.reviewers,
        [{ id: 'https://example.test/Reviewer/a', name: 'Ada' }],
        'once the reported relationship settles, a fresh generation carries the resolved items (RP-7.3, RP-15.4)',
      );
      assert.deepEqual(
        generations.map((record) => record.instance.model.reviewers),
        [[], [{ id: 'https://example.test/Reviewer/a', name: 'Ada' }]],
        'subscribers observe exactly the absent-then-settled sequence, never an intermediate or duplicate generation',
      );
      assert.deepEqual(
        capsule.disposed,
        [],
        'the settle-triggered generation swap is the same atomic replacement update() already performs; nothing is disposed early',
      );
    } finally {
      unsubscribe();
      await session.destroy();
    }
  });

  test('destroying the session stops an in-flight settle watch from republishing', async function (assert) {
    let capsule = new SettleStubCapsuleRuntime();
    let router = new BoxelRuntimeRouter(
      {} as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => {
        throw new Error('sandbox is not used by this fixture');
      },
    );
    let engine = new BoxelExecutionEngine(router, async () => settleSource);
    let session = engine.createSession();

    let abortedSignal: AbortSignal | undefined;
    let projection: HostBoxelProjection = {
      boxel: settleBoxel,
      instanceId: settleResource.id!,
      fields: [
        {
          fieldName: 'reviewers',
          fieldType: {
            module:
              'https://cardstack.com/base/card-api' as RealmResourceIdentifier,
            name: 'CardDef',
          },
          kind: 'linksToMany',
          value: [],
          resolvedConfiguration: null,
          presentation: {},
          writable: false,
        },
      ],
      presentation: settlePresentation,
      onSettle: (signal) => {
        abortedSignal = signal;
        // Never resolves on its own; only settling via abort proves dispose
        // tore this watch down instead of leaving it to resolve later.
        return new Promise(() => undefined);
      },
    };

    let request: BoxelExecutionRequest = {
      principal: 'user:one',
      surfaceId: 'surface:one',
      trusted: false,
      format: 'isolated',
      moduleIdentifier: 'https://example.test/place',
      source: 'capsule',
      resource: settleResource,
      document: settleDocument,
      purpose: 'host-display',
      hostProjection: projection,
    };

    await session.update(request);
    assert.ok(abortedSignal, 'the settle watch started');
    assert.false(
      abortedSignal?.aborted,
      'the watch is not aborted while the session is still open',
    );
    await session.destroy();
    assert.true(
      abortedSignal?.aborted,
      'destroying the session aborts its in-flight settle watch (bounded observer lifetime)',
    );
  });
});
