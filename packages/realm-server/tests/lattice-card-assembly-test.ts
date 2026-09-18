import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { basename } from 'node:path';
import { captureLatticeInputArtifacts } from '@cardstack/runtime-common/lattice-input-artifacts';
import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  IndexQueryEngine,
  VirtualNetwork,
  baseRealmRRI,
  ri,
  rri,
  param,
  type Definition,
  type DefinitionLookup,
  type InstanceEntry,
  type Realm,
  type ScreenshotManifest,
  type SingleCardDocument,
} from '@cardstack/runtime-common';
import { RealmIndexQueryEngine } from '@cardstack/runtime-common/realm-index-query-engine';
import { latticeStoredDocumentBody } from '@cardstack/runtime-common/lattice-materialization';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realmURL = ri('https://lattice-assembly.example/');
const recordRef = { module: rri(`${realmURL}record`), name: 'Record' };
const detailRef = { module: rri(`${realmURL}detail`), name: 'Detail' };
const stringField = {
  type: 'contains' as const,
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: { module: rri(`${baseRealmRRI}string`), name: 'default' },
};

function definitions(): Map<string, Definition> {
  return new Map<string, Definition>([
    [
      'Record',
      {
        type: 'card-def',
        codeRef: recordRef,
        displayName: 'Lattice assembly record',
        fields: {
          name: 'string',
          siblings: 'records',
          firstDetail: 'detail',
          secondDetail: 'detail',
        },
        fieldDefs: {
          string: stringField,
          records: {
            type: 'linksToMany',
            isPrimitive: false,
            isComputed: false,
            fieldOrCard: recordRef,
          },
          detail: {
            type: 'contains',
            isPrimitive: false,
            isComputed: false,
            fieldOrCard: detailRef,
          },
        },
      },
    ],
    [
      'Detail',
      {
        type: 'field-def',
        codeRef: detailRef,
        displayName: null,
        fields: { label: 'string' },
        fieldDefs: { string: stringField },
      },
    ],
  ]);
}

function relationshipId(doc: SingleCardDocument, field: string) {
  let relationship = doc.data.relationships?.[field];
  if (Array.isArray(relationship)) {
    throw new Error(`Expected a single relationship for ${field}`);
  }
  let data = relationship?.data;
  return data && !Array.isArray(data) && 'id' in data ? data.id : undefined;
}

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let engine: RealmIndexQueryEngine;
  let indexEngine: IndexQueryEngine;
  let schema: Map<string, Definition>;
  let calls: { mode: 'normal' | 'cached'; name: string; priority?: number }[];
  setupDB(hooks, {
    templateDatabase: process.env.LATTICE_TEST_TEMPLATE_DB,
    beforeEach: async (adapter) => {
      db = adapter;
      schema = definitions();
      calls = [];
      // Loaderless definitions use the persisted module-schema shape. The
      // graph itself is read through the real Postgres index below.
      let lookup = {
        forRealm() {
          return this;
        },
        async lookupDefinition(
          ref: { name: string },
          opts?: { priority?: number },
        ) {
          calls.push({
            mode: 'normal',
            name: ref.name,
            priority: opts?.priority,
          });
          await Promise.resolve();
          let definition = schema.get(ref.name);
          if (!definition) {
            throw new Error(`Missing fixture definition ${ref.name}`);
          }
          return definition;
        },
        async lookupCachedDefinition(ref: { name: string }) {
          calls.push({ mode: 'cached', name: ref.name });
          await Promise.resolve();
          return schema.get(ref.name);
        },
      } as unknown as DefinitionLookup;
      let network = new VirtualNetwork();
      indexEngine = new IndexQueryEngine(db, lookup, network);
      let realm = {
        url: realmURL,
        virtualNetwork: network,
        async getRealmInfo() {
          return { name: 'Lattice assembly fixture' };
        },
      } as unknown as Realm;
      engine = new RealmIndexQueryEngine({
        lattice: new LatticeRealmConfig([realmURL]),
        realm,
        dbAdapter: db,
        definitionLookup: lookup,
        fetch: async (input) => {
          throw new Error(`Unexpected external fetch ${String(input)}`);
        },
      });
      let batch = await new IndexWriter(db, {
        lattice: new LatticeRealmConfig([realmURL]),
      }).createBatch(new URL(realmURL), network);
      for (let [name, siblings] of [
        ['root', ['sibling-1', 'sibling-2', 'sibling-3']],
        ['sibling-1', ['leaf']],
        ['sibling-2', ['leaf']],
        ['sibling-3', []],
        ['leaf', []],
      ] as [string, string[]][]) {
        let entry: InstanceEntry = {
          type: 'instance',
          lastModified: 1,
          resourceCreatedAt: 1,
          resource: {
            id: rri(`${realmURL}${name}`),
            type: 'card',
            attributes: {
              name,
              firstDetail: { label: `${name} first` },
              secondDetail: { label: `${name} second` },
            },
            relationships: Object.fromEntries(
              siblings.map((sibling, i) => [
                `siblings.${i}`,
                { links: { self: `./${sibling}` } },
              ]),
            ),
            meta: { adoptsFrom: recordRef, realmURL },
          },
          searchData: { name },
          types: [`${recordRef.module}/${recordRef.name}`],
          displayNames: ['Lattice assembly record'],
          deps: new Set(),
        };
        await batch.updateEntry(new URL(`${realmURL}${name}.json`), entry);
      }
      await batch.done();
    },
  });

  async function assemble(
    opts: Parameters<RealmIndexQueryEngine['cardDocument']>[1] = {},
  ): Promise<SingleCardDocument> {
    let result = await engine.cardDocument(new URL(`${realmURL}root`), {
      loadLinks: true,
      ...opts,
    });
    if (result?.type !== 'doc') {
      throw new Error(
        `Expected an assembled card document, got ${result?.type}`,
      );
    }
    return result.doc;
  }

  const screenshot: ScreenshotManifest = {
    card: {
      specHash: 'a'.repeat(64),
      objectKey: 'b'.repeat(64),
      contentType: 'image/png',
      width: 400,
      height: 300,
      deviceScaleFactor: 2,
    },
  };

  test('pending freshness keeps completed snapshot availability separate from discovery', async function (assert) {
    for (let state of ['ready', 'pending'] as const) {
      await db.execute(
        `UPDATE boxel_index SET pristine_doc = jsonb_set(pristine_doc, '{meta,publication}', $1::jsonb)
         WHERE url = $2 AND type = 'instance'`,
        {
          bind: [
            JSON.stringify({
              version: 1,
              state,
              validatedThrough: 0,
              outputRevision: 1,
              definitionRevision: 'test',
              computedFields: ['name'],
              queryFields: [],
              watches: [],
            }),
            `${realmURL}root.json`,
          ],
        },
      );
      // No matching owner revision exists, so this read cannot claim freshness.
      let doc = await assemble();
      assert.strictEqual(doc.data.meta.publication?.state, 'pending');
      assert.strictEqual(
        doc.data.meta.publication?.hasPublishedSnapshot,
        state === 'ready',
      );
      assert.strictEqual(
        doc.data.attributes?.name,
        'root',
        'the server retains its indexed payload',
      );
      assert.strictEqual(
        doc.included,
        undefined,
        'availability does not expand the input graph',
      );
    }
  });

  async function renderedRow(
    name: string,
    {
      error,
      generation = 1,
      screenshots = null,
    }: {
      error?: { message: string; status: number };
      generation?: number;
      screenshots?: ScreenshotManifest | null;
    } = {},
  ) {
    await db.execute(
      `INSERT INTO prerendered_html
        (url, file_alias, realm_url, type, generation, isolated_html, markdown, screenshots, error_doc)
       VALUES ($1, $2, $3, 'instance', $4, $5, $6, $7, $8)`,
      {
        bind: [
          `${realmURL}${name}.json`,
          `${realmURL}${name}`,
          realmURL,
          generation,
          `<p>${name} rendering</p>`,
          `${name} markdown`,
          screenshots ? JSON.stringify(screenshots) : null,
          error ? JSON.stringify(error) : null,
        ],
      },
    );
  }

  test('enabled card JSON survives an ordinary card HTML failure without hiding data errors', async function (assert) {
    let url = new URL(`${realmURL}root`);
    await renderedRow('root', {
      error: { message: 'Synthetic format failure', status: 500 },
    });
    assert.strictEqual(
      (await indexEngine.getInstance(url))?.type,
      'instance-error',
      'ordinary and HTML consumers retain existing behavior',
    );
    let result = await engine.cardDocument(url);
    assert.strictEqual(result?.type, 'doc');
    if (result?.type !== 'doc') throw new Error('Expected healthy source JSON');
    assert.strictEqual(result.doc.data.attributes?.name, 'root');
    assert.strictEqual(
      result.doc.data.meta.publication,
      undefined,
      'not an owner',
    );
    await db.execute(
      `UPDATE boxel_index SET has_error=TRUE,error_doc='{"status":422,"message":"Source data failed"}' WHERE url=$1`,
      { bind: [`${realmURL}root.json`] },
    );
    assert.strictEqual(
      (await engine.cardDocument(url))?.type,
      'error',
      'source errors remain fatal for JSON',
    );
  });

  test('item search does not transfer rendering dependencies while HTML search retains them', async function (assert) {
    await renderedRow('root');
    // Include a file row so the mixed/file projections exercise the same
    // branch used by native query fields with the default all-kind scope.
    await db.execute(
      `INSERT INTO boxel_index (url, file_alias, realm_url, type, generation, pristine_doc, search_doc, types)
       SELECT url, file_alias, realm_url, 'file', generation, pristine_doc, search_doc, types
       FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      { bind: [`${realmURL}root.json`] },
    );
    await db.execute(
      `INSERT INTO prerendered_html (url, file_alias, realm_url, type, generation, isolated_html)
       SELECT url, file_alias, realm_url, 'file', generation, isolated_html
       FROM prerendered_html WHERE url = $1 AND type = 'instance'`,
      { bind: [`${realmURL}root.json`] },
    );
    let scopes = ['instance', 'file', 'all'] as const;
    let search = (scope: (typeof scopes)[number]) =>
      indexEngine.search(
        new URL(realmURL),
        {},
        {},
        { kind: 'dataOnly' },
        scope,
      );
    let before = await Promise.all(scopes.map(search));
    let dependency = `${realmURL}${'render-dependency'.repeat(10_000)}`;
    await db.execute(
      'UPDATE prerendered_html SET deps = $1 WHERE realm_url = $2',
      {
        bind: [JSON.stringify([dependency]), realmURL],
      },
    );
    for (let [i, scope] of scopes.entries()) {
      let after = await search(scope);
      assert.deepEqual(after, before[i], `${scope} item search is unaffected`);
      assert.true(after.results.length > 0, `${scope} has matching rows`);
      assert.true(
        Buffer.byteLength(JSON.stringify(after)) < 20_000,
        `${scope} DB result excludes the large rendering payload`,
      );
      assert.true(
        after.results.every((row) => !Object.hasOwn(row, 'deps')),
        `${scope} does not transfer the unused column`,
      );
    }
    let html = await indexEngine.search(
      new URL(realmURL),
      {},
      {},
      { kind: 'renderSet' },
      'all',
    );
    let rendered = html.results.filter((row) => row.isolated_html);
    assert.strictEqual(
      rendered.length,
      2,
      'card and file HTML rows are present',
    );
    for (let row of rendered) {
      assert.deepEqual(
        row.deps,
        [dependency],
        'HTML retains its CSS dependencies',
      );
    }
  });

  test('stored Lattice bytes preserve the document and current pending state without hydrating attributes', async function (assert) {
    let stamp = {
      version: 1,
      state: 'ready',
      validatedThrough: 0,
      outputRevision: 1,
      definitionRevision: 'test',
      computedFields: ['name'],
      queryFields: [],
      watches: [],
    };
    let attributes = {
      name: 'quotes " and \\ newline\n 😀',
      dayData: {
        rows: Array.from({ length: 200 }, (_, id) => ({
          id,
          note: 'x'.repeat(1000),
        })),
      },
    };
    await db.withConnection(async (tx) => {
      await tx(['BEGIN']);
      try {
        await tx([
          `UPDATE boxel_index SET pristine_doc=jsonb_set(jsonb_set(pristine_doc,'{meta,publication}',`,
          param(JSON.stringify(stamp)),
          `::jsonb),'{attributes}',`,
          param(JSON.stringify(attributes)),
          `::jsonb) WHERE url=`,
          param(`${realmURL}root.json`),
          `AND type='instance'`,
        ]);
        await captureLatticeInputArtifacts(tx, realmURL, [
          `${realmURL}root.json`,
        ]);
        await tx(['COMMIT']);
      } catch (error) {
        await tx(['ROLLBACK']);
        throw error;
      }
    });
    await db.execute(
      `INSERT INTO lattice_owners (realm_url, owner_url, published_generation, input_generation,
        definition_revision, attributes_json, attributes_generation)
       VALUES ($1, $2, 1, 0, 'test', $3, 1)`,
      { bind: [realmURL, `${realmURL}root.json`, JSON.stringify(attributes)] },
    );
    let url = new URL(`${realmURL}root`);
    let stored = await engine.lattice?.read({ url });
    if (!stored) throw new Error('Expected stored Lattice bytes');
    assert.strictEqual(
      stored.doc.data.attributes,
      undefined,
      'Node receives only the small envelope as objects',
    );
    assert.strictEqual(typeof stored.attributesJSON, 'string');
    let ordinary = await assemble();
    ordinary.data.meta.publication!.have = stored.token;
    assert.deepEqual(
      JSON.parse(
        latticeStoredDocumentBody(stored.doc.data, stored.attributesJSON!),
      ),
      ordinary,
      'wire document matches ordinary assembly exactly',
    );
    assert.deepEqual(calls, [], 'no graph loading or schema compilation');
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation = 2 WHERE realm_url = $1',
      { bind: [realmURL] },
    );
    stored = await engine.lattice?.read({ url });
    assert.strictEqual(stored?.doc.data.meta.publication?.state, 'pending');
    assert.true(stored?.doc.data.meta.publication?.hasPublishedSnapshot);
    assert.deepEqual(
      JSON.parse(stored!.attributesJSON!),
      attributes,
      'completed values survive invalidation',
    );
    let reused = await engine.lattice?.read({ url, have: stored!.token });
    assert.true(reused?.reuse, 'same publication can reuse its pending body');
    assert.strictEqual(
      reused?.attributesJSON,
      null,
      'body never leaves Postgres',
    );
    assert.strictEqual(reused?.doc.data.attributes, undefined);
    assert.strictEqual(reused?.doc.data.relationships, undefined);
    assert.strictEqual(reused?.doc.data.meta.publication?.state, 'pending');
    assert.strictEqual(
      await indexEngine.getLatticeStoredDocument(
        url,
        new URL('https://other.example/'),
      ),
      undefined,
      'realm scope remains required',
    );
    await db.execute(
      'UPDATE lattice_owners SET attributes_generation = 0 WHERE realm_url = $1',
      { bind: [realmURL] },
    );
    assert.strictEqual(
      await engine.lattice?.read({ url }),
      undefined,
      'a mixed-version writer cannot serve older bytes with a newer stamp',
    );
    assert.deepEqual(
      (await assemble()).data.attributes,
      attributes,
      'ordinary document remains available on cache miss',
    );
    await db.execute(
      'UPDATE lattice_owners SET attributes_generation = 1, retired = TRUE WHERE realm_url = $1',
      { bind: [realmURL] },
    );
    assert.strictEqual(
      await engine.lattice?.read({ url }),
      undefined,
      'retired owners never use stored bytes',
    );
  });

  test('same-type siblings and contained fields share definitions without losing graph data', async function (assert) {
    let doc = await assemble();
    assert.deepEqual(
      doc.included?.map((resource) => resource.id).sort(),
      ['leaf', 'sibling-1', 'sibling-2', 'sibling-3'].map((name) =>
        rri(realmURL + name),
      ),
      'all siblings and the shared descendant are preserved exactly once',
    );
    assert.strictEqual(
      relationshipId(doc, 'siblings.1'),
      `${realmURL}sibling-2`,
    );
    for (let resource of [doc.data, ...(doc.included ?? [])]) {
      let name = resource.attributes?.name;
      assert.deepEqual(resource.attributes?.firstDetail, {
        label: `${name} first`,
      });
      assert.deepEqual(resource.attributes?.secondDetail, {
        label: `${name} second`,
      });
    }
    assert.deepEqual(
      calls.map(({ mode, name }) => ({ mode, name })),
      [
        { mode: 'normal', name: 'Record' },
        { mode: 'normal', name: 'Detail' },
      ],
      'concurrent siblings and repeated contained fields reuse the in-flight definitions',
    );
  });

  test('the next request sees a changed contained definition', async function (assert) {
    let before = await assemble();
    assert.notOk(before.data.relationships?.['firstDetail.match']);
    schema.set('Detail', {
      ...schema.get('Detail')!,
      fields: { label: 'string', match: 'query' },
      fieldDefs: {
        string: stringField,
        query: {
          type: 'linksTo',
          isPrimitive: false,
          isComputed: true,
          fieldOrCard: recordRef,
          query: { filter: { on: recordRef, eq: { name: 'sibling-2' } } },
        },
      },
    });
    let after = await assemble();
    assert.strictEqual(
      relationshipId(after, 'firstDetail.match'),
      `${realmURL}sibling-2`,
      'new query-field behavior is visible without recreating the engine',
    );
    assert.strictEqual(
      relationshipId(after, 'secondDetail.match'),
      `${realmURL}sibling-2`,
      'both contained fields use the current definition',
    );
  });

  test('cache-only assembly never reuses an earlier ordinary lookup', async function (assert) {
    let ordinary = await assemble();
    calls.length = 0;
    let cached = await assemble({ cacheOnlyDefinitions: true });
    assert.deepEqual(
      cached,
      ordinary,
      'cache-only assembly preserves the complete response',
    );
    assert.deepEqual(
      calls,
      [
        { mode: 'cached', name: 'Record' },
        { mode: 'cached', name: 'Detail' },
      ],
      'cache-only reads use only cached lookups with request-local coalescing',
    );
  });

  test('simultaneous requests keep their definition priorities separate', async function (assert) {
    let [secondary, source] = await Promise.all([
      assemble({ priority: 8 }),
      assemble({ priority: 10 }),
    ]);
    assert.deepEqual(
      secondary,
      source,
      'priority does not change assembled graph data',
    );
    assert.deepEqual(
      calls.map(({ name, priority }) => `${name}:${priority}`).sort(),
      ['Detail:10', 'Detail:8', 'Record:10', 'Record:8'],
      'each request coalesces its own lookups and retains its caller priority',
    );
  });

  test('JSON links preserve complete cards, alias identity and screenshots while generic reads retain HTML', async function (assert) {
    await renderedRow('sibling-1', { screenshots: screenshot });
    let canonical = `${realmURL}sibling-1.json`;
    let alias = `${realmURL}sibling-1`;
    let urls = [new URL(canonical), new URL(alias)];
    let generic = await indexEngine.getInstances(urls);
    let narrow = await indexEngine.getInstancesForLinks(urls);
    let full = generic.get(alias);
    let linked = narrow.get(alias);
    if (full?.type !== 'instance' || linked?.type !== 'instance') {
      throw new Error('Expected successful linked fixture');
    }
    assert.strictEqual(full.isolatedHtml, '<p>sibling-1 rendering</p>');
    assert.strictEqual(full.markdown, 'sibling-1 markdown');
    assert.strictEqual(
      narrow.get(canonical),
      linked,
      'both lookup spellings share one mapped instance',
    );
    assert.strictEqual(linked.canonicalURL, canonical);
    assert.deepEqual(
      linked.instance,
      full.instance,
      'all authored JSON fields survive the narrow read',
    );
    assert.deepEqual(linked.screenshots, screenshot);
    let doc = await assemble();
    let included = doc.included?.find((resource) => resource.id === alias);
    assert.deepEqual(included?.attributes, full.instance.attributes);
    assert.deepEqual(
      included?.meta.screenshots,
      {
        card: {
          url: `${realmURL}_screenshot/sibling-1?name=card`,
          hash: 'b'.repeat(64),
          contentType: 'image/png',
          width: 400,
          height: 300,
          deviceScaleFactor: 2,
        },
      },
      'the assembled linked card retains its declared screenshot',
    );
    assert.deepEqual(
      doc.included?.map((resource) => resource.id).sort(),
      ['leaf', 'sibling-1', 'sibling-2', 'sibling-3'].map((name) =>
        rri(realmURL + name),
      ),
    );
  });

  test('JSON links preserve source and current HTML errors, stale HTML recovery, and missing or deleted membership', async function (assert) {
    let sourceError = { message: 'synthetic source failure', status: 422 };
    let htmlError = { message: 'synthetic rendering failure', status: 500 };
    await db.execute(
      'UPDATE boxel_index SET generation = 10 WHERE realm_url = $1',
      { bind: [realmURL] },
    );
    await db.execute(
      'UPDATE boxel_index SET has_error = TRUE, error_doc = $1 WHERE url = $2',
      { bind: [JSON.stringify(sourceError), `${realmURL}sibling-1.json`] },
    );
    await renderedRow('sibling-1', { generation: 10, error: htmlError });
    await renderedRow('sibling-2', { generation: 10, error: htmlError });
    await renderedRow('sibling-3', { generation: 9, error: htmlError });
    await db.execute(
      'UPDATE boxel_index SET is_deleted = TRUE WHERE url = $1',
      { bind: [`${realmURL}leaf.json`] },
    );
    let urls = ['sibling-1', 'sibling-2', 'sibling-3', 'leaf', 'missing'].map(
      (name) => new URL(realmURL + name),
    );
    let generic = await indexEngine.getInstances(urls);
    let narrow = await indexEngine.getInstancesForLinks(urls);
    assert.deepEqual(
      [...narrow.keys()].sort(),
      [...generic.keys()].sort(),
      'identical missing and tombstone exclusion',
    );
    for (let name of ['sibling-1', 'sibling-2']) {
      let full = generic.get(realmURL + name);
      let linked = narrow.get(realmURL + name);
      if (
        full?.type !== 'instance-error' ||
        linked?.type !== 'instance-error'
      ) {
        throw new Error(`Expected errored fixture ${name}`);
      }
      assert.deepEqual(
        linked.error,
        full.error,
        `${name} preserves the effective error`,
      );
      assert.deepEqual(
        linked.error,
        name === 'sibling-1' ? sourceError : htmlError,
        'source errors retain precedence',
      );
    }
    assert.strictEqual(
      narrow.get(`${realmURL}sibling-3`)?.type,
      'instance',
      'an older HTML error does not hide newer indexed data',
    );
    assert.false(narrow.has(`${realmURL}leaf`));
    assert.false(narrow.has(`${realmURL}missing`));
    let doc = await assemble();
    assert.deepEqual(
      doc.included?.map((resource) => resource.id),
      [rri(`${realmURL}sibling-3`)],
      'only the usable sibling enters the assembled graph',
    );
    assert.strictEqual(
      relationshipId(doc, 'siblings.0'),
      `${realmURL}sibling-1`,
      'unavailable link identity remains in the root relationship',
    );
    assert.strictEqual(
      relationshipId(doc, 'siblings.1'),
      `${realmURL}sibling-2`,
    );
  });

  test('JSON links use the working data and working rendering error channel only when requested', async function (assert) {
    await renderedRow('sibling-1', { screenshots: screenshot });
    for (let [table, columns] of [
      [
        'boxel_index',
        'url, file_alias, type, generation, realm_url, pristine_doc, search_doc, last_modified, resource_created_at, has_error, error_doc, is_deleted',
      ],
      [
        'prerendered_html',
        'url, file_alias, type, generation, realm_url, isolated_html, screenshots, error_doc',
      ],
    ]) {
      await db.execute(`DELETE FROM ${table}_working WHERE realm_url = $1`, {
        bind: [realmURL],
      });
      await db.execute(
        `INSERT INTO ${table}_working (${columns}) SELECT ${columns} FROM ${table} WHERE realm_url = $1`,
        { bind: [realmURL] },
      );
    }
    await db.execute(
      `UPDATE boxel_index_working SET pristine_doc = jsonb_set(pristine_doc, '{attributes,name}', $1::jsonb) WHERE url = $2`,
      {
        bind: [JSON.stringify('working sibling'), `${realmURL}sibling-1.json`],
      },
    );
    let urls = [new URL(`${realmURL}sibling-1`)];
    let committed = (await indexEngine.getInstancesForLinks(urls)).get(
      urls[0].href,
    );
    let working = (
      await indexEngine.getInstancesForLinks(urls, {
        useWorkInProgressIndex: true,
      })
    ).get(urls[0].href);
    if (committed?.type !== 'instance' || working?.type !== 'instance')
      throw new Error('Expected both fixture versions');
    assert.strictEqual(committed.instance.attributes?.name, 'sibling-1');
    assert.strictEqual(working.instance.attributes?.name, 'working sibling');
    assert.deepEqual(working.screenshots, screenshot);
    await db.execute(
      `UPDATE prerendered_html_working SET error_doc = $1 WHERE url = $2`,
      {
        bind: [
          JSON.stringify({ message: 'working rendering failed', status: 500 }),
          `${realmURL}sibling-1.json`,
        ],
      },
    );
    assert.strictEqual(
      (await indexEngine.getInstancesForLinks(urls)).get(urls[0].href)?.type,
      'instance',
    );
    assert.strictEqual(
      (
        await indexEngine.getInstancesForLinks(urls, {
          useWorkInProgressIndex: true,
        })
      ).get(urls[0].href)?.type,
      'instance-error',
    );
  });

  test('JSON link reads do not transfer unused large columns and leave complete assembled data unchanged', async function (assert) {
    await renderedRow('sibling-1', { screenshots: screenshot });
    let before = await assemble();
    let largeDependency = `${realmURL}${'d'.repeat(100_000)}`;
    await db.execute(
      'UPDATE boxel_index SET deps = $1, last_known_good_deps = $1 WHERE url = $2',
      {
        bind: [JSON.stringify([largeDependency]), `${realmURL}sibling-1.json`],
      },
    );
    await db.execute(
      'UPDATE prerendered_html SET isolated_html = $1 WHERE url = $2',
      {
        bind: [
          '<p>' + 'h'.repeat(100_000) + '</p>',
          `${realmURL}sibling-1.json`,
        ],
      },
    );
    let execute = db.execute;
    let received: Awaited<ReturnType<PgAdapter['execute']>> = [];
    db.execute = async function (sql, opts) {
      let rows = await execute.call(this, sql, opts);
      received.push(...rows);
      return rows;
    };
    try {
      let urls = [new URL(`${realmURL}sibling-1`)];
      await indexEngine.getInstances(urls);
      let genericBytes = Buffer.byteLength(JSON.stringify(received));
      assert.true(
        genericBytes > 300_000,
        'the real generic DB result includes the synthetic large columns',
      );
      received = [];
      await indexEngine.getInstancesForLinks(urls);
      let narrowBytes = Buffer.byteLength(JSON.stringify(received));
      assert.strictEqual(received.length, 1);
      assert.true(
        narrowBytes < 5_000,
        'the DB returns a small card projection instead of transferring unused data',
      );
      for (let column of [
        'deps',
        'last_known_good_deps',
        'isolated_html',
        'diagnostics',
      ]) {
        assert.false(
          Object.hasOwn(received[0], column),
          `${column} is absent from the actual DB result`,
        );
      }
      received = [];
      assert.strictEqual((await indexEngine.getInstancesForLinks([])).size, 0);
      assert.strictEqual(
        received.length,
        0,
        'empty lookup performs no DB read',
      );
    } finally {
      db.execute = execute;
    }
    assert.deepEqual(
      await assemble(),
      before,
      'all assembled fields, relationships, metadata and screenshots are unchanged',
    );
  });

  test('Lattice indexed inputs omit large unused columns but retain complete cards, screenshots and source errors', async function (assert) {
    await renderedRow('sibling-1', { screenshots: screenshot });
    let url = new URL(`${realmURL}sibling-1`);
    let full = await indexEngine.getInstance(url);
    await db.execute(
      'UPDATE boxel_index SET deps=$1,last_known_good_deps=$1 WHERE url=$2',
      {
        bind: [
          JSON.stringify([realmURL + 'd'.repeat(100_000)]),
          url.href + '.json',
        ],
      },
    );
    await db.execute(
      'UPDATE prerendered_html SET isolated_html=$1 WHERE url=$2',
      {
        bind: ['h'.repeat(100_000), url.href + '.json'],
      },
    );
    let input = await indexEngine.getInstance(url, { latticeInput: true });
    if (input?.type !== 'instance' || full?.type !== 'instance')
      throw new Error('Expected input fixture');
    assert.deepEqual(input.instance, full.instance);
    assert.deepEqual(input.screenshots, screenshot);
    assert.strictEqual(input.deps, null);
    assert.strictEqual(input.searchDoc, null);
    assert.strictEqual(input.isolatedHtml, null);
    let error = { message: 'Lattice synthetic source error', status: 422 };
    await db.execute(
      'UPDATE boxel_index SET has_error=true,error_doc=$1 WHERE url=$2',
      {
        bind: [JSON.stringify(error), url.href + '.json'],
      },
    );
    let broken = await indexEngine.getInstance(url, { latticeInput: true });
    assert.strictEqual(broken?.type, 'instance-error');
    if (broken?.type !== 'instance-error')
      throw new Error('Expected source error');
    assert.deepEqual(broken.error, error);
    assert.strictEqual(broken.deps?.[0].length, realmURL.length + 100_000);
    assert.strictEqual(
      broken.isolatedHtml?.length,
      100_000,
      'error presentation retains prior HTML',
    );
  });
});
