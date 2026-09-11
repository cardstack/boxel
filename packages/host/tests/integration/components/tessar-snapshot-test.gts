import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  setupBaseRealm,
  CardDef,
  FieldDef,
  contains,
  containsMany,
  linksToMany,
  field,
  StringField,
  NumberField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Tessar snapshot', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  test('supplied outputs and membership do not compute, search or inflate included inputs', async function (assert) {
    let calls = 0;
    class TessarInput extends CardDef {
      @field name = contains(StringField);
    }
    class TessarSummary extends CardDef {
      @field inputs = linksToMany(TessarInput, {
        query: { filter: { eq: { name: 'Tessar' } } },
      });
      @field count = contains(NumberField, {
        computeVia: function () {
          calls++;
          return 999;
        },
      });
      @field empty = containsMany(StringField, {
        computeVia: function () {
          calls++;
          return ['live'];
        },
      });
    }
    await setupIntegrationTestRealm({
      skipBootIndex: true,
      mockMatrixUtils,
      contents: { 'tessar.gts': { TessarInput, TessarSummary } },
    });
    let api: typeof import('@cardstack/base/card-api') = await getService(
      'loader-service',
    ).loader.import('@cardstack/base/card-api');
    let summary = new TessarSummary();
    let store = api.getStore(summary);
    let searches = 0;
    store.resolvesQueryFieldsEagerly = true;
    store.getSearchResource = () => {
      searches++;
      throw new Error('Tessar snapshot must not search');
    };
    let inputId = rri(`${testRealmURL}TessarInput/1`);
    let doc = {
      data: {
        id: `${testRealmURL}TessarSummary/1`,
        type: 'card' as const,
        attributes: { count: 0, empty: [] },
        relationships: {
          inputs: { data: [{ type: 'card', id: inputId }], meta: { total: 1 } },
        },
        meta: {
          adoptsFrom: {
            module: rri(`${testRealmURL}tessar`),
            name: 'TessarSummary',
          },
        },
      },
      included: [
        {
          id: inputId,
          type: 'card' as const,
          attributes: { name: 'Tessar' },
          meta: {
            adoptsFrom: {
              module: rri(`${testRealmURL}tessar`),
              name: 'TessarInput',
            },
          },
        },
      ],
    };
    let opts = {
      tessarSnapshot: {
        computedFields: ['count', 'empty'],
        queryFields: ['inputs'],
      },
    };
    await api.updateFromSerialized(summary, doc, store, opts);
    assert.strictEqual(summary.count, 0);
    assert.deepEqual([...summary.empty], []);
    assert.strictEqual(calls, 0, 'no computed getter was invoked');
    assert.strictEqual(searches, 0, 'no query search was started');
    assert.strictEqual(
      store.getCard(inputId),
      undefined,
      'included input stayed uninflated',
    );
    let membership = api.getRelationshipMembershipState(summary, 'inputs');
    assert.strictEqual(membership.totalMatchCount, 1);
    assert.strictEqual(membership.membership?.length, 1);
    assert.false(membership.isPartial);
    doc.data.attributes.count = 7;
    await api.updateFromSerialized(summary, doc, store, opts);
    assert.strictEqual(
      summary.count,
      7,
      'new owner snapshot replaces old output',
    );
    assert.strictEqual(calls, 0);
    doc.data.relationships.inputs.meta.total = 2;
    await assert.rejects(
      api.updateFromSerialized(summary, doc, store, opts),
      /missing, partial or errored/,
      'partial membership cannot be accepted as a complete materialization',
    );
  });

  test('nested values share edit invalidation and legacy documents keep computing', async function (assert) {
    let calls = 0;
    class TessarDetails extends FieldDef {
      @field label = contains(StringField);
      @field total = contains(NumberField, {
        computeVia: function () {
          calls++;
          return 12;
        },
      });
    }
    class TessarSummary extends CardDef {
      @field label = contains(StringField);
      @field details = contains(TessarDetails);
      @field rows = containsMany(TessarDetails);
      @field total = contains(NumberField, {
        computeVia: function () {
          calls++;
          return 42;
        },
      });
    }
    await setupIntegrationTestRealm({
      skipBootIndex: true,
      mockMatrixUtils,
      contents: { 'tessar.gts': { TessarSummary, TessarDetails } },
    });
    let api: typeof import('@cardstack/base/card-api') = await getService(
      'loader-service',
    ).loader.import('@cardstack/base/card-api');
    let summary = new TessarSummary();
    let doc = {
      data: {
        type: 'card' as const,
        attributes: {
          label: 'Tessar',
          total: 0,
          details: { label: 'Nested', total: 3 },
          rows: [{ label: 'Row', total: 5 }],
        },
        meta: {
          adoptsFrom: {
            module: rri(`${testRealmURL}tessar`),
            name: 'TessarSummary',
          },
        },
      },
    };
    let opts = {
      tessarSnapshot: {
        computedFields: ['total', 'details.total', 'rows.*.total'],
        queryFields: [],
      },
    };
    await api.updateFromSerialized(summary, doc, api.getStore(summary), opts);
    assert.strictEqual(summary.total, 0);
    assert.strictEqual(summary.details.total, 3);
    assert.strictEqual(summary.rows[0].total, 5);
    assert.strictEqual(calls, 0);
    summary.details.label = 'Edited';
    assert.strictEqual(
      summary.total,
      42,
      'contained edit clears the owner overlay',
    );
    assert.strictEqual(
      summary.rows[0].total,
      12,
      'sibling overlay also leaves snapshot mode',
    );
    await api.updateFromSerialized(summary, doc);
    assert.strictEqual(
      summary.total,
      42,
      'ordinary deserialization never trusts supplied computeds',
    );
    assert.strictEqual(summary.details.total, 12);
  });
});
