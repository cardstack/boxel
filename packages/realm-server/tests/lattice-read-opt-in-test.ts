import QUnit from 'qunit';
import { basename } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import { dirSync, type DirResult } from 'tmp';
import { writeFileSync } from 'node:fs';
import {
  IndexWriter,
  CardDocumentCache,
  VirtualNetwork,
  SupportedMimeType,
  baseRealm,
  rri,
  type Definition,
  type DefinitionLookup,
  type Realm,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { LATTICE_INPUT_GENERATION_HEADER } from '@cardstack/runtime-common/lattice-materialization';
import { createRealm, setupDB, searchCardsForTest } from './helpers/index.ts';

const { module, test } = QUnit;
// Mounted in the virtual network: avoid the test-only 127.0.0.1 transport
// retry policy when verifying one expansion fetch per distinct target.
const ordinaryURL = 'http://lattice-read.localhost/ordinary/';
const enabledURL = 'http://lattice-read.localhost/enabled/';

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let ordinary: Realm;
  let enabled: Realm;
  let dirs: DirResult[];
  let statements: { sql: string; bind?: unknown[] }[];
  let definitions: string[];
  let network: VirtualNetwork;
  const lattice = new LatticeRealmConfig([enabledURL]);
  const lookup = {
    forRealm() {
      return this;
    },
    async lookupDefinition(ref: ResolvedCodeRef) {
      definitions.push(ref.module);
      return {
        type: 'card-def',
        codeRef: ref,
        displayName: 'Read fixture',
        fields: { value: 'value', child: 'child' },
        fieldDefs: {
          value: {
            type: 'contains',
            isPrimitive: true,
            isComputed: false,
            fieldOrCard: {
              module: rri('@cardstack/base/number'),
              name: 'default',
            },
          },
          child: {
            type: 'linksTo',
            isPrimitive: false,
            isComputed: false,
            fieldOrCard: ref,
          },
        },
      } as Definition;
    },
  } as unknown as DefinitionLookup;

  setupDB(hooks, {
    beforeEach: async (adapter, publisher) => {
      db = adapter;
      dirs = [];
      statements = [];
      definitions = [];
      network = new VirtualNetwork();
      const writer = new IndexWriter(db, { lattice });
      const realms: Realm[] = [];
      for (const root of [ordinaryURL, enabledURL]) {
        const dir = dirSync({ unsafeCleanup: true });
        dirs.push(dir);
        const batch = await writer.createBatch(new URL(root), network);
        for (const name of ['root', 'child', 'healthy']) {
          await batch.updateEntry(new URL(root + name + '.json'), {
            type: 'instance',
            lastModified: 1,
            resourceCreatedAt: 1,
            resource: {
              id: rri(root + name),
              type: 'card',
              attributes: { value: name === 'root' ? 7 : 8 },
              ...(name === 'root'
                ? { relationships: { child: { links: { self: './child' } } } }
                : {}),
              meta: {
                adoptsFrom: { module: rri(root + 'record'), name: 'Record' },
              },
            },
            searchData: { value: name === 'root' ? 7 : 8 },
            types: [root + 'record/Record'],
            displayNames: ['Record'],
            deps: new Set(),
          });
        }
        writeFileSync(`${dir.name}/guide.md`, 'Synthetic linked file');
        await batch.updateEntry(new URL(root + 'guide.md'), {
          type: 'file',
          lastModified: 1,
          resourceCreatedAt: 1,
          deps: new Set(),
          resource: {
            id: rri(root + 'guide.md'),
            type: 'file-meta',
            attributes: { name: 'guide.md', contentType: 'text/markdown' },
            meta: {
              adoptsFrom: {
                module: rri(new URL('file-api', baseRealm.url).href),
                name: 'FileDef',
              },
            },
          },
        });
        await batch.done();
        const { realm } = await createRealm({
          dir: dir.name,
          realmURL: root,
          dbAdapter: db,
          publisher,
          virtualNetwork: network,
          definitionLookup: lookup,
          lattice,
          ...(root === enabledURL
            ? { cardDocumentCache: new CardDocumentCache() }
            : {}),
        });
        await realm.start();
        network.mount(realm.handle);
        realms.push(realm);
      }
      [ordinary, enabled] = realms;
      const execute = db.execute.bind(db);
      db.execute = async (sql, opts) => {
        statements.push({ sql, bind: opts?.bind });
        return execute(sql, opts);
      };
    },
    afterEach: async () => {
      ordinary?.unsubscribe();
      enabled?.unsubscribe();
      dirs?.forEach((dir) => dir.removeCallback());
    },
  });

  async function read(
    realm: Realm,
    path = 'root',
    headers: Record<string, string> = {},
  ) {
    return (await realm.handle(
      new Request(realm.url + path, {
        headers: { Accept: SupportedMimeType.CardJson, ...headers },
      }),
    ))!;
  }

  function latticeSQL() {
    return statements.filter(({ sql }) => /\b(lattice_|lattice_)/.test(sql));
  }

  test('an ordinary root serves a changed linked publication without reusing its root ETag', async (assert) => {
    const [clock] = await db.execute(
      'SELECT current_generation,loader_epoch FROM realm_generations WHERE realm_url=$1',
      { bind: [enabledURL] },
    );
    const initialGeneration = Number(clock.current_generation);
    const publishChild = async (generation: number, value: number) => {
      const stamp = {
        version: 1,
        state: 'ready',
        computedFields: ['value'],
        queryFields: [],
        watches: [],
        validatedThrough: generation,
        outputRevision: generation,
        definitionRevision: clock.loader_epoch,
      };
      await db.execute(
        'UPDATE realm_generations SET current_generation=$1 WHERE realm_url=$2',
        {
          bind: [generation, enabledURL],
        },
      );
      await db.execute(
        `UPDATE boxel_index SET pristine_doc=jsonb_set(jsonb_set(pristine_doc,'{meta,publication}',$1::jsonb),'{attributes,value}',$2::jsonb) WHERE file_alias=$3`,
        {
          bind: [
            JSON.stringify(stamp),
            JSON.stringify(value),
            enabledURL + 'child',
          ],
        },
      );
      await db.execute(
        `INSERT INTO lattice_owners (realm_url,owner_url,published_generation,input_generation,definition_revision)
         VALUES ($1,$2,$3,$3,$4) ON CONFLICT (realm_url,owner_url) DO UPDATE
         SET published_generation=EXCLUDED.published_generation,input_generation=EXCLUDED.input_generation`,
        {
          bind: [
            enabledURL,
            enabledURL + 'child.json',
            generation,
            clock.loader_epoch,
          ],
        },
      );
    };
    const rootBefore = await db.execute(
      'SELECT generation,indexed_at,pristine_doc FROM boxel_index WHERE file_alias=$1',
      {
        bind: [enabledURL + 'root'],
      },
    );
    await publishChild(initialGeneration, 8);
    const first = await read(enabled);
    assert.strictEqual(first.status, 200);
    assert.strictEqual((await first.json()).included[0].attributes.value, 8);
    const firstHead = (await enabled.handle(
      new Request(enabledURL + 'root', {
        method: 'HEAD',
        headers: { Accept: SupportedMimeType.CardJson },
      }),
    ))!;
    assert.strictEqual(firstHead.status, 200);
    const firstEtag = first.headers.get('etag');
    assert.ok(
      firstEtag,
      'a settled realm has a reusable publication validator',
    );
    assert.strictEqual(
      firstHead.headers.get('etag'),
      firstEtag,
      'HEAD uses the same publication-aware validator as GET',
    );
    assert.strictEqual(await firstHead.text(), '');
    await publishChild(initialGeneration + 1, 9);
    const second = await read(enabled, 'root', {
      'If-None-Match': first.headers.get('etag') ?? '"previous-root-validator"',
    });
    assert.strictEqual(
      second.status,
      200,
      'a child publication cannot receive a root-only 304',
    );
    assert.strictEqual((await second.json()).included[0].attributes.value, 9);
    const secondEtag = second.headers.get('etag');
    assert.ok(secondEtag);
    assert.notEqual(
      secondEtag,
      firstEtag,
      'the child publication moves the validator',
    );
    const secondHead = (await enabled.handle(
      new Request(enabledURL + 'root', {
        method: 'HEAD',
        headers: {
          Accept: SupportedMimeType.CardJson,
          'If-None-Match':
            firstHead.headers.get('etag') ?? '"previous-root-validator"',
        },
      }),
    ))!;
    assert.strictEqual(
      secondHead.status,
      200,
      'a changed child cannot receive a root-only HEAD 304',
    );
    assert.strictEqual(secondHead.headers.get('etag'), secondEtag);
    assert.strictEqual(
      (await read(enabled, 'root', { 'If-None-Match': secondEtag! })).status,
      304,
      'an unchanged settled publication can be revalidated',
    );
    assert.deepEqual(
      await db.execute(
        'SELECT generation,indexed_at,pristine_doc FROM boxel_index WHERE file_alias=$1',
        {
          bind: [enabledURL + 'root'],
        },
      ),
      rootBefore,
      'the root did not need reindexing',
    );
  });

  async function linkRemoteInputs(consumer: Realm, peer: Realm) {
    const relationships = {
      child: { links: { self: peer.url + 'child' } },
      local: { links: { self: './child' } },
      healthy: { links: { self: peer.url + 'healthy' } },
      'children.0': { links: { self: peer.url + 'child' } },
      'files.0': { links: { self: peer.url + 'guide.md' } },
    };
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{relationships}',$1::jsonb),deps=$3::jsonb WHERE file_alias=$2 AND type='instance'`,
      {
        bind: [
          JSON.stringify(relationships),
          consumer.url + 'root',
          // Match an indexed source edit: relationship targets and the
          // dependency facts used by the response validator move together.
          JSON.stringify([
            peer.url + 'child.json',
            consumer.url + 'child.json',
            peer.url + 'healthy.json',
            peer.url + 'guide.md',
          ]),
        ],
      },
    );
  }

  for (const failure of [
    'network',
    'timeout',
    '403',
    '404',
    '503',
    'invalid JSON',
    'binary',
    'non-card document',
  ]) {
    test(`remote link failures: ${failure} retains enabled consumer reads and recovers`, async (assert) => {
      await linkRemoteInputs(enabled, ordinary);
      await linkRemoteInputs(ordinary, enabled);
      const search = () =>
        searchCardsForTest(
          enabled.realmIndexQueryEngine,
          {
            filter: {
              on: { module: rri(enabledURL + 'record'), name: 'Record' },
              eq: { value: 7 },
            },
          },
          { loadLinks: true },
        );
      // GET and search have different existing URL/generation envelopes.
      // Compare each complete response against its own fault-free baseline.
      const availableResponse = await read(enabled);
      assert.strictEqual(
        availableResponse.status,
        200,
        await availableResponse.clone().text(),
      );
      const available = await availableResponse.json();
      const availableSearch = await search();
      const indexedBefore = await db.execute(
        'SELECT url,pristine_doc,has_error,error_doc FROM boxel_index ORDER BY url,type',
      );
      const attempts: string[] = [];
      const failedTargets = new Set(
        [ordinaryURL, enabledURL].flatMap((root) => [
          root + 'child',
          root + 'guide.md',
        ]),
      );
      const unavailableIncludes = new Set([
        ordinaryURL + 'child',
        ordinaryURL + 'guide.md',
      ]);
      // The ordinary caller rejects as soon as one sibling fails; another
      // already-started sibling can finish later. Count only the enabled
      // consumer's peer URLs, without changing that disabled behavior.
      const enabledAttempts = () =>
        attempts.filter((url) => unavailableIncludes.has(url)).sort();
      const fault = async (request: Request) => {
        if (!failedTargets.has(request.url)) return null;
        attempts.push(request.url);
        if (failure === 'network') throw new TypeError('DNS address not found');
        if (failure === 'timeout')
          throw new DOMException('Peer read timed out', 'TimeoutError');
        if (failure === 'invalid JSON')
          return new Response('{', {
            headers: { 'Content-Type': 'application/json' },
          });
        if (failure === 'binary')
          return new Response('synthetic binary body', {
            headers: { 'Content-Type': 'image/png' },
          });
        if (failure === 'non-card document')
          return Response.json({ unrelated: true });
        return new Response('Synthetic peer failure', {
          status: Number(failure),
        });
      };
      network.mount(fault, { prepend: true });
      try {
        // Disabled realms retain their existing fail-on-expansion-error path.
        const ordinaryResult = await Promise.allSettled([read(ordinary)]);
        const ordinaryFailed =
          ordinaryResult[0].status === 'rejected' ||
          ordinaryResult[0].value.status >= 400;
        assert.true(
          ordinaryFailed,
          'ordinary failed-read behavior is unchanged',
        );
        attempts.length = 0;
        const response = await read(enabled);
        assert.strictEqual(response.status, 200, await response.clone().text());
        const doc = await response.json();
        assert.deepEqual(doc.data.attributes, { value: 7 });
        assert.strictEqual(doc.data.id, enabledURL + 'root');
        for (const [field, type, id] of [
          ['child', 'card', ordinaryURL + 'child'],
          ['children.0', 'card', ordinaryURL + 'child'],
          ['files.0', 'file-meta', ordinaryURL + 'guide.md'],
        ]) {
          assert.deepEqual(doc.data.relationships[field].data, { type, id });
          assert.strictEqual(doc.data.relationships[field].links.self, id);
          assert.strictEqual(
            doc.data.relationships[field].meta,
            undefined,
            'the read does not invent a confirmed-missing or fresh marker',
          );
        }
        assert.deepEqual(
          doc.included.map((card: any) => card.id).sort(),
          [enabledURL + 'child', ordinaryURL + 'healthy'].sort(),
          'usable local and remote siblings survive without a fabricated target',
        );
        assert.deepEqual(
          enabledAttempts(),
          [ordinaryURL + 'child', ordinaryURL + 'guide.md'].sort(),
          'each failed target is fetched once despite repeated references',
        );
        assert.deepEqual(
          doc,
          {
            ...available,
            included: available.included.filter(
              (card: any) => !unavailableIncludes.has(card.id),
            ),
          },
          'GET preserves its full document apart from unavailable includes',
        );
        const searched = await search();
        assert.deepEqual(
          searched,
          {
            ...availableSearch,
            included: availableSearch.included.filter(
              (card) => !unavailableIncludes.has(card.id!),
            ),
          },
          'item search preserves its full document apart from unavailable includes',
        );
        assert.strictEqual(
          enabledAttempts().length,
          4,
          'a later search retries failed targets',
        );
      } finally {
        network.unmount(fault);
      }
      const recoveredResponse = await read(enabled);
      assert.strictEqual(
        recoveredResponse.status,
        200,
        await recoveredResponse.clone().text(),
      );
      const recovered = await recoveredResponse.json();
      assert.deepEqual(
        recovered,
        available,
        'the complete GET recovers without a cached failure',
      );
      assert.deepEqual(recovered.data.attributes, { value: 7 });
      assert.deepEqual(
        recovered.included.map((card: any) => [card.type, card.id]).sort(),
        [
          ['card', enabledURL + 'child'],
          ['card', ordinaryURL + 'healthy'],
          ['card', ordinaryURL + 'child'],
          ['file-meta', ordinaryURL + 'guide.md'],
        ].sort(),
        'the same consumer recovers all actual remote resources',
      );
      assert.deepEqual(
        await db.execute(
          'SELECT url,pristine_doc,has_error,error_doc FROM boxel_index ORDER BY url,type',
        ),
        indexedBefore,
        'read-time failures and recovery never alter indexed source or error state',
      );
    });
  }

  test('remote link failures: a caller abort during expansion is not a usable partial response', async (assert) => {
    await linkRemoteInputs(enabled, ordinary);
    const controller = new AbortController();
    const reason = new Error('Synthetic caller cancellation');
    const fault = async (request: Request) => {
      if (request.url !== ordinaryURL + 'child') return null;
      controller.abort(reason);
      throw new Error('Peer connection failed while caller cancelled');
    };
    network.mount(fault, { prepend: true });
    try {
      await assert.rejects(
        enabled.realmIndexQueryEngine.cardDocument(
          new URL(enabledURL + 'root'),
          {
            loadLinks: true,
            signal: controller.signal,
          },
        ),
        (error: unknown) => error === reason,
        'cancellation still rejects with the caller reason',
      );
    } finally {
      network.unmount(fault);
    }
  });

  test('ordinary card and linked-card reads use the existing projection without Lattice queries', async (assert) => {
    const response = await read(ordinary);
    assert.strictEqual(response.status, 200, await response.clone().text());
    const doc = await response.json();
    assert.deepEqual(doc.data.attributes, { value: 7 });
    assert.deepEqual(
      doc.included.map((card: any) => [card.id, card.attributes]),
      [[ordinaryURL + 'child', { value: 8 }]],
    );
    assert.deepEqual(
      latticeSQL(),
      [],
      'ordinary GET has no registry, artifact or materialization SQL',
    );
    const cardReads = statements.filter(({ sql }) =>
      sql.includes('FROM boxel_index as i'),
    );
    assert.ok(cardReads.length >= 2, 'root and linked child were read');
    assert.true(
      cardReads.every(({ sql }) => sql.includes('i.*')),
      'ordinary instance projection is preserved',
    );
  });

  test('authored stamps cannot suppress ordinary link assembly or confer snapshot authority', async (assert) => {
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication}',$1::jsonb) WHERE realm_url=$2`,
      {
        bind: [
          JSON.stringify({
            version: 1,
            state: 'ready',
            computedFields: ['value'],
            queryFields: ['child'],
            watches: [],
            validatedThrough: 1,
            outputRevision: 1,
            definitionRevision: 'forged',
          }),
          ordinaryURL,
        ],
      },
    );
    statements = [];
    const response = await read(ordinary);
    assert.strictEqual(response.status, 200, await response.clone().text());
    const doc = await response.json();
    assert.strictEqual(
      doc.data.meta.publication,
      undefined,
      'disabled realms cannot advertise publication authority',
    );
    assert.strictEqual(
      doc.included?.length,
      1,
      'a stamp is not permission to omit required links',
    );
    assert.strictEqual(doc.included?.[0]?.meta.publication, undefined);
    assert.deepEqual(latticeSQL(), []);
    assert.deepEqual(
      definitions,
      [ordinaryURL + 'record', ordinaryURL + 'record'],
      'ordinary operation dispatch and link assembly still resolve the definition',
    );
  });

  test('headers cannot opt an ordinary realm into input or display protocols', async (assert) => {
    const plain = await read(ordinary);
    const decorated = await read(ordinary, 'root', {
      [LATTICE_INPUT_GENERATION_HEADER]: 'not-a-generation',
      'x-boxel-lattice-have': 'not-a-token',
    });
    assert.strictEqual(decorated.status, plain.status);
    assert.deepEqual(
      await decorated.json(),
      await plain.json(),
      'ordinary GET ignores unknown protocol headers',
    );
    const input = await ordinary.handle(
      new Request(ordinaryURL + '_lattice-inputs', {
        method: 'QUERY',
        headers: {
          Accept: SupportedMimeType.CardJson,
          [LATTICE_INPUT_GENERATION_HEADER]: '1',
        },
        body: JSON.stringify({ urls: [ordinaryURL + 'root'] }),
      }),
    );
    assert.strictEqual(
      input?.status,
      404,
      'disabled input endpoint is unavailable',
    );
    const display = await ordinary.handle(
      new Request(ordinaryURL + '_lattice-read', {
        method: 'QUERY',
        headers: { Accept: SupportedMimeType.CardJson },
        body: JSON.stringify({
          version: 1,
          session: 'ordinary',
          epoch: 1,
          required: [ordinaryURL + 'root'],
          have: [],
        }),
      }),
    );
    assert.strictEqual(
      display?.status,
      404,
      'disabled display endpoint is unavailable',
    );
    assert.deepEqual(latticeSQL(), []);
  });

  test('a linked publication is validated by its enabled source realm, not the ordinary consumer', async (assert) => {
    let [generation] = await db.execute(
      'SELECT current_generation,loader_epoch FROM realm_generations WHERE realm_url=$1',
      { bind: [enabledURL] },
    );
    const stamp = {
      version: 1,
      state: 'ready',
      computedFields: ['value'],
      queryFields: ['child'],
      watches: [],
      validatedThrough: Number(generation.current_generation),
      outputRevision: Number(generation.current_generation),
      definitionRevision: generation.loader_epoch,
    };
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication}',$1::jsonb) WHERE realm_url=$2 AND file_alias=$3`,
      { bind: [JSON.stringify(stamp), enabledURL, enabledURL + 'root'] },
    );
    await db.execute(
      `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,definition_revision) VALUES($1,$2,$3,$3,$4)`,
      {
        bind: [
          enabledURL,
          enabledURL + 'root.json',
          stamp.outputRevision,
          stamp.definitionRevision,
        ],
      },
    );
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{relationships,child,links,self}',$1::jsonb),deps=$4::jsonb WHERE realm_url=$2 AND file_alias=$3`,
      {
        bind: [
          JSON.stringify(enabledURL + 'root'),
          ordinaryURL,
          ordinaryURL + 'root',
          JSON.stringify([enabledURL + 'root.json']),
        ],
      },
    );
    statements = [];
    definitions = [];
    const response = await read(ordinary);
    assert.strictEqual(response.status, 200, await response.clone().text());
    const doc = await response.json();
    assert.strictEqual(
      doc.included.length,
      1,
      'published query dependencies are not expanded again',
    );
    assert.deepEqual(doc.included[0].attributes, { value: 7 });
    assert.strictEqual(doc.included[0].meta.publication.state, 'ready');
    assert.deepEqual(
      [...new Set(definitions)],
      [ordinaryURL + 'record', enabledURL + 'record'],
      'operation dispatch and assembly read only the involved stored definitions',
    );
    assert.true(
      latticeSQL().length > 0,
      'the enabled source checks publication authority',
    );
    assert.false(
      latticeSQL().some(({ bind }) => bind?.includes(ordinaryURL)),
      'no registry lookup is attributed to the ordinary consumer',
    );
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=2 WHERE realm_url=$1',
      { bind: [enabledURL] },
    );
    const pending = await (await read(ordinary)).json();
    assert.strictEqual(
      pending.included[0].meta.publication.state,
      'pending',
      'the source realm still supplies current freshness',
    );
    assert.deepEqual(pending.included[0].attributes, { value: 7 });
  });

  test('enabled inputs retain their revision fence while ordinary errors and missing cards retain status', async (assert) => {
    const input = await enabled.handle(
      new Request(enabledURL + '_lattice-inputs', {
        method: 'QUERY',
        headers: {
          Accept: SupportedMimeType.CardJson,
          [LATTICE_INPUT_GENERATION_HEADER]: '1',
        },
        body: JSON.stringify({ urls: [enabledURL + 'root'] }),
      }),
    );
    if (!input) throw new Error('Missing enabled input response');
    assert.strictEqual(input.status, 200);
    assert.deepEqual((await input.json()).results[0].document.data.attributes, {
      value: 7,
    });
    assert.ok(
      latticeSQL().length,
      'enabled input protocol executes its guarded read',
    );
    assert.strictEqual(
      (
        await read(enabled, 'root', {
          [LATTICE_INPUT_GENERATION_HEADER]: '999',
        })
      ).status,
      409,
    );
    await db.execute(
      `UPDATE boxel_index SET has_error=true,error_doc=$1 WHERE realm_url=$2 AND file_alias=$3`,
      {
        bind: [
          JSON.stringify({
            status: 422,
            message: 'Synthetic source error',
            title: 'Invalid value',
            additionalErrors: null,
          }),
          ordinaryURL,
          ordinaryURL + 'root',
        ],
      },
    );
    statements = [];
    assert.strictEqual((await read(ordinary)).status, 422);
    assert.strictEqual((await read(ordinary, 'missing')).status, 404);
    assert.deepEqual(
      latticeSQL(),
      [],
      'an earlier enabled read does not leak into ordinary errors',
    );
  });
});
