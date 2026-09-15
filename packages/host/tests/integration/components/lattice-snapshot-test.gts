import { settled, type RenderingTestContext } from '@ember/test-helpers';

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
  Component,
  FieldDef,
  contains,
  containsMany,
  linksToMany,
  linksTo,
  getDataBucket,
  field,
  StringField,
  NumberField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Lattice snapshot', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  test('authored publication metadata cannot suppress ordinary computation', async function (assert) {
    class Summary extends CardDef {
      @field value = contains(NumberField);
      @field total = contains(NumberField, {
        computeVia: function (this: Summary) {
          return this.value * 2;
        },
      });
    }
    await setupIntegrationTestRealm({
      skipBootIndex: true,
      mockMatrixUtils,
      contents: { 'ordinary-summary.gts': { Summary } },
    });
    let api = await getService('card-service').getAPI();
    let doc = {
      data: {
        id: rri(`${testRealmURL}Summary/authored`),
        type: 'card' as const,
        attributes: { value: 4, total: 99 },
        meta: {
          adoptsFrom: {
            module: rri(`${testRealmURL}ordinary-summary`),
            name: 'Summary',
          },
          publication: {
            version: 1 as const,
            state: 'ready' as const,
            validatedThrough: 1,
            outputRevision: 2,
            definitionRevision: 'authored-not-admitted',
            computedFields: ['total'],
            queryFields: [],
            watches: [],
          },
        },
      },
    };
    let ordinary = new Summary();
    await api.updateFromSerialized(ordinary, doc);
    assert.strictEqual(ordinary.total, 8, 'raw metadata is not read authority');
    assert.false(api.hasLatticeSnapshot(ordinary));
    let authored = await getService('store').add<Summary>(doc, {
      doNotPersist: true,
      relativeTo: testRRI(''),
    });
    assert.strictEqual(
      authored.total,
      8,
      'Store add is an authoring operation',
    );
    await getService('store').patch(
      authored.id,
      { attributes: { value: 5 } },
      { doNotPersist: true },
    );
    assert.strictEqual(
      authored.total,
      10,
      'patch recomputes from local values',
    );
    assert.false(api.hasLatticeSnapshot(authored));
  });

  test('display reuse changes freshness without replacing values or overwriting a local edit', async function (assert) {
    let calls = 0;
    class Summary extends CardDef {
      @field title = contains(StringField);
      @field rows = containsMany(StringField, {
        computeVia: function () {
          calls++;
          return ['computed locally'];
        },
      });
    }
    await setupIntegrationTestRealm({
      skipBootIndex: true,
      mockMatrixUtils,
      contents: { 'lattice-display.gts': { Summary } },
    });
    let api: typeof import('@cardstack/base/card-api') = await getService(
      'loader-service',
    ).loader.import('@cardstack/base/card-api');
    let summary = new Summary();
    let store = api.getStore(summary);
    let token = 'lattice-display-v1:' + 'a'.repeat(64);
    let doc = {
      data: {
        id: rri(`${testRealmURL}Summary/display`),
        type: 'card' as const,
        attributes: { title: 'Published', rows: ['one', 'two'] },
        meta: {
          adoptsFrom: {
            module: rri(`${testRealmURL}lattice-display`),
            name: 'Summary',
          },
          generation: 2,
          publication: {
            have: token,
            version: 1 as const,
            state: 'ready' as 'ready' | 'pending',
            validatedThrough: 1,
            outputRevision: 2,
            definitionRevision: 'reviewed',
            computedFields: ['rows'],
            queryFields: [],
            watches: [],
            hasPublishedSnapshot: true,
          },
        },
      },
    };
    await api.updateFromSerialized(summary, doc, store, {
      latticePublication: 'display',
    });
    let rows = summary.rows;
    assert.strictEqual(api.getLatticeDisplayToken(summary), token);
    let reply = {
      lattice: {
        version: 1,
        reuse: true,
        token,
        id: doc.data.id,
        state: 'pending' as 'ready' | 'pending',
      },
    };
    assert.true(api.applyLatticeDisplayReuse(summary, reply));
    assert.strictEqual(summary.publicationState, 'pending');
    assert.strictEqual(
      summary.rows,
      rows,
      'contained array identity stays mounted',
    );
    reply.lattice.state = 'ready';
    assert.true(api.applyLatticeDisplayReuse(summary, reply));
    assert.strictEqual(summary.publicationState, 'ready');
    assert.strictEqual(summary.rows, rows);
    assert.strictEqual(calls, 0, 'reuse never recomputes');
    let wrong = structuredClone(reply);
    wrong.lattice.id = rri(`${testRealmURL}Summary/other`);
    assert.false(
      api.applyLatticeDisplayReuse(summary, wrong),
      'identity must match',
    );
    wrong = structuredClone(reply);
    wrong.lattice.token = 'lattice-display-v1:' + 'b'.repeat(64);
    assert.false(
      api.applyLatticeDisplayReuse(summary, wrong),
      'version must match',
    );
    summary.title = 'Unsaved local draft';
    assert.strictEqual(
      api.getLatticeDisplayToken(summary),
      undefined,
      'edited scope advertises no server body',
    );
    assert.false(api.applyLatticeDisplayReuse(summary, reply));
    assert.strictEqual(summary.title, 'Unsaved local draft');
    assert.strictEqual(summary.publicationState, 'live');
  });

  test('equal output accepts newer validation without regressing freshness or remounting', async function (this: RenderingTestContext, assert) {
    let computations = 0;
    class Summary extends CardDef {
      @field count = contains(NumberField, {
        computeVia: function () {
          computations++;
          return 999;
        },
      });
      static isolated = class extends Component<typeof Summary> {
        <template>
          <output data-test-revalidated>{{@model.count}}</output>
        </template>
      };
    }
    await setupIntegrationTestRealm({
      skipBootIndex: true,
      mockMatrixUtils,
      contents: { 'revalidated.gts': { Summary } },
    });
    let api = await getService('card-service').getAPI();
    let summary = new Summary();
    let store = api.getStore(summary);
    store.loadCardDocument = async () => {
      throw new Error('Revalidation must not fetch a computation graph');
    };
    let doc = {
      data: {
        id: rri(`${testRealmURL}Summary/revalidated`),
        type: 'card' as const,
        attributes: { count: 7 },
        meta: {
          generation: 2,
          adoptsFrom: {
            module: rri(`${testRealmURL}revalidated`),
            name: 'Summary',
          },
          publication: {
            version: 1 as const,
            state: 'ready' as 'ready' | 'pending',
            outputRevision: 2,
            validatedThrough: 1,
            definitionRevision: 'same-code',
            computedFields: ['count'],
            queryFields: [],
            watches: [],
          },
        },
      },
    };
    let publication = { latticePublication: 'display' as const };
    await api.updateFromSerialized(summary, doc, store, publication);
    await renderCard(getService('loader-service').loader, summary, 'isolated');
    let element = this.element.querySelector('[data-test-revalidated]');
    let older = structuredClone(doc);
    api.markLatticePending(summary);
    assert.strictEqual(summary.publicationState, 'pending');
    doc.data.meta.publication.validatedThrough = 5;
    assert.strictEqual(
      await api.updateFromSerialized(summary, doc, store, publication),
      summary,
    );
    await settled();
    assert.strictEqual(summary.publicationState, 'ready');
    assert.strictEqual((summary as any)[meta].publication.outputRevision, 2);
    assert.strictEqual((summary as any)[meta].publication.validatedThrough, 5);
    assert.dom('[data-test-revalidated]').hasText('7');
    assert.strictEqual(
      this.element.querySelector('[data-test-revalidated]'),
      element,
    );
    older.data.meta.publication.state = 'pending';
    await api.updateFromSerialized(summary, older, store, publication);
    assert.strictEqual(
      summary.publicationState,
      'ready',
      'late invalidation cannot undo a newer validation',
    );
    assert.strictEqual((summary as any)[meta].publication.validatedThrough, 5);
    api.markLatticePending(summary);
    older.data.meta.publication.state = 'ready';
    await api.updateFromSerialized(summary, older, store, publication);
    assert.strictEqual(
      summary.publicationState,
      'pending',
      'older validation cannot clear pending',
    );
    assert.strictEqual(computations, 0);
  });

  test('Lattice serializes one card identity and its contained values without expanding neighboring cards', async function (assert) {
    let unusedComputedCalls = 0;
    class Input extends CardDef {
      @field value = contains(NumberField);
      @field unused = contains(NumberField, {
        computeVia: function () {
          unusedComputedCalls++;
          return 999;
        },
      });
    }
    class Detail extends FieldDef {
      @field label = contains(StringField);
      @field input = linksTo(Input);
    }
    class Summary extends CardDef {
      @field input = linksTo(Input);
      @field inputs = linksToMany(Input);
      @field detail = contains(Detail);
      @field details = containsMany(Detail);
      @field total = contains(NumberField, {
        computeVia: function (this: Summary) {
          return (this.input?.value ?? 0) + 1;
        },
      });
    }
    let loader = getService('loader-service').loader;
    loader.shimModule(`${testRealmURL}lattice-serialization`, {
      Input,
      Detail,
      Summary,
    });
    let api = await loader.import<typeof import('@cardstack/base/card-api')>(
      '@cardstack/base/card-api',
    );
    let input = new Input({ value: 4 });
    api.setCardAsSavedForTest(input, `${testRealmURL}Input/one`);
    let summary = new Summary({
      input,
      inputs: [input, input],
      detail: new Detail({ label: 'single', input }),
      details: [new Detail({ label: 'plural', input })],
    });
    api.setCardAsSavedForTest(summary, `${testRealmURL}Summary/one`);
    let serialized = api.serializeCard(summary, {
      includeComputeds: true,
      includeLinkedResources: false,
    });
    assert.strictEqual(serialized.included, undefined);
    assert.strictEqual(
      unusedComputedCalls,
      0,
      'unused neighboring computeds never run',
    );
    assert.strictEqual(
      serialized.data.attributes?.total,
      5,
      'an owner computed still consumes its linked input',
    );
    assert.deepEqual(serialized.data.attributes?.detail, { label: 'single' });
    assert.deepEqual(serialized.data.attributes?.details, [
      { label: 'plural' },
    ]);
    for (let path of [
      'input',
      'inputs.0',
      'inputs.1',
      'detail.input',
      'details.0.input',
    ]) {
      assert.deepEqual(
        serialized.data.relationships?.[path],
        {
          links: { self: '../Input/one' },
          data: { type: 'card', id: `${testRealmURL}Input/one` },
        },
        path,
      );
    }
    let expanded = api.serializeCard(summary, { includeComputeds: true });
    assert.ok(
      unusedComputedCalls > 0,
      'ordinary serialization retains linked computed evaluation',
    );
    assert.ok(expanded.included?.some((resource) => resource.id === input.id));
    assert.deepEqual(
      serialized.data,
      expanded.data,
      'root resource is unchanged',
    );
  });

  test('Lattice identity-only serialization preserves absent and broken links and rejects unsaved linked values', async function (assert) {
    class Input extends CardDef {}
    class Summary extends CardDef {
      @field input = linksTo(Input);
      @field inputs = linksToMany(Input);
    }
    let loader = getService('loader-service').loader;
    loader.shimModule(`${testRealmURL}lattice-serialization-states`, {
      Input,
      Summary,
    });
    let api = await loader.import<typeof import('@cardstack/base/card-api')>(
      '@cardstack/base/card-api',
    );
    let summary = new Summary({ input: null, inputs: [] });
    api.setCardAsSavedForTest(summary, `${testRealmURL}Summary/states`);
    let opts = { includeLinkedResources: false, includeUnrenderedFields: true };
    let empty = api.serializeCard(summary, opts);
    assert.deepEqual(empty.data.relationships?.input, {
      links: { self: null },
    });
    assert.deepEqual(empty.data.relationships?.inputs, {
      links: { self: null },
    });
    let broken = {
      type: 'link-not-found' as const,
      reference: `${testRealmURL}Input/missing`,
      errorDoc: { status: 404, message: 'missing', additionalErrors: null },
    };
    getDataBucket(summary).set('input', broken);
    getDataBucket(summary).set('inputs', [broken, null]);
    let serialized = api.serializeCard(summary, opts);
    let expanded = api.serializeCard(summary, {
      includeUnrenderedFields: true,
    });
    assert.deepEqual(
      serialized.data,
      expanded.data,
      'broken references and null slots keep their wire representation',
    );
    assert.strictEqual(serialized.included, undefined);
    getDataBucket(summary).set('input', new Input());
    assert.throws(
      () => api.serializeCard(summary, opts),
      /linksTo field 'input'.*unsaved card/,
    );
    getDataBucket(summary).set('input', null);
    getDataBucket(summary).set('inputs', [new Input()]);
    assert.throws(
      () => api.serializeCard(summary, opts),
      /linksToMany field 'inputs'.*unsaved card/,
    );
    assert.ok(
      api.serializeCard(summary, {}).included?.length,
      'ordinary serialization can still carry unsaved linked cards',
    );
  });

  test('failed nested inputs cannot become a ready-looking Lattice aggregate', function (assert) {
    class Input extends CardDef {
      @field name = contains(StringField);
    }
    class Summary extends CardDef {
      @field input = linksTo(Input);
      @field inputs = linksToMany(Input);
      @field count = contains(NumberField, {
        computeVia: function (this: Summary) {
          return this.inputs.filter(Boolean).length;
        },
      });
    }
    let summary = new Summary();
    let failure = {
      type: 'link-error' as const,
      reference: `${testRealmURL}Input/failed`,
      errorDoc: {
        status: 500,
        message: 'fetch failed',
        additionalErrors: null,
      },
    };
    getDataBucket(summary).set('input', failure);
    getDataBucket(summary).set('inputs', [failure]);
    let globals = globalThis as any;
    let renderContext = globals.__boxelRenderContext;
    let inputSnapshot = globals.__latticeInputSnapshot;
    try {
      globals.__boxelRenderContext = false;
      assert.strictEqual(
        summary.input,
        undefined,
        'ordinary broken links remain absent',
      );
      assert.strictEqual(
        summary.inputs.length,
        1,
        'ordinary raw arrays do not add strict publication assertions',
      );
      globals.__boxelRenderContext = true;
      globals.__latticeInputSnapshot = {
        realmURL: testRealmURL,
        generation: 1,
      };
      assert.throws(
        () => summary.input,
        /Lattice cannot materialize failed relationship input/,
      );
      assert.throws(
        () => summary.count,
        /Lattice cannot materialize failed relationship input/,
      );
      for (let errorDoc of [
        { ...failure.errorDoc, status: 503, message: 'upstream not found' },
        { ...failure.errorDoc, status: 404, awaitingIndex: true as const },
      ]) {
        getDataBucket(summary).set('input', {
          ...failure,
          type: 'link-not-found',
          errorDoc,
        });
        assert.throws(
          () => summary.input,
          /Lattice cannot materialize failed relationship input/,
          'a missing-slot discriminator cannot override a failed or pending input',
        );
      }
      getDataBucket(summary).set('input', {
        ...failure,
        type: 'link-not-found',
        errorDoc: { ...failure.errorDoc, status: 404 },
      });
      assert.strictEqual(
        summary.input,
        undefined,
        'a confirmed deletion remains absent',
      );
    } finally {
      globals.__boxelRenderContext = renderContext;
      globals.__latticeInputSnapshot = inputSnapshot;
    }
    getDataBucket(summary).set('input', failure);
    assert.strictEqual(
      summary.input,
      undefined,
      'ordinary interactive broken-link behavior is preserved',
    );
  });

  test('first sync after session reset reconciles Lattice readers exactly once', function (assert) {
    let messages = getService('message-service');
    messages.resetState();
    let transitions: boolean[] = [];
    let unsubscribe = messages.subscribeLatticeConnection((connected) =>
      transitions.push(connected),
    );
    try {
      messages.latticeConnectionChanged(true);
      assert.deepEqual(
        transitions,
        [true],
        'initial sync closes the subscription gap',
      );
      messages.latticeConnectionChanged(true);
      assert.deepEqual(
        transitions,
        [true],
        'routine sync does not repeatedly reload clean views',
      );
      messages.latticeConnectionChanged(false);
      messages.latticeConnectionChanged(true);
      assert.deepEqual(
        transitions,
        [true, false, true],
        'a later reconnect reconciles again',
      );
    } finally {
      unsubscribe();
    }
  });

  test('supplied outputs render and update without computing, searching or fetching their input graph', async function (this: RenderingTestContext, assert) {
    let calls = 0;
    class LatticeInput extends CardDef {
      @field name = contains(StringField);
    }
    class LatticeSummary extends CardDef {
      @field inputs = linksToMany(LatticeInput, {
        query: { filter: { eq: { name: 'Lattice' } } },
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

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <output data-test-published-count>{{@model.count}}</output>
          <ul data-test-published-rows>
            {{#each @model.empty as |row|}}
              <li>{{row}}</li>
            {{/each}}
          </ul>
        </template>
      };
    }
    class LatticeWorkspace extends CardDef {
      @field entryPoints = linksToMany(LatticeSummary);
    }
    await setupIntegrationTestRealm({
      skipBootIndex: true,
      mockMatrixUtils,
      contents: {
        'lattice.gts': { LatticeInput, LatticeSummary, LatticeWorkspace },
      },
    });
    let api: typeof import('@cardstack/base/card-api') = await getService(
      'loader-service',
    ).loader.import('@cardstack/base/card-api');
    let summary = new LatticeSummary();
    let store = api.getStore(summary);
    let searches = 0;
    store.resolvesQueryFieldsEagerly = true;
    store.getSearchResource = () => {
      searches++;
      throw new Error('Lattice snapshot must not search');
    };
    let inputFetches = 0;
    store.loadCardDocument = async () => {
      inputFetches++;
      throw new Error('A supplied materialized result must not fetch inputs');
    };
    let inputId = rri(`${testRealmURL}LatticeInput/1`);
    let doc = {
      data: {
        id: rri(`${testRealmURL}LatticeSummary/1`),
        type: 'card' as const,
        attributes: { count: 0, empty: [] as string[] },
        relationships: {
          inputs: {
            data: [{ type: 'card' as const, id: inputId }],
            meta: { total: 1 },
          },
        },
        meta: {
          adoptsFrom: {
            module: rri(`${testRealmURL}lattice`),
            name: 'LatticeSummary',
          },
        },
      },
      included: [
        {
          id: inputId,
          type: 'card' as const,
          attributes: { name: 'Lattice' },
          meta: {
            adoptsFrom: {
              module: rri(`${testRealmURL}lattice`),
              name: 'LatticeInput',
            },
          },
        },
      ],
    };
    let publication = { latticePublication: 'display' as const };
    let opts = {
      latticeSnapshot: {
        computedFields: ['count', 'empty'],
        queryFields: ['inputs'],
      },
    };
    await api.updateFromSerialized(summary, doc, store, opts);
    await renderCard(getService('loader-service').loader, summary, 'isolated');
    let displayedCount = this.element.querySelector(
      '[data-test-published-count]',
    );
    assert.dom('[data-test-published-count]').hasText('0');
    assert.dom('[data-test-published-rows] li').doesNotExist();
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
    await settled();
    assert.dom('[data-test-published-count]').hasText('7');
    assert.strictEqual(
      this.element.querySelector('[data-test-published-count]'),
      displayedCount,
      'a newer publication updates the mounted presentation',
    );
    assert.strictEqual(
      summary.count,
      7,
      'new owner snapshot replaces old output',
    );
    Object.assign(doc.data.meta, {
      generation: 2,
      publication: {
        version: 1,
        state: 'ready',
        validatedThrough: 1,
        outputRevision: 2,
        definitionRevision: 'lattice-test',
        computedFields: ['count', 'empty'],
        queryFields: ['inputs'],
        watches: [],
      },
    });
    await api.updateFromSerialized(summary, doc, store, publication);
    assert.strictEqual(
      summary.count,
      7,
      'an indexed response activates snapshot consumption',
    );
    assert.strictEqual(calls, 0);
    assert.strictEqual(searches, 0);
    assert.strictEqual(summary.publicationState, 'ready');
    api.markLatticePending(summary);
    assert.strictEqual(
      summary.publicationState,
      'pending',
      'source changes expose pending state without expanding inputs',
    );
    assert.strictEqual(searches, 0);
    await api.updateFromSerialized(summary, doc, store, publication);
    assert.strictEqual(
      summary.publicationState,
      'ready',
      'revalidation clears pending state',
    );
    let older = structuredClone(doc);
    let newer = structuredClone(doc);
    newer.data.attributes.count = 11;
    newer.data.attributes.empty = ['published'];
    Object.assign(newer.data.meta, {
      generation: 3,
      publication: {
        ...(newer.data.meta as any).publication,
        validatedThrough: 2,
        outputRevision: 3,
      },
    });
    await Promise.all([
      api.updateFromSerialized(summary, newer, store, publication),
      api.updateFromSerialized(summary, older, store, publication),
    ]);
    await settled();
    assert.dom('[data-test-published-count]').hasText('11');
    assert.dom('[data-test-published-rows] li').hasText('published');
    assert.strictEqual(
      summary.count,
      11,
      'overlapping refreshes cannot move output backwards',
    );
    assert.strictEqual((summary as any)[meta].publication.outputRevision, 3);
    await api.updateFromSerialized(summary, older, store, publication);
    assert.strictEqual(
      summary.count,
      11,
      'a delayed older response is ignored',
    );
    Object.assign(doc.data.meta, structuredClone(newer.data.meta));
    (doc.data.meta as any).publication.state = 'pending';
    let pendingResult = await api.updateFromSerialized(
      summary,
      doc,
      store,
      publication,
    );
    assert.strictEqual(
      pendingResult,
      summary,
      'pending preserves card identity',
    );
    assert.strictEqual(
      summary.publicationState,
      'pending',
      'a pending reader remains renderable',
    );
    assert.strictEqual(
      summary.count,
      11,
      'pending retains the last published output on the existing store card',
    );
    assert.deepEqual(
      [...summary.empty],
      ['published'],
      'pending preserves displayed rows until their replacement arrives',
    );
    assert.strictEqual(calls, 0, 'pending does not compute');
    assert.strictEqual(searches, 0, 'pending does not fetch inputs');
    await settled();
    assert.dom('[data-test-published-count]').hasText('11');
    assert.strictEqual(
      this.element.querySelector('[data-test-published-count]'),
      displayedCount,
      'pending keeps the existing presentation mounted',
    );
    assert.strictEqual(
      inputFetches,
      0,
      'hydration and rendering never fetched the input graph',
    );
    let laterPending = structuredClone(doc);
    Object.assign(laterPending.data.meta, {
      generation: 4,
      publication: {
        ...(laterPending.data.meta as any).publication,
        validatedThrough: 3,
        outputRevision: 4,
      },
    });
    await api.updateFromSerialized(summary, laterPending, store, publication);
    await api.updateFromSerialized(summary, newer, store, publication);
    assert.strictEqual(
      summary.publicationState,
      'pending',
      'an older ready response cannot clear a newer invalidation',
    );
    assert.strictEqual(summary.count, 11, 'the displayed value remains intact');
    let pendingChild = structuredClone(doc.data);
    pendingChild.id = rri(`${testRealmURL}LatticeSummary/cold-pending`);
    let workspace = new LatticeWorkspace();
    await api.updateFromSerialized(
      workspace,
      {
        data: {
          id: `${testRealmURL}LatticeWorkspace/1`,
          type: 'card',
          meta: {
            adoptsFrom: {
              module: rri(`${testRealmURL}lattice`),
              name: 'LatticeWorkspace',
            },
          },
          relationships: {
            entryPoints: { data: [{ type: 'card', id: pendingChild.id }] },
          },
        },
        included: [pendingChild],
      },
      store,
      publication,
    );
    assert.strictEqual(
      workspace.entryPoints[0].publicationState,
      'pending',
      'a cold pending entry point does not crash its workspace',
    );
    assert.strictEqual(workspace.entryPoints[0].count, null);
    assert.strictEqual(calls, 0);
    assert.strictEqual(searches, 0);
    let publishedPending = structuredClone(doc);
    publishedPending.data.id = rri(
      `${testRealmURL}LatticeSummary/published-pending`,
    );
    (publishedPending.data.meta as any).publication.hasPublishedSnapshot = true;
    let coldReader = new LatticeSummary();
    await api.updateFromSerialized(
      coldReader,
      publishedPending,
      store,
      publication,
    );
    assert.strictEqual(
      coldReader.count,
      7,
      'a cold reader displays the completed server payload',
    );
    assert.strictEqual(
      coldReader.publicationState,
      'pending',
      'available does not claim fresh',
    );
    assert.strictEqual(calls, 0, 'a cold pending snapshot does not compute');
    assert.strictEqual(
      searches,
      0,
      'a cold pending snapshot does not expand query inputs',
    );
    publishedPending.data.attributes.count = 12;
    Object.assign(publishedPending.data.meta, {
      generation: 5,
      publication: {
        ...(publishedPending.data.meta as any).publication,
        validatedThrough: 4,
        outputRevision: 5,
      },
    });
    await api.updateFromSerialized(
      coldReader,
      publishedPending,
      store,
      publication,
    );
    assert.strictEqual(
      coldReader.count,
      12,
      'a newer completed payload updates the same pending card',
    );
    assert.strictEqual(coldReader.publicationState, 'pending');
    delete (doc.data.meta as any).publication;
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
    class LatticeInput extends CardDef {
      @field name = contains(StringField);
    }
    class LatticeSummary extends CardDef {
      static materialized = true;
      @field name = contains(StringField);
      @field inputs = linksToMany(LatticeInput, {
        query: { filter: { eq: { name: '$this.name' } } },
      });
      @field count = contains(NumberField, {
        computeVia: function (this: LatticeSummary) {
          return this.inputs.length;
        },
      });
    }
    await setupIntegrationTestRealm({
      skipBootIndex: true,
      mockMatrixUtils,
      contents: { 'lattice.gts': { LatticeInput, LatticeSummary } },
    });
    let api: typeof import('@cardstack/base/card-api') = await getService(
      'loader-service',
    ).loader.import('@cardstack/base/card-api');
    let summary = new LatticeSummary({ name: 'Lattice' });
    summary.id = rri(`${testRealmURL}summary`);
    (summary as any)[meta] = {
      adoptsFrom: {
        module: rri(`${testRealmURL}lattice`),
        name: 'LatticeSummary',
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
          attributes: { name: 'Lattice' },
          meta: {
            adoptsFrom: {
              module: rri(`${testRealmURL}lattice`),
              name: 'LatticeSummary',
            },
            realmURL: testRealmURL,
          },
        },
      },
      store,
    );
    await api.preparePublicationQueries(summary);
    let doc = api.serializeCard(summary, {
      includeComputeds: true,
      omitQueryFields: true,
    });
    let discovery = api.publicationManifest(summary, doc);
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
    assert.true(JSON.stringify(discovery?.watches).includes('Lattice'));
    let snapshot = api.publicationManifest(summary, doc, 7);
    assert.true(
      isSingleCardDocument(doc),
      'the published wire shape passes the same validator used by the host store',
    );
    let membership = doc.data.relationships?.inputs;
    if (Array.isArray(membership))
      throw new Error('Expected a Lattice membership umbrella');
    assert.deepEqual(
      membership?.data,
      [],
      'known empty membership is serialized explicitly',
    );
    assert.strictEqual(membership?.meta?.total, 0);
    assert.strictEqual(snapshot?.validatedThrough, 7);
    assert.true(snapshot?.computedFields.includes('count'));
    assert.notOk(doc.included, 'the input graph is never serialized');
    result.totalMatchCount = 2;
    result.isPartial = true;
    assert.throws(
      () => api.publicationManifest(summary, doc, 7),
      /unresolved, partial or errored/,
    );
  });

  test('Lattice HTML explicitly consumes a published snapshot while index discovery computes', async function (assert) {
    let calls = 0;
    class LatticeSummary extends CardDef {
      static materialized = true;
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
      contents: { 'lattice.gts': { LatticeSummary } },
    });
    let doc = {
      data: {
        id: `${testRealmURL}LatticeSummary/html`,
        type: 'card' as const,
        attributes: { total: 3 },
        meta: {
          adoptsFrom: {
            module: rri(`${testRealmURL}lattice`),
            name: 'LatticeSummary',
          },
          publication: {
            version: 1 as const,
            state: 'ready' as const,
            validatedThrough: 1,
            outputRevision: 2,
            definitionRevision: 'lattice-html-test',
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
          latticeUseSnapshot: true,
        }),
      );
      assert.true(options.latticeUseSnapshot);
      let rendered = await getService('render-store').add<LatticeSummary>(doc, {
        doNotPersist: true,
        relativeTo: testRRI(''),
        latticeUseSnapshot: options.latticeUseSnapshot,
      });
      assert.strictEqual(rendered.total, 3, 'HTML uses the supplied output');
      assert.strictEqual(calls, 0, 'HTML never ran the computed getter');
      let display = await getService('store').add<LatticeSummary>(
        {
          data: {
            ...doc.data,
            id: `${testRealmURL}LatticeSummary/display-during-index`,
            meta: {
              ...doc.data.meta,
              publication: {
                ...doc.data.meta.publication,
                state: 'pending',
                hasPublishedSnapshot: true,
              },
            },
          },
        },
        {
          doNotPersist: true,
          relativeTo: testRRI(''),
          latticeUseSnapshot: true,
        },
      );
      assert.strictEqual(
        display.total,
        3,
        'an active index render does not turn a browser display into an input read',
      );
      assert.strictEqual(display.publicationState, 'pending');
      assert.strictEqual(calls, 0);
      doc.data.id = `${testRealmURL}LatticeSummary/index`;
      let indexed = await getService('render-store').add<LatticeSummary>(doc, {
        doNotPersist: true,
        relativeTo: testRRI(''),
      });
      assert.strictEqual(
        indexed.total,
        999,
        'discovery keeps its computation path',
      );
      assert.ok(calls > 0);
      doc.data.id = `${testRealmURL}LatticeSummary/pending`;
      await assert.rejects(
        getService('render-store').add<LatticeSummary>(
          {
            data: {
              ...doc.data,
              meta: {
                ...doc.data.meta,
                publication: { ...doc.data.meta.publication, state: 'pending' },
              },
            },
          },
          {
            doNotPersist: true,
            relativeTo: testRRI(''),
            latticeUseSnapshot: true,
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
    class LatticeDetails extends FieldDef {
      @field label = contains(StringField);
      @field total = contains(NumberField, {
        computeVia: function () {
          calls++;
          return 12;
        },
      });
    }
    class LatticeSummary extends CardDef {
      @field label = contains(StringField);
      @field details = contains(LatticeDetails);
      @field rows = containsMany(LatticeDetails);
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
      contents: { 'lattice.gts': { LatticeSummary, LatticeDetails } },
    });
    let api: typeof import('@cardstack/base/card-api') = await getService(
      'loader-service',
    ).loader.import('@cardstack/base/card-api');
    let summary = new LatticeSummary();
    let doc = {
      data: {
        type: 'card' as const,
        attributes: {
          label: 'Lattice',
          total: 0,
          details: { label: 'Nested', total: 3 },
          rows: [{ label: 'Row', total: 5 }],
        },
        meta: {
          adoptsFrom: {
            module: rri(`${testRealmURL}lattice`),
            name: 'LatticeSummary',
          },
        },
      },
    };
    let opts = {
      latticeSnapshot: {
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
