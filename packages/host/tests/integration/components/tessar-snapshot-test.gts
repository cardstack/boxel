import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  rri,
  meta,
  isSingleCardDocument,
  parseRenderRouteOptions,
  serializeRenderRouteOptions,
} from '@cardstack/runtime-common';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
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

  test('first sync after session reset reconciles Tessar readers exactly once', function (assert) {
    let messages = getService('message-service');
    messages.resetState();
    let transitions: boolean[] = [];
    let unsubscribe = messages.subscribeTessarConnection((connected) =>
      transitions.push(connected),
    );
    try {
      messages.tessarConnectionChanged(true);
      assert.deepEqual(
        transitions,
        [true],
        'initial sync closes the subscription gap',
      );
      messages.tessarConnectionChanged(true);
      assert.deepEqual(
        transitions,
        [true],
        'routine sync does not repeatedly reload clean views',
      );
      messages.tessarConnectionChanged(false);
      messages.tessarConnectionChanged(true);
      assert.deepEqual(
        transitions,
        [true, false, true],
        'a later reconnect reconciles again',
      );
    } finally {
      unsubscribe();
    }
  });

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
    Object.assign(doc.data.meta, {
      generation: 2,
      tessar: {
        version: 1,
        state: 'ready',
        inputGeneration: 1,
        publishedGeneration: 2,
        definitionRevision: 'tessar-test',
        computedFields: ['count', 'empty'],
        queryFields: ['inputs'],
        watches: [],
      },
    });
    await api.updateFromSerialized(summary, doc, store);
    assert.strictEqual(
      summary.count,
      7,
      'an indexed response activates snapshot consumption',
    );
    assert.strictEqual(calls, 0);
    assert.strictEqual(searches, 0);
    assert.strictEqual(summary.tessarState, 'ready');
    api.markTessarPending(summary);
    assert.strictEqual(
      summary.tessarState,
      'pending',
      'source changes expose pending state without expanding inputs',
    );
    assert.strictEqual(searches, 0);
    await api.updateFromSerialized(summary, doc, store);
    assert.strictEqual(
      summary.tessarState,
      'ready',
      'revalidation clears pending state',
    );
    let older = structuredClone(doc);
    let newer = structuredClone(doc);
    newer.data.attributes.count = 11;
    Object.assign(newer.data.meta, {
      generation: 3,
      tessar: {
        ...(newer.data.meta as any).tessar,
        inputGeneration: 2,
        publishedGeneration: 3,
      },
    });
    await Promise.all([
      api.updateFromSerialized(summary, newer, store),
      api.updateFromSerialized(summary, older, store),
    ]);
    assert.strictEqual(
      summary.count,
      11,
      'overlapping refreshes cannot move output backwards',
    );
    assert.strictEqual((summary as any)[meta].tessar.publishedGeneration, 3);
    await api.updateFromSerialized(summary, older, store);
    assert.strictEqual(
      summary.count,
      11,
      'a delayed older response is ignored',
    );
    Object.assign(doc.data.meta, structuredClone(newer.data.meta));
    (doc.data.meta as any).tessar.state = 'pending';
    await assert.rejects(
      api.updateFromSerialized(summary, doc, store),
      /pending or has invalid provenance/,
    );
    delete (doc.data.meta as any).tessar;
    delete (doc.data.meta as any).generation;
    assert.strictEqual(calls, 0);
    doc.data.relationships.inputs.meta.total = 2;
    await assert.rejects(
      api.updateFromSerialized(summary, doc, store, opts),
      /missing, partial or errored/,
      'partial membership cannot be accepted as a complete materialization',
    );
  });

  test('publication registers empty queries and refuses incomplete membership', async function (assert) {
    class TessarInput extends CardDef {
      @field name = contains(StringField);
    }
    class TessarSummary extends CardDef {
      static tessarMaterialized = true;
      @field name = contains(StringField);
      @field inputs = linksToMany(TessarInput, {
        query: { filter: { eq: { name: '$this.name' } } },
      });
      @field count = contains(NumberField, {
        computeVia: function (this: TessarSummary) {
          return this.inputs.length;
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
    let summary = new TessarSummary({ name: 'Tessar' });
    summary.id = rri(`${testRealmURL}summary`);
    (summary as any)[meta] = {
      adoptsFrom: {
        module: rri(`${testRealmURL}tessar`),
        name: 'TessarSummary',
      },
      realmURL: testRealmURL,
    };
    let store = api.getStore(summary);
    let result = {
      instances: [],
      instancesByRealm: [],
      isLoading: false,
      meta: { page: { total: 0 } },
      totalMatchCount: 0,
      isPartial: false,
    };
    store.getSearchResource = () => result;
    await api.updateFromSerialized(
      summary,
      {
        data: {
          id: summary.id,
          type: 'card',
          attributes: { name: 'Tessar' },
          meta: {
            adoptsFrom: {
              module: rri(`${testRealmURL}tessar`),
              name: 'TessarSummary',
            },
            realmURL: testRealmURL,
          },
        },
      },
      store,
    );
    await api.prepareTessarQueries(summary);
    let doc = api.serializeCard(summary, {
      includeComputeds: true,
      omitQueryFields: true,
    });
    let discovery = api.tessarIndexManifest(summary, doc);
    assert.strictEqual(
      discovery?.state,
      'pending',
      'a discovery render cannot claim readiness',
    );
    assert.strictEqual(
      discovery?.watches.length,
      1,
      'the empty query is registered',
    );
    assert.false(
      JSON.stringify(discovery?.watches).includes('$this'),
      'watch parameters are resolved',
    );
    assert.true(JSON.stringify(discovery?.watches).includes('Tessar'));
    let snapshot = api.tessarIndexManifest(summary, doc, 7);
    assert.true(
      isSingleCardDocument(doc),
      'the published wire shape passes the same validator used by the host store',
    );
    let membership = doc.data.relationships?.inputs;
    if (Array.isArray(membership))
      throw new Error('Expected a Tessar membership umbrella');
    assert.deepEqual(
      membership?.data,
      [],
      'known empty membership is serialized explicitly',
    );
    assert.strictEqual(membership?.meta?.total, 0);
    assert.strictEqual(snapshot?.inputGeneration, 7);
    assert.true(snapshot?.computedFields.includes('count'));
    assert.notOk(doc.included, 'the input graph is never serialized');
    result.totalMatchCount = 2;
    result.isPartial = true;
    assert.throws(
      () => api.tessarIndexManifest(summary, doc, 7),
      /unresolved, partial or errored/,
    );
  });

  test('Tessar HTML explicitly consumes a published snapshot while index discovery computes', async function (assert) {
    let calls = 0;
    class TessarSummary extends CardDef {
      static tessarMaterialized = true;
      @field total = contains(NumberField, {
        computeVia: function () {
          calls++;
          return 999;
        },
      });
    }
    await setupIntegrationTestRealm({
      skipBootIndex: true,
      mockMatrixUtils,
      contents: { 'tessar.gts': { TessarSummary } },
    });
    let doc = {
      data: {
        id: `${testRealmURL}TessarSummary/html`,
        type: 'card' as const,
        attributes: { total: 3 },
        meta: {
          adoptsFrom: {
            module: rri(`${testRealmURL}tessar`),
            name: 'TessarSummary',
          },
          tessar: {
            version: 1 as const,
            state: 'ready' as const,
            inputGeneration: 1,
            publishedGeneration: 2,
            definitionRevision: 'tessar-html-test',
            computedFields: ['total'],
            queryFields: [],
            watches: [],
          },
        },
      },
    };
    let globals = globalThis as any;
    let previous = globals.__boxelRenderContext;
    globals.__boxelRenderContext = true;
    try {
      let options = parseRenderRouteOptions(
        serializeRenderRouteOptions({
          cardRender: true,
          tessarUseSnapshot: true,
        }),
      );
      assert.true(options.tessarUseSnapshot);
      let rendered = await getService('render-store').add<TessarSummary>(doc, {
        doNotPersist: true,
        relativeTo: testRRI(''),
        tessarUseSnapshot: options.tessarUseSnapshot,
      });
      assert.strictEqual(rendered.total, 3, 'HTML uses the supplied output');
      assert.strictEqual(calls, 0, 'HTML never ran the computed getter');
      doc.data.id = `${testRealmURL}TessarSummary/index`;
      let indexed = await getService('render-store').add<TessarSummary>(doc, {
        doNotPersist: true,
        relativeTo: testRRI(''),
      });
      assert.strictEqual(
        indexed.total,
        999,
        'discovery keeps its computation path',
      );
      assert.ok(calls > 0);
      doc.data.id = `${testRealmURL}TessarSummary/pending`;
      await assert.rejects(
        getService('render-store').add<TessarSummary>(
          {
            data: {
              ...doc.data,
              meta: {
                ...doc.data.meta,
                tessar: { ...doc.data.meta.tessar, state: 'pending' },
              },
            },
          },
          {
            doNotPersist: true,
            relativeTo: testRRI(''),
            tessarUseSnapshot: true,
          },
        ),
        /pending or has invalid provenance/,
        'HTML cannot accept pending output',
      );
    } finally {
      globals.__boxelRenderContext = previous;
    }
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
