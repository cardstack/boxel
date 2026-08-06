import 'ses';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type {
  LooseCardResource,
  LooseSingleCardDocument,
  RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import {
  projectBoxelExecutionDocument,
  projectHostBoxelSemantics,
} from '@cardstack/host/lib/boxel-projection';
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
      assert.deepEqual(
        fieldsByName.get('partner')?.value,
        {
          $boxel: {
            id: partnerId,
            type: { module: showModule, name: 'Show' },
          },
        },
        'linked values cross as BoxelValueReference references, never expanded graphs',
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
});
