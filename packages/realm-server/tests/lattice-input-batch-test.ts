import { latticeDemandFor } from '@cardstack/runtime-common/lattice-demand';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { captureLatticeInputArtifacts } from '@cardstack/runtime-common/lattice-input-artifacts';
import QUnit from 'qunit';
import request from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { dirSync, type DirResult } from 'tmp';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CardError,
  isCardError,
  SupportedMimeType,
  VirtualNetwork,
  IndexWriter,
  CachingDefinitionLookup,
  MatrixClient,
  type QueuePublisher,
  rri,
  ri,
  param,
  Deferred,
  type Realm,
} from '@cardstack/runtime-common';
import { loadCardDocument } from '@cardstack/runtime-common/document';
import {
  latticeBrowserInputCapture,
  assertLatticeInputAuthority,
} from '@cardstack/runtime-common/lattice-browser-inputs';
import {
  LatticeInputResidency,
  type LatticeResidentInput,
} from '@cardstack/runtime-common/lattice-input-residency';
import {
  isLatticeDisplayReuse,
  LATTICE_DISPLAY_HAVE_HEADER,
  latticeDisplayBatchRequest,
  latticeDisplayBatchResults,
} from '@cardstack/runtime-common/lattice-display';
import {
  LATTICE_INPUT_GENERATION_HEADER,
  type LatticeInputSnapshot,
} from '@cardstack/runtime-common/lattice-materialization';
import {
  createJWT,
  createRealm,
  getTestPrerenderer,
  makeTestReconciler,
  setupDB,
  stopTestPrerenderServer,
  testCreatePrerenderAuth,
} from './helpers/index.ts';
import { RealmServer } from '../server.ts';

const { module, test } = QUnit;

module('lattice-input-batch-test.ts | inputs', function (hooks) {
  let realm: Realm;
  let db: PgAdapter;
  let queue: QueuePublisher;
  let definitions: CachingDefinitionLookup;
  let snapshot: LatticeInputSnapshot;
  let network = new VirtualNetwork();
  let requests: Request[];
  let fetch: typeof globalThis.fetch;
  let dir: DirResult;

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher) => {
      db = dbAdapter;
      queue = publisher;
      dir = dirSync({ unsafeCleanup: true });
      let realmURL = ri('http://127.0.0.1:4444/lattice-inputs/');
      // Exercise real serving/auth against committed index rows. This test
      // does not need a source-indexing worker or a Matrix login to build them.
      let batch = await new IndexWriter(db, {
        lattice: new LatticeRealmConfig([realmURL]),
      }).createBatch(new URL(realmURL), network);
      let resource = {
        id: rri(realmURL + 'person-1'),
        type: 'card' as const,
        attributes: { firstName: 'Mango' },
        meta: {
          adoptsFrom: { module: rri(realmURL + 'person'), name: 'Person' },
          realmURL,
          lastModified: 1234,
        },
      };
      await batch.updateEntry(new URL(realmURL + 'person-1.json'), {
        type: 'instance',
        resource,
        searchData: { firstName: 'Mango' },
        types: [realmURL + 'person/Person'],
        displayNames: ['Person'],
        deps: new Set(),
        lastModified: 1,
        resourceCreatedAt: 1,
      });
      await batch.done();
      definitions = new CachingDefinitionLookup(
        db,
        await getTestPrerenderer(),
        network,
        testCreatePrerenderAuth,
      );
      ({ realm } = await createRealm({
        lattice: new LatticeRealmConfig([realmURL]),
        dir: dir.name,
        realmURL,
        dbAdapter: db,
        publisher,
        virtualNetwork: network,
        fileSystem: { 'person-1.json': { data: resource } },
        permissions: { reader: ['read'] },
        definitionLookup: definitions,
      }));
      await realm.start();
    },
    afterEach: async () => {
      realm?.unsubscribe();
      dir?.removeCallback();
    },
  });
  hooks.after(async () => {
    await stopTestPrerenderServer();
  });
  hooks.beforeEach(async () => {
    let [row] = await db.execute(
      'SELECT current_generation FROM realm_generations WHERE realm_url=$1',
      { bind: [realm.url] },
    );
    snapshot = {
      realmURL: realm.url,
      generation: Number(row.current_generation),
    };
    requests = [];
    fetch = async (input, init) => {
      let request = new Request(input, init);
      request.headers.set(
        'Authorization',
        `Bearer ${createJWT(realm, 'reader', ['read'])}`,
      );
      requests.push(request.clone());
      let response = await realm.handle(request);
      if (!response) throw new Error('Fixture request escaped its realm');
      return response;
    };
  });

  function load(path: string, via = fetch, revision = snapshot) {
    return loadCardDocument(via, realm.url + path, network, revision);
  }

  test('starts a read batch when prerendering forbids timers', async (assert) => {
    let setTimeout = globalThis.setTimeout;
    let reads: ReturnType<typeof load>[];
    try {
      globalThis.setTimeout = (() => {
        throw new Error('Prerender timers are disabled');
      }) as unknown as typeof globalThis.setTimeout;
      reads = [load('person-1'), load('missing')];
    } finally {
      globalThis.setTimeout = setTimeout;
    }
    let [card, missing] = await Promise.all(reads);
    assert.notOk(isCardError(card));
    assert.strictEqual((missing as CardError).status, 404);
    assert.strictEqual(requests.length, 1);
  });

  test('explicit Chrome capture receives fresh full and Have row receipts outside card data', async (assert) => {
    const [generation] = await db.execute(
      'SELECT loader_epoch FROM realm_generations WHERE realm_url=$1',
      { bind: [realm.url] },
    );
    const retained = {
      ...snapshot,
      retainLinks: true as const,
      loaderEpoch: String(generation.loader_epoch),
    };
    const sourceURL = realm.url + 'person-1';
    const ownerURL = realm.url + 'owner';
    const edges = [{ ownerURL, fieldPath: 'person', sourceURL }];
    const first = await load('person-1', fetch, retained);
    assert.notOk(isCardError(first));
    assert.false(
      JSON.stringify(first).includes('rowVersion'),
      'receipt is not authored/serialized card data',
    );
    const capture = latticeBrowserInputCapture(retained, ownerURL, edges);
    assert.strictEqual(capture.inputs.length, 1);
    assert.strictEqual(capture.authority?.actor, 'reader');
    assert.strictEqual(capture.inputs[0].validatedThrough, snapshot.generation);
    assert.ok(capture.inputs[0].rowVersion);
    await db.withConnection(async (tx) => {
      await tx(['BEGIN']);
      try {
        await assertLatticeInputAuthority(tx, capture.authority!);
      } finally {
        await tx(['ROLLBACK']);
      }
    });
    const reused = { ...retained };
    await load('person-1', fetch, reused);
    assert.strictEqual((await requests.at(-1)!.json()).have.length, 1);
    assert.deepEqual(
      latticeBrowserInputCapture(reused, ownerURL, edges),
      capture,
    );
    assert.throws(
      () => latticeBrowserInputCapture({ ...retained }, ownerURL, edges),
      /no validated/,
      "a new render cannot use another render's receipts",
    );
    await db.execute(
      "UPDATE realm_user_permissions SET read=FALSE WHERE realm_url=$1 AND username='reader'",
      { bind: [realm.url] },
    );
    await assert.rejects(
      db.withConnection((tx) =>
        assertLatticeInputAuthority(tx, capture.authority!),
      ),
      /authority.*current/,
    );
  });

  test('ordinary input replies omit receipts and missing capture metadata cannot be trusted', async (assert) => {
    const original = await fetch(new URL('_lattice-inputs', realm.url), {
      method: 'QUERY',
      headers: {
        Accept: SupportedMimeType.CardJson,
        [LATTICE_INPUT_GENERATION_HEADER]: String(snapshot.generation),
      },
      body: JSON.stringify({ urls: [realm.url + 'person-1'] }),
    });
    const payload = await original.json();
    assert.false('authority' in payload);
    assert.false('receipt' in payload.results[0]);
    const [row] = await db.execute(
      'SELECT loader_epoch FROM realm_generations WHERE realm_url=$1',
      { bind: [realm.url] },
    );
    const noReceipt: typeof fetch = async (url, init) => {
      const response = await fetch(url, init);
      const body = await response.json();
      delete body.authority;
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const result = await load('person-1', noReceipt, {
      ...snapshot,
      retainLinks: true,
      loaderEpoch: String(row.loader_epoch),
    });
    assert.true(isCardError(result));
    if (isCardError(result))
      assert.true(
        result.message.includes('Invalid Lattice retained input receipt'),
      );
  });

  test('a missing batch endpoint is a transport failure, not proof that every requested card is missing', async (assert) => {
    let unavailable = true;
    let attempts = 0;
    const via: typeof fetch = async (input, init) => {
      attempts++;
      if (unavailable) {
        return Response.json(
          {
            errors: [
              {
                status: 404,
                message: 'Input endpoint not found',
                additionalErrors: null,
              },
            ],
          },
          { status: 404 },
        );
      }
      return fetch(input, init);
    };
    const failed = await Promise.all([
      load('person-1', via),
      load('missing', via),
    ]);
    assert.strictEqual(attempts, 1, 'one actual batch transport failed');
    assert.deepEqual(
      failed.map((value) => (isCardError(value) ? value.status : null)),
      [502, 502],
      'the failed endpoint supplies no authoritative per-card absence',
    );
    unavailable = false;
    const recovered = await Promise.all([
      load('person-1', via),
      load('missing', via),
    ]);
    assert.strictEqual(attempts, 2, 'failed inputs are retried');
    assert.notOk(isCardError(recovered[0]), 'the existing card recovers');
    assert.strictEqual(
      (recovered[1] as CardError).status,
      404,
      'a successful batch can confirm the absent card',
    );
  });

  test('real server preflight permits display inventory without starting Matrix or indexing', async (assert) => {
    let server = new RealmServer({
      serverURL: new URL(new URL(realm.url).origin),
      realms: [realm],
      reconciler: makeTestReconciler(db, [realm]),
      virtualNetwork: network,
      matrixClient: new MatrixClient({
        matrixURL: new URL('http://matrix.unused/'),
        username: 'unused',
        seed: 'test',
      }),
      realmServerSecretSeed: 'test',
      realmSecretSeed: 'test',
      grafanaSecret: 'test',
      realmsRootPath: dir.name,
      dbAdapter: db,
      queue,
      definitionLookup: definitions,
      assetsURL: new URL('http://assets.unused/'),
      matrixRegistrationSecret: 'test',
      getIndexHTML: async () => {
        throw new Error('Preflight cannot load the app');
      },
    });
    let response = await request(server.app.callback())
      .options('/lattice-inputs/person-1')
      .set('Origin', 'http://client.example')
      .set('Access-Control-Request-Method', 'GET')
      .set(
        'Access-Control-Request-Headers',
        'x-boxel-lattice-have, x-boxel-lattice-priority, authorization',
      );
    assert.strictEqual(response.status, 204);
    let allowed = (response.headers['access-control-allow-headers'] ?? '')
      .toLowerCase()
      .split(/,\s*/);
    assert.true(allowed.includes('x-boxel-lattice-have'));
    assert.true(allowed.includes('x-boxel-lattice-priority'));
    assert.true(allowed.includes('authorization'));
  });

  async function seedDisplayPublication() {
    let [{ loader_epoch: epoch }] = await db.execute(
      'SELECT loader_epoch FROM realm_generations WHERE realm_url=$1',
      { bind: [realm.url] },
    );
    let url = realm.url + 'person-1';
    let attributes = { firstName: 'Mango', notes: 'x'.repeat(250_000) };
    let stamp = {
      version: 1,
      state: 'ready',
      computedFields: ['firstName'],
      queryFields: [],
      watches: [],
      validatedThrough: snapshot.generation - 1,
      outputRevision: snapshot.generation,
      definitionRevision: epoch,
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
          param(url + '.json'),
          `AND type='instance'`,
        ]);
        await captureLatticeInputArtifacts(tx, realm.url, [url + '.json']);
        await tx(['COMMIT']);
      } catch (error) {
        await tx(['ROLLBACK']);
        throw error;
      }
    });
    await db.execute(
      `INSERT INTO lattice_owners (realm_url,owner_url,published_generation,input_generation,definition_revision,attributes_generation,attributes_json)
       VALUES ($1,$2,$3,$4,$5,$3,$6)`,
      {
        bind: [
          realm.url,
          url + '.json',
          snapshot.generation,
          stamp.validatedThrough,
          epoch,
          JSON.stringify(attributes),
        ],
      },
    );
    return { url, attributes };
  }

  test('display reuse transfers freshness without a body and repairs changed inventory', async (assert) => {
    let { url, attributes } = await seedDisplayPublication();
    let read = (token?: string) =>
      fetch(url, {
        headers: {
          Accept: SupportedMimeType.CardJson,
          ...(token ? { [LATTICE_DISPLAY_HAVE_HEADER]: token } : {}),
        },
      });
    let initial = await read();
    assert.strictEqual(initial.status, 200);
    let doc = await initial.json();
    assert.deepEqual(doc.data.attributes, attributes);
    let token = doc.data.meta.publication!.have;
    assert.strictEqual(typeof token, 'string');
    const savedHave = token;
    for (let pending of [false, true, false]) {
      await db.execute(
        'UPDATE lattice_owners SET dirty_generation=$1 WHERE realm_url=$2',
        {
          bind: [pending ? snapshot.generation + 1 : null, realm.url],
        },
      );
      let response = await read(token);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('cache-control'), 'no-store');
      let text = await response.text();
      let reply = JSON.parse(text);
      assert.true(
        isLatticeDisplayReuse(reply),
        'distinct protocol envelope, never a sparse card',
      );
      assert.strictEqual(reply.lattice.token, token);
      assert.strictEqual(reply.lattice.state, pending ? 'pending' : 'ready');
      assert.true(
        text.length < 1_000,
        'freshness does not transfer the 250 KB body',
      );
    }
    attributes.firstName = 'Changed';
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes}',$1::jsonb) WHERE url=$2 AND type='instance'`,
      { bind: [JSON.stringify(attributes), url + '.json'] },
    );
    await db.execute(
      'UPDATE lattice_owners SET attributes_json=$1 WHERE realm_url=$2',
      {
        bind: [JSON.stringify(attributes), realm.url],
      },
    );
    let changed = await (await read(token)).json();
    assert.deepEqual(
      changed.data.attributes,
      attributes,
      'body edits at the same generation cannot reuse',
    );
    assert.notStrictEqual(changed.data.meta.publication!.have, token);
    token = changed.data.meta.publication!.have;
    await db.execute(
      'UPDATE realm_generations SET loader_epoch=$1 WHERE realm_url=$2',
      { bind: ['changed-code', realm.url] },
    );
    let codeChanged = await (await read(token)).json();
    assert.notOk(
      isLatticeDisplayReuse(codeChanged),
      'changed code requires a complete read',
    );
    assert.strictEqual(codeChanged.data.meta.publication.state, 'pending');
    let denied = await realm.handle(
      new Request(url, {
        headers: {
          Accept: SupportedMimeType.CardJson,
          [LATTICE_DISPLAY_HAVE_HEADER]: token,
        },
      }),
    );
    assert.strictEqual(
      denied?.status,
      401,
      'Have never bypasses authorization',
    );
    assert.strictEqual(
      (await read('lattice-input-v1:' + 'a'.repeat(64))).status,
      400,
      'computation inventory is not display inventory',
    );
    await db.execute('DELETE FROM lattice_input_artifacts WHERE realm_url=$1', {
      bind: [realm.url],
    });
    // A migrated receipt can contain historical inventory. Without a current
    // physical artifact the server must not advertise that token again.
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication,have}',to_jsonb($1::text)) WHERE url=$2",
      { bind: [savedHave, url + '.json'] },
    );
    let missingArtifact = await (
      await read(codeChanged.data.meta.publication!.have)
    ).json();
    assert.deepEqual(
      missingArtifact.data.attributes,
      attributes,
      'missing artifact falls back to a body',
    );
    assert.strictEqual(missingArtifact.data.meta.publication!.have, undefined);
  });

  test('only successful foreground display reads register demand', async (assert) => {
    const { url } = await seedDisplayPublication();
    const demand = latticeDemandFor(db).cache;
    const body = JSON.stringify({
      version: 1,
      session: 'demand',
      epoch: 1,
      required: [url, realm.url + 'missing'],
      have: [],
    });
    await fetch(realm.url + '_lattice-read', {
      method: 'QUERY',
      headers: {
        Accept: SupportedMimeType.CardJson,
        'x-boxel-during-prerender': 'true',
      },
      body,
    });
    assert.strictEqual(
      demand.priorities(realm.url).size,
      0,
      'internal reads create no viewer interest',
    );
    await fetch(realm.url + '_lattice-read', {
      method: 'QUERY',
      headers: {
        Accept: SupportedMimeType.CardJson,
        'x-boxel-lattice-priority': 'immediate',
      },
      body,
    });
    assert.deepEqual(
      [...demand.priorities(realm.url)],
      [[url + '.json', 2]],
      'only the existing authorized owner is promoted',
    );
  });

  test('Lattice display batches return exact required coverage and preserve stored bodies', async (assert) => {
    let { url, attributes } = await seedDisplayPublication();
    let required = [url, realm.url + 'missing'];
    let body = {
      version: 1,
      session: 'display-client',
      epoch: 2,
      required,
      have: [] as Array<{ url: string; token: string }>,
    };
    let read = () =>
      fetch(realm.url + '_lattice-read', {
        method: 'QUERY',
        headers: { Accept: SupportedMimeType.CardJson },
        body: JSON.stringify(body),
      });
    let response = await read();
    assert.strictEqual(response.status, 200, await response.clone().text());
    let full = await response.json();
    assert.strictEqual(response.headers.get('cache-control'), 'no-store');
    assert.strictEqual(response.headers.get('x-boxel-realm-url'), realm.url);
    assert.deepEqual(
      full.results.map((entry: { url: string }) => entry.url),
      required,
    );
    assert.strictEqual(full.session, body.session);
    assert.strictEqual(full.epoch, body.epoch);
    assert.deepEqual(full.results[0].publication.data.attributes, attributes);
    assert.strictEqual(
      full.results[1].error.status,
      404,
      'an absent source is explicit',
    );
    let token = full.results[0].publication.data.meta.publication!.have;
    body.have = [{ url, token }];
    for (let pending of [false, true, false]) {
      await db.execute(
        'UPDATE lattice_owners SET dirty_generation=$1 WHERE realm_url=$2',
        {
          bind: [pending ? snapshot.generation + 1 : null, realm.url],
        },
      );
      let text = await (await read()).text();
      let result = JSON.parse(text);
      assert.true(isLatticeDisplayReuse(result.results[0].publication));
      assert.strictEqual(
        result.results[0].publication.lattice.state,
        pending ? 'pending' : 'ready',
      );
      assert.strictEqual(result.results[1].error.status, 404);
      assert.true(
        text.length < 2000,
        'matching inventory omits the wide stored body',
      );
    }
  });

  test('Lattice display batch serving does not decode wide attributes or load definitions', async (assert) => {
    let { url, attributes } = await seedDisplayPublication();
    let parse = JSON.parse;
    let lookup = definitions.lookupDefinition;
    let lookupForRealm = definitions.lookupDefinitionForRealm;
    let lookupCached = definitions.lookupCachedDefinition;
    let wideParses = 0;
    let definitionLoads = 0;
    JSON.parse = (text, ...args) => {
      if (text.includes(attributes.notes)) wideParses++;
      return parse(text, ...args);
    };
    let rejectDefinitionRead = async () => {
      definitionLoads++;
      throw new Error('Display reads cannot load definitions');
    };
    definitions.lookupDefinition = rejectDefinitionRead;
    definitions.lookupDefinitionForRealm = rejectDefinitionRead;
    definitions.lookupCachedDefinition = rejectDefinitionRead;
    let responseText: string;
    try {
      let response = await fetch(realm.url + '_lattice-read', {
        method: 'QUERY',
        headers: { Accept: SupportedMimeType.CardJson },
        body: JSON.stringify({
          version: 1,
          session: 'bytes',
          epoch: 1,
          required: [url],
          have: [],
        }),
      });
      assert.strictEqual(response.status, 200);
      responseText = await response.text();
    } finally {
      JSON.parse = parse;
      definitions.lookupDefinition = lookup;
      definitions.lookupDefinitionForRealm = lookupForRealm;
      definitions.lookupCachedDefinition = lookupCached;
    }
    assert.strictEqual(
      wideParses,
      0,
      'the serving path never parses the stored attribute text',
    );
    assert.strictEqual(definitionLoads, 0);
    assert.deepEqual(
      JSON.parse(responseText!).results[0].publication.data.attributes,
      attributes,
    );
  });

  test('Lattice display batches bound in-flight reads without stalling behind a slow peer', async (assert) => {
    let required = Array.from(
      { length: 6 },
      (_, i) => realm.url + `missing-${i}`,
    );
    let execute = db.execute.bind(db);
    let fourStarted = new Deferred<void>();
    let fiveStarted = new Deferred<void>();
    let gates: Deferred<void>[] = [];
    let active = 0;
    let peak = 0;
    let hold = true;
    db.execute = async (sql, opts) => {
      if (!sql.includes('reuse.matches AS reuse')) return execute(sql, opts);
      let gate = new Deferred<void>();
      gates.push(gate);
      peak = Math.max(peak, ++active);
      if (gates.length === 4) fourStarted.fulfill();
      if (gates.length === 5) fiveStarted.fulfill();
      if (!hold) gate.fulfill();
      try {
        await gate.promise;
        return await execute(sql, opts);
      } finally {
        active--;
      }
    };
    let read = fetch(realm.url + '_lattice-read', {
      method: 'QUERY',
      headers: { Accept: SupportedMimeType.CardJson },
      body: JSON.stringify({
        version: 1,
        session: 'bounded',
        epoch: 1,
        required,
        have: [],
      }),
    });
    try {
      await fourStarted.promise;
      assert.strictEqual(active, 4);
      gates[0].fulfill();
      await fiveStarted.promise;
      assert.strictEqual(
        active,
        4,
        'one finished identity releases capacity immediately',
      );
      hold = false;
      for (let gate of gates) gate.fulfill();
      let response = await read;
      let results = await response.json();
      assert.strictEqual(peak, 4);
      assert.deepEqual(
        results.results.map((entry: { url: string }) => entry.url),
        required,
        'the response retains exact request order',
      );
    } finally {
      hold = false;
      for (let gate of gates) gate.fulfill();
      await read;
      db.execute = execute;
    }
  });

  test('Lattice display batch failures preserve successful peers and never masquerade as deletion', async (assert) => {
    let { url, attributes } = await seedDisplayPublication();
    let broken = realm.url + 'broken';
    let execute = db.execute.bind(db);
    let failureStatus = 404;
    db.execute = async (sql, opts) => {
      if (
        sql.includes('reuse.matches AS reuse') &&
        opts?.bind?.includes(broken)
      ) {
        throw new CardError('A required read failed', {
          status: failureStatus,
        });
      }
      return execute(sql, opts);
    };
    try {
      for (let status of [404, 503]) {
        failureStatus = status;
        let request = latticeDisplayBatchRequest(
          {
            version: 1,
            session: 'failure',
            epoch: 1,
            required: [url, broken],
            have: [],
          },
          realm.url,
        );
        let response = await fetch(realm.url + '_lattice-read', {
          method: 'QUERY',
          headers: { Accept: SupportedMimeType.CardJson },
          body: JSON.stringify(request),
        });
        assert.strictEqual(response.status, 200);
        let results = latticeDisplayBatchResults(
          await response.json(),
          request,
        );
        let good = results.get(url)!;
        assert.true('publication' in good);
        if ('publication' in good && 'data' in good.publication) {
          assert.deepEqual(good.publication.data.attributes, attributes);
        }
        assert.deepEqual(results.get(broken), {
          url: broken,
          error: {
            status: status === 404 ? 422 : status,
            message: 'A required read failed',
          },
        });
      }
    } finally {
      db.execute = execute;
    }
  });

  test('Lattice display batches authorize inventory and reject invalid required sets', async (assert) => {
    let { url } = await seedDisplayPublication();
    let initial = await (
      await fetch(url, { headers: { Accept: SupportedMimeType.CardJson } })
    ).json();
    let body = {
      version: 1,
      session: 'display-client',
      epoch: 2,
      required: [url],
      have: [{ url, token: initial.data.meta.publication!.have }],
    };
    let denied = await realm.handle(
      new Request(realm.url + '_lattice-read', {
        method: 'QUERY',
        headers: { Accept: SupportedMimeType.CardJson },
        body: JSON.stringify(body),
      }),
    );
    assert.strictEqual(
      denied?.status,
      401,
      'a valid Have token does not grant read access',
    );
    let invalid = [
      { ...body, version: 2 },
      { ...body, session: '' },
      { ...body, epoch: -1 },
      { ...body, epoch: 0.5 },
      { ...body, required: [] },
      {
        ...body,
        required: Array.from({ length: 17 }, (_, i) => realm.url + i),
      },
      { ...body, required: [url, url] },
      { ...body, required: [url + '.json'] },
      { ...body, required: [url + '?query=1'] },
      { ...body, required: [url + '#fragment'] },
      { ...body, required: [realm.url + '_search'] },
      { ...body, required: ['http://foreign.example/person'] },
      {
        ...body,
        have: [{ url: realm.url + 'unrequested', token: body.have[0].token }],
      },
      { ...body, have: [{ url, token: 'lattice-input-v1:' + 'a'.repeat(64) }] },
      { ...body, have: [body.have[0], body.have[0]] },
    ];
    for (let payload of invalid) {
      let response = await fetch(realm.url + '_lattice-read', {
        method: 'QUERY',
        headers: { Accept: SupportedMimeType.CardJson },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(response.status, 400, JSON.stringify(payload));
    }
    for (let text of ['{', ' '.repeat(64 * 1024 + 1)]) {
      let response = await fetch(realm.url + '_lattice-read', {
        method: 'QUERY',
        headers: { Accept: SupportedMimeType.CardJson },
        body: text,
      });
      assert.strictEqual(
        response.status,
        400,
        'malformed/oversized JSON is rejected',
      );
    }
  });

  test('Lattice display batches distinguish unavailable artifacts from deleted sources', async (assert) => {
    let required = [
      realm.url + 'person-1',
      realm.url + 'not-indexed',
      realm.url + 'missing',
    ];
    await writeFile(join(dir.name, 'not-indexed.json'), '{}');
    let request = {
      version: 1,
      session: 'display-client',
      epoch: 3,
      required,
      have: [],
    };
    let response = await fetch(realm.url + '_lattice-read', {
      method: 'QUERY',
      headers: { Accept: SupportedMimeType.CardJson },
      body: JSON.stringify(request),
    });
    assert.strictEqual(response.status, 200);
    let results = latticeDisplayBatchResults(
      await response.json(),
      latticeDisplayBatchRequest(request, realm.url),
    );
    assert.deepEqual(
      [...results.values()].map((entry) =>
        'error' in entry ? entry.error.status : 'unexpected publication',
      ),
      [409, 409, 404],
    );
  });

  async function batchRequest(
    urls: unknown,
    generation: number | undefined = snapshot.generation,
    have?: unknown,
  ) {
    return fetch(realm.url + '_lattice-inputs', {
      method: 'QUERY',
      headers: {
        Accept: SupportedMimeType.CardJson,
        ...(generation === undefined
          ? {}
          : { [LATTICE_INPUT_GENERATION_HEADER]: String(generation) }),
      },
      body: JSON.stringify({ urls, ...(have === undefined ? {} : { have }) }),
    });
  }

  test('coalesces independent reads and aliases with GET-equivalent values and isolated documents', async (assert) => {
    let [first, alias, missing] = await Promise.all([
      load('person-1'),
      load('person-1.json'),
      load('missing'),
    ]);
    assert.strictEqual(requests.length, 1, 'one authenticated request');
    assert.deepEqual(await requests[0].json(), {
      urls: [realm.url + 'person-1', realm.url + 'missing'],
    });
    assert.true(isCardError(missing));
    assert.strictEqual((missing as CardError).status, 404);
    if (isCardError(first) || isCardError(alias))
      throw new Error('Expected fixture card');
    let response = await fetch(realm.url + 'person-1', {
      headers: {
        Accept: SupportedMimeType.CardJson,
        [LATTICE_INPUT_GENERATION_HEADER]: String(snapshot.generation),
      },
    });
    let single = await response.json();
    single.data.meta.realmURL = response.headers.get('x-boxel-realm-url');
    single.data.meta.lastModified = Date.parse(
      response.headers.get('last-modified')!,
    );
    assert.deepEqual(
      first,
      single,
      'all fields, links, generations and metadata match the single input read',
    );
    assert.notStrictEqual(first, alias);
    first.data.attributes!.testMutation = 'only this reader';
    assert.notPropContains(alias.data.attributes!, {
      testMutation: 'only this reader',
    });
    assert.notOk(first.included, 'input reads do not expand the graph');
  });

  for (const absentIndex of ['missing row', 'tombstone'] as const) {
    test(`source existence distinguishes an unindexed card from deletion (${absentIndex})`, async (assert) => {
      const path = join(dir.name, 'person-1.json');
      const source = await readFile(path);
      await db.execute(
        absentIndex === 'missing row'
          ? 'DELETE FROM boxel_index WHERE url=$1'
          : 'UPDATE boxel_index SET is_deleted=TRUE WHERE url=$1',
        { bind: [realm.url + 'person-1.json'] },
      );
      const pending = await load('person-1');
      assert.true(
        isCardError(pending),
        'unindexed source is not a complete input',
      );
      assert.strictEqual(
        (pending as CardError).status,
        409,
        'existing source defers computation',
      );
      await unlink(path);
      const missing = await load('person-1');
      assert.strictEqual(
        (missing as CardError).status,
        404,
        'removed source confirms absence',
      );
      await writeFile(path, source);
      const restored = await load('person-1');
      assert.strictEqual(
        (restored as CardError).status,
        409,
        'restored source is pending until indexed',
      );
      assert.deepEqual(
        (restored as CardError).deps,
        [realm.url + 'person-1'],
        'retry retains the target identity',
      );
    });
  }

  test('a stored indexing failure with a 404 cause is not an absent card', async (assert) => {
    await db.execute(
      'UPDATE boxel_index SET has_error=TRUE,error_doc=$1 WHERE url=$2',
      {
        bind: [
          JSON.stringify({
            message: 'Dependency module not found',
            status: 404,
            additionalErrors: null,
          }),
          realm.url + 'person-1.json',
        ],
      },
    );
    const failure = await load('person-1');
    assert.true(isCardError(failure), 'failed indexed input remains an error');
    assert.strictEqual(
      (failure as CardError).status,
      422,
      'an indexing failure cannot become a confirmed missing slot',
    );
    const response = await batchRequest([realm.url + 'person-1']);
    const { results } = await response.json();
    assert.notOk(results[0].document, 'failed input has no complete document');
    assert.notOk(results[0].token, 'failed input has no Have token');
    const [row] = await db.execute(
      'SELECT error_doc FROM boxel_index WHERE url=$1',
      { bind: [realm.url + 'person-1.json'] },
    );
    assert.strictEqual(
      (row.error_doc as { status: number }).status,
      404,
      'the original indexing diagnostic is preserved',
    );
  });

  test('source errors and absent identities stay distinct and failures are not cached', async (assert) => {
    let [original] = await db.execute(
      'SELECT pristine_doc FROM boxel_index WHERE url=$1',
      {
        bind: [realm.url + 'person-1.json'],
      },
    );
    await db.execute(
      'UPDATE boxel_index SET has_error=true,error_doc=$1 WHERE url=$2',
      {
        bind: [
          JSON.stringify({
            message: 'Synthetic broken input',
            status: 422,
            additionalErrors: null,
          }),
          realm.url + 'person-1.json',
        ],
      },
    );
    let [broken, missing] = await Promise.all([
      load('person-1'),
      load('missing'),
    ]);
    assert.strictEqual((broken as CardError).status, 422);
    assert.strictEqual((missing as CardError).status, 404);
    assert.deepEqual((broken as CardError).deps, [realm.url + 'person-1']);
    await db.execute(
      'UPDATE boxel_index SET has_error=false,error_doc=NULL,pristine_doc=$1 WHERE url=$2',
      {
        bind: [
          JSON.stringify(original.pristine_doc),
          realm.url + 'person-1.json',
        ],
      },
    );
    assert.notOk(
      isCardError(await load('person-1')),
      'retry reads the repaired committed card',
    );
    assert.strictEqual(requests.length, 2);
  });

  test('Lattice verifies resident inputs across generations without decoding their bodies in Node', async (assert) => {
    let first = await load('person-1');
    if (isCardError(first)) throw first;
    first.data.attributes!.firstName = 'Private local edit';
    await db.execute(
      'UPDATE realm_generations SET current_generation=current_generation+1 WHERE realm_url=$1',
      { bind: [realm.url] },
    );
    let execute = db.execute;
    let projected: Record<string, unknown>[] = [];
    db.execute = async (sql, options) => {
      let rows = await execute.call(db, sql, options);
      if (sql.includes('AS lattice_token')) projected.push(...rows);
      return rows;
    };
    let second;
    try {
      second = await load('person-1.json', fetch, {
        ...snapshot,
        generation: snapshot.generation + 1,
      });
    } finally {
      db.execute = execute;
    }
    if (isCardError(second)) throw second;
    assert.strictEqual(
      requests.length,
      2,
      'reuse still requires authorization and a revision check',
    );
    let request = await requests[1].json();
    assert.deepEqual(request.urls, [realm.url + 'person-1']);
    assert.strictEqual(request.have.length, 1);
    assert.strictEqual(
      second.data.attributes!.firstName,
      'Mango',
      'local mutations never enter the confirmed cache',
    );
    assert.strictEqual(projected.length, 1);
    assert.true(projected[0].lattice_reuse);
    assert.strictEqual(
      projected[0].pristine_doc,
      null,
      'the pg driver never receives the reusable JSONB body',
    );
    assert.notOk((projected[0].lattice_resource as any).attributes);
  });

  test('Lattice tokens cover changed content, module epochs and identity', async (assert) => {
    let first = (await (await batchRequest([realm.url + 'person-1'])).json())
      .results[0];
    let have = [{ url: first.url, token: first.token }];
    let reused = (
      await (await batchRequest([first.url], snapshot.generation, have)).json()
    ).results[0];
    assert.deepEqual(reused, {
      url: first.url,
      token: first.token,
      reuse: true,
    });
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,firstName}','"Updated"') WHERE url=$1`,
      { bind: [realm.url + 'person-1.json'] },
    );
    let changed = (
      await (await batchRequest([first.url], snapshot.generation, have)).json()
    ).results[0];
    assert.strictEqual(changed.document.data.attributes.firstName, 'Updated');
    assert.notEqual(
      changed.token,
      first.token,
      'even a body change without a generation increment cannot reuse old data',
    );
    assert.strictEqual(
      changed.token,
      undefined,
      'an older writer cannot issue a fresh receipt',
    );
    await publishPerson('Updated');
    changed = (await (await batchRequest([first.url])).json()).results[0];
    assert.ok(changed.token, 'enabled publication restores reusable inventory');
    await db.execute(
      'UPDATE realm_generations SET loader_epoch=$1 WHERE realm_url=$2',
      { bind: [globalThis.crypto.randomUUID(), realm.url] },
    );
    let moduleChanged = (
      await (
        await batchRequest([first.url], snapshot.generation, [
          { url: first.url, token: changed.token },
        ])
      ).json()
    ).results[0];
    assert.ok(moduleChanged.document);
    assert.notEqual(
      moduleChanged.token,
      changed.token,
      'module invalidation revokes representation reuse',
    );
    let foreign = await batchRequest([first.url], snapshot.generation, [
      { url: realm.url + 'another-card', token: moduleChanged.token },
    ]);
    assert.strictEqual(
      foreign.status,
      400,
      'inventory is constrained to requested identities',
    );
  });

  test('Lattice never hides errors or deletions behind resident values', async (assert) => {
    assert.notOk(isCardError(await load('person-1')));
    await db.execute(
      'UPDATE boxel_index SET has_error=true,error_doc=$1 WHERE url=$2',
      {
        bind: [
          JSON.stringify({
            message: 'Broken after caching',
            status: 422,
            additionalErrors: null,
          }),
          realm.url + 'person-1.json',
        ],
      },
    );
    let error = await load('person-1', fetch, { ...snapshot });
    assert.strictEqual((error as CardError).status, 422);
    await db.execute(
      'UPDATE boxel_index SET has_error=false,error_doc=NULL WHERE url=$1',
      { bind: [realm.url + 'person-1.json'] },
    );
    assert.notOk(isCardError(await load('person-1', fetch, { ...snapshot })));
    assert.notOk(
      (await requests[2].json()).have,
      'error evicts the advertised document',
    );
    await unlink(join(dir.name, 'person-1.json'));
    await db.execute('UPDATE boxel_index SET is_deleted=true WHERE url=$1', {
      bind: [realm.url + 'person-1.json'],
    });
    assert.strictEqual(
      ((await load('person-1', fetch, { ...snapshot })) as CardError).status,
      404,
    );
  });

  async function publishPerson(firstName: string) {
    let [row] = await db.execute(
      'SELECT pristine_doc FROM boxel_index WHERE url=$1',
      {
        bind: [realm.url + 'person-1.json'],
      },
    );
    let resource = row.pristine_doc as any;
    resource.attributes.firstName = firstName;
    let batch = await new IndexWriter(db, {
      lattice: new LatticeRealmConfig([realm.url]),
    }).createBatch(new URL(realm.url), network);
    await batch.updateEntry(new URL(realm.url + 'person-1.json'), {
      type: 'instance',
      resource,
      searchData: { firstName },
      types: [realm.url + 'person/Person'],
      displayNames: ['Person'],
      deps: new Set(),
      lastModified: 1,
      resourceCreatedAt: 1,
    });
    await batch.done();
    snapshot = { ...snapshot, generation: batch.currentGeneration };
  }

  test('absent artifacts serve the full body until enabled publication repairs inventory', async (assert) => {
    let url = realm.url + 'person-1.json';
    assert.notOk(isCardError(await load('person-1')));
    await db.execute('DELETE FROM lattice_input_artifacts WHERE url=$1', {
      bind: [url],
    });
    let loaded = await load('person-1');
    assert.notOk(
      isCardError(loaded),
      'a missing derived artifact still serves the actual body',
    );
    assert.notOk(isCardError(await load('person-1')));
    assert.notOk(
      (await requests.at(-1)!.json()).have,
      'missing artifact revokes the old inventory token',
    );
    await publishPerson('Repaired');
    let repaired = await load('person-1');
    if (isCardError(repaired)) throw repaired;
    assert.strictEqual(repaired.data.attributes!.firstName, 'Repaired');
    assert.notOk(isCardError(await load('person-1')));
    assert.ok(
      (await requests.at(-1)!.json()).have,
      'enabled publication repairs the inventory',
    );
    await unlink(join(dir.name, 'person-1.json'));
    await db.execute('DELETE FROM boxel_index WHERE url=$1', { bind: [url] });
    assert.strictEqual(
      ((await load('person-1')) as CardError).status,
      404,
      'an orphan artifact never hides source deletion',
    );
  });

  test('Lattice authorizes reuse and rejects unrequested or ambiguous reuse replies', async (assert) => {
    let mode: 'normal' | 'unauthorized' | 'wrong-token' | 'ambiguous' =
      'normal';
    let transport: typeof globalThis.fetch = async (input, init) => {
      if (mode === 'unauthorized')
        return (await realm.handle(new Request(input, init)))!;
      let response = await fetch(input, init);
      if (mode === 'normal') return response;
      let payload = await response.json();
      if (mode === 'wrong-token')
        payload.results[0].token = 'lattice-input-v1:' + '0'.repeat(64);
      if (mode === 'ambiguous')
        payload.results[0].error = {
          message: 'Conflicting variants',
          status: 500,
        };
      return new Response(JSON.stringify(payload));
    };
    assert.notOk(isCardError(await load('person-1', transport)));
    mode = 'unauthorized';
    assert.strictEqual(
      ((await load('person-1', transport, { ...snapshot })) as CardError)
        .status,
      401,
    );
    mode = 'normal';
    assert.notOk(isCardError(await load('person-1', transport)));
    mode = 'wrong-token';
    assert.strictEqual(
      ((await load('person-1', transport, { ...snapshot })) as CardError)
        .status,
      502,
    );
    mode = 'normal';
    assert.notOk(isCardError(await load('person-1', transport)));
    mode = 'ambiguous';
    assert.strictEqual(
      ((await load('person-1', transport, { ...snapshot })) as CardError)
        .status,
      502,
    );
    mode = 'normal';
    assert.notOk(
      isCardError(await load('person-1', transport)),
      'a failed exchange can recover with a fresh body',
    );
  });

  test('a pending materialized feeder is rejected, never consumed as a current value', async (assert) => {
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication}',$1) WHERE url=$2`,
      {
        bind: [
          JSON.stringify({
            version: 1,
            state: 'pending',
            computedFields: ['firstName'],
            queryFields: [],
            watches: [],
            validatedThrough: 0,
          }),
          realm.url + 'person-1.json',
        ],
      },
    );
    let result = await load('person-1');
    assert.true(isCardError(result));
    assert.strictEqual((result as CardError).status, 409);
  });

  test('Lattice checks feeder authority even when its stored body has not changed', async (assert) => {
    let [{ loader_epoch: epoch }] = await db.execute(
      'SELECT loader_epoch FROM realm_generations WHERE realm_url=$1',
      { bind: [realm.url] },
    );
    await db.withConnection(async (tx) => {
      await tx(['BEGIN']);
      try {
        await tx([
          `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication}',`,
          param(
            JSON.stringify({
              version: 1,
              state: 'ready',
              computedFields: ['firstName'],
              queryFields: [],
              watches: [],
              validatedThrough: snapshot.generation,
              outputRevision: snapshot.generation,
              definitionRevision: epoch,
            }),
          ),
          `::jsonb) WHERE url=`,
          param(realm.url + 'person-1.json'),
        ]);
        await captureLatticeInputArtifacts(tx, realm.url, [
          realm.url + 'person-1.json',
        ]);
        await tx(['COMMIT']);
      } catch (error) {
        await tx(['ROLLBACK']);
        throw error;
      }
    });
    await db.execute(
      `INSERT INTO lattice_owners (realm_url,owner_url,published_generation,input_generation,definition_revision)
       VALUES ($1,$2,$3,$3,$4)`,
      {
        bind: [
          realm.url,
          realm.url + 'person-1.json',
          snapshot.generation,
          epoch,
        ],
      },
    );
    assert.notOk(isCardError(await load('person-1')));
    let reused = await load('person-1');
    assert.notOk(isCardError(reused), 'a ready feeder can be reused');
    for (let state of ['dirty', 'retired', 'unmatched'] as const) {
      if (state === 'unmatched') {
        await db.execute(
          'INSERT INTO lattice_pending_generations (realm_url,generation,definition_revision) VALUES ($1,$2,$3)',
          { bind: [realm.url, snapshot.generation, epoch] },
        );
      } else {
        await db.execute(
          'UPDATE lattice_owners SET dirty_generation=$1,retired=$2 WHERE realm_url=$3',
          {
            bind: [
              state === 'dirty' ? snapshot.generation : null,
              state === 'retired',
              realm.url,
            ],
          },
        );
      }
      let pending = await load('person-1');
      assert.strictEqual(
        (pending as CardError).status,
        409,
        `${state} authority cannot reuse a ready body`,
      );
      assert.ok(
        (await requests.at(-1)!.json()).have,
        'the request did advertise the ready cached body',
      );
      let coldPending = await load('person-1');
      assert.strictEqual(
        (coldPending as CardError).status,
        409,
        'a cold read also refuses pending data',
      );
      await db.execute(
        'DELETE FROM lattice_pending_generations WHERE realm_url=$1',
        { bind: [realm.url] },
      );
      await db.execute(
        'UPDATE lattice_owners SET dirty_generation=NULL,retired=false WHERE realm_url=$1',
        { bind: [realm.url] },
      );
      assert.notOk(
        isCardError(await load('person-1')),
        'fresh authority recovers without changing the stored body',
      );
      assert.notOk(
        (await requests.at(-1)!.json()).have,
        'pending documents are never retained for reuse',
      );
    }
  });

  test('Lattice rejects malformed inventories and accepts full documents from older servers', async (assert) => {
    let url = realm.url + 'person-1';
    let token = 'lattice-input-v1:' + '0'.repeat(64);
    for (let have of [
      null,
      {},
      [null],
      [7],
      [{ url, token: 'bad' }],
      [
        { url, token },
        { url, token },
      ],
      [{ url: url + '.json', token }],
    ]) {
      assert.strictEqual(
        (await batchRequest([url], snapshot.generation, have)).status,
        400,
      );
    }
    let transport: typeof globalThis.fetch = async (input, init) => {
      let response = await fetch(input, init);
      let payload = await response.json();
      for (let result of payload.results) delete result.token;
      return new Response(JSON.stringify(payload));
    };
    assert.notOk(isCardError(await load('person-1', transport)));
    assert.notOk(isCardError(await load('person-1', transport)));
    assert.notOk(
      (await requests.at(-1)!.json()).have,
      'a legacy response never advertises an invented token',
    );
  });

  test('a malformed response fails every waiting read and a later request retries', async (assert) => {
    let fail = true;
    let transport: typeof globalThis.fetch = (input, init) =>
      fail
        ? Promise.resolve(new Response(JSON.stringify({ results: [] })))
        : fetch(input, init);
    let results = await Promise.all([
      load('person-1', transport),
      load('missing', transport),
    ]);
    assert.true(
      results.every((result) => isCardError(result) && result.status === 502),
    );
    assert.deepEqual((results[1] as CardError).deps, [realm.url + 'missing']);
    fail = false;
    assert.notOk(isCardError(await load('person-1', transport)));
  });

  test('rejects unauthorized, foreign, malformed and oversized input requests', async (assert) => {
    let unauthorized = await realm.handle(
      new Request(realm.url + '_lattice-inputs', {
        method: 'QUERY',
        headers: { Accept: SupportedMimeType.CardJson },
        body: JSON.stringify({ urls: [realm.url + 'person-1'] }),
      }),
    );
    assert.strictEqual(unauthorized?.status, 401);
    for (let urls of [
      [],
      ['https://foreign.example/private'],
      [realm.url + '../secret'],
      [realm.url + '_info'],
      [realm.url + 'person-1?expand=true'],
      [realm.url + 'person-1#x'],
      Array(65).fill(realm.url + 'person-1'),
      [7],
    ]) {
      assert.strictEqual(
        (await batchRequest(urls)).status,
        400,
        JSON.stringify(urls).slice(0, 100),
      );
    }
    let missingRevision = await fetch(realm.url + '_lattice-inputs', {
      method: 'QUERY',
      headers: { Accept: SupportedMimeType.CardJson },
      body: JSON.stringify({ urls: [realm.url + 'person-1'] }),
    });
    assert.strictEqual(missingRevision.status, 400);
    let foreign = await loadCardDocument(
      fetch,
      'https://foreign.example/private',
      network,
      snapshot,
    );
    assert.strictEqual((foreign as CardError).status, 400);
  });

  test('bounds each batch and isolates fetch credentials and computation scopes', async (assert) => {
    let results = await Promise.all(
      Array.from({ length: 65 }, (_, i) => load(`absent-${i}`)),
    );
    assert.true(
      results.every((result) => isCardError(result) && result.status === 404),
    );
    assert.deepEqual(
      await Promise.all(
        requests.map(async (request) => (await request.json()).urls.length),
      ),
      [64, 1],
    );
    requests = [];
    let otherFetch: typeof globalThis.fetch = (input, init) =>
      fetch(input, init);
    await Promise.all([
      load('person-1'),
      load('person-1', otherFetch),
      load('person-1', fetch, { ...snapshot }),
    ]);
    assert.strictEqual(
      requests.length,
      3,
      'no sharing across authenticated fetches or computation snapshots',
    );
  });

  test('rejects a generation change before or during the batch and permits a fresh retry', async (assert) => {
    assert.strictEqual(
      (await batchRequest([realm.url + 'person-1'], snapshot.generation + 1))
        .status,
      409,
    );
    assert.notOk(
      isCardError(await load('person-1')),
      'prime the resident body before the race',
    );
    let execute = db.execute;
    let changed = false;
    db.execute = async (sql, opts) => {
      let result = await execute.call(db, sql, opts);
      if (
        !changed &&
        sql.includes('SELECT') &&
        sql.includes('i.pristine_doc') &&
        sql.includes('FROM boxel_index')
      ) {
        changed = true;
        await execute.call(
          db,
          'UPDATE realm_generations SET current_generation=current_generation+1 WHERE realm_url=$1',
          { bind: [realm.url] },
        );
      }
      return result;
    };
    try {
      let results = await Promise.all([load('person-1'), load('missing')]);
      assert.true(changed, 'generation advanced after reading the batch');
      assert.ok(
        (await requests.at(-1)!.json()).have,
        'the raced batch used the reuse protocol',
      );
      assert.true(
        results.every((result) => isCardError(result) && result.status === 409),
        'no partial old-generation response escapes',
      );
    } finally {
      db.execute = execute;
    }
    assert.notOk(
      isCardError(
        await load('person-1', fetch, {
          ...snapshot,
          generation: snapshot.generation + 1,
        }),
      ),
    );
  });
});

module('lattice-input-batch-test.ts | residency', function () {
  function value(text = 'Mango'): LatticeResidentInput {
    return {
      token: 'lattice-input-v1:' + '0'.repeat(64),
      headers: {},
      document: {
        data: {
          type: 'card',
          attributes: { text },
          meta: {
            adoptsFrom: {
              module: rri('https://example.test/person'),
              name: 'Person',
            },
          },
        },
      },
    };
  }

  test('keeps recently used documents within the entry bound', (assert) => {
    let cache = new LatticeInputResidency();
    let document = value();
    for (let i = 0; i < LatticeInputResidency.MAX_ENTRIES; i++)
      cache.set(String(i), document);
    assert.strictEqual(
      cache.get('0'),
      document,
      'a reader can pin the received document',
    );
    cache.set('new', document);
    assert.notOk(cache.get('1'), 'the least recently used entry is evicted');
    assert.strictEqual(
      cache.get('0'),
      document,
      'recently used entry survives',
    );
    cache.delete('0');
    assert.notOk(cache.get('0'));
    assert.strictEqual(
      document.document.data.attributes!.text,
      'Mango',
      'eviction cannot mutate a document pinned by an in-flight request',
    );
  });

  test('bounds serialized characters and drops oversized replacements', (assert) => {
    let cache = new LatticeInputResidency();
    let large = value(
      'x'.repeat(
        Math.floor(LatticeInputResidency.MAX_SERIALIZED_CHARACTERS / 2),
      ),
    );
    cache.set('first', large);
    cache.set('second', large);
    assert.notOk(
      cache.get('first'),
      'the total retained document budget is enforced',
    );
    assert.strictEqual(cache.get('second'), large);
    cache.set(
      'second',
      value('x'.repeat(LatticeInputResidency.MAX_SERIALIZED_CHARACTERS)),
    );
    assert.notOk(
      cache.get('second'),
      'an oversized replacement must not leave an obsolete document',
    );
    cache.set('small', value());
    assert.ok(cache.get('small'), 'eviction leaves room for subsequent data');
  });
});

module('lattice-input-batch-test.ts | coverage', function () {
  test('accepts partial inventory, reordered results, explicit errors and canonical identity mapping', (assert) => {
    let root = 'http://display.example/realm/';
    let token = 'lattice-display-v1:' + 'a'.repeat(64);
    let request = latticeDisplayBatchRequest(
      {
        version: 1,
        session: 'client',
        epoch: 2,
        required: [root + 'a', root + 'b'],
        have: [{ url: root + 'a', token }],
      },
      root,
    );
    let response = {
      version: 1,
      session: 'client',
      epoch: 2,
      results: [
        { url: root + 'b', error: { status: 503, message: 'try again' } },
        {
          url: root + 'a',
          publication: {
            lattice: {
              version: 1,
              reuse: true,
              id: root + 'a',
              token,
              state: 'pending',
            },
          },
        },
      ],
    };
    let results = latticeDisplayBatchResults(response, request);
    assert.strictEqual(results.size, 2);
    assert.deepEqual(
      results.get(root + 'b'),
      { url: root + 'b', error: { status: 503, message: 'try again' } },
      'an explicit failure remains a failure',
    );
    let aliased = structuredClone(response);
    aliased.results[1].publication!.lattice.id = 'alias:a';
    assert.strictEqual(
      latticeDisplayBatchResults(aliased, request, (id) =>
        id === 'alias:a' ? root + 'a' : id,
      ).size,
      2,
    );
  });

  test('rejects incomplete, unsolicited and malformed responses before application', (assert) => {
    let root = 'http://display.example/realm/';
    let token = 'lattice-display-v1:' + 'a'.repeat(64);
    let request = latticeDisplayBatchRequest(
      {
        version: 1,
        session: 'client',
        epoch: 2,
        required: [root + 'a', root + 'b'],
        have: [{ url: root + 'a', token }],
      },
      root,
    );
    let response: any = {
      version: 1,
      session: 'client',
      epoch: 2,
      results: [
        {
          url: root + 'a',
          publication: {
            lattice: {
              version: 1,
              reuse: true,
              id: root + 'a',
              token,
              state: 'ready',
            },
          },
        },
        {
          url: root + 'b',
          publication: {
            data: {
              id: root + 'b',
              type: 'card',
              attributes: { name: 'B' },
              meta: {
                adoptsFrom: { module: root + 'definition', name: 'Card' },
              },
            },
          },
        },
      ],
    };
    assert.strictEqual(
      latticeDisplayBatchResults(response, request).size,
      2,
      'full bodies may accompany Have reuse',
    );
    let mutations: Array<(value: any) => void> = [
      (value) => {
        value.version = 2;
      },
      (value) => {
        value.session = 'old-session';
      },
      (value) => {
        value.epoch = 1;
      },
      (value) => {
        value.results.pop();
      },
      (value) => {
        value.results.push(value.results[0]);
      },
      (value) => {
        value.results[1] = value.results[0];
      },
      (value) => {
        value.results[1].url = root + 'unrequested';
      },
      (value) => {
        value.results[1].publication.data.id = root + 'wrong-card';
      },
      (value) => {
        value.results[1].publication = {};
      },
      (value) => {
        value.results[1] = { url: root + 'b' };
      },
      (value) => {
        value.results[1].error = { status: 503, message: 'ambiguous' };
      },
      (value) => {
        value.results[1] = {
          url: root + 'b',
          error: { status: 200, message: 'not an error' },
        };
      },
      (value) => {
        value.results[0].publication.lattice.token =
          'lattice-display-v1:' + 'b'.repeat(64);
      },
      (value) => {
        value.results[0].publication.lattice.state = 'unknown';
      },
    ];
    for (let mutate of mutations) {
      let invalid = structuredClone(response);
      mutate(invalid);
      assert.throws(
        () => latticeDisplayBatchResults(invalid, request),
        /Incomplete or invalid Lattice display response/,
      );
    }
    assert.throws(
      () => latticeDisplayBatchResults(response, { ...request, have: [] }),
      /Incomplete or invalid Lattice display response/,
      'unsolicited reuse is not complete data',
    );
  });
});
