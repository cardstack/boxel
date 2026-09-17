import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import QUnit from 'qunit';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import sinon from 'sinon';
import { bxl, getBxlComputeDefinition } from '@cardstack/bxl';
import { PgAdapter } from '@cardstack/postgres';
import {
  Deferred,
  IndexWriter,
  RealmPaths,
  type Prerenderer,
  type Reader,
  type DefinitionLookup,
  VirtualNetwork,
  rri,
} from '@cardstack/runtime-common';
import type { Definition } from '@cardstack/runtime-common/definitions';
import { renderFileForIndexing } from '@cardstack/runtime-common/index-runner/visit-file';
import { performFileIndexing } from '@cardstack/runtime-common/index-runner/file-indexer';
import { IndexRunnerDependencyManager } from '@cardstack/runtime-common/index-runner/dependency-resolver';
import {
  analyzeLatticeGtsSource,
  type LatticeGtsAnalysis,
} from '@cardstack/runtime-common/lattice-gts-analysis';
import type {
  LatticeNativeCardIndexRequest,
  LatticeNativeFileIndexRequest,
  LatticeNativeFileIndexResult,
} from '@cardstack/runtime-common/lattice-native-index';
import {
  createPostgresLatticeAdmission,
  createPostgresLatticeFileAdmission,
  latticeDefinitionDigest,
  type LatticeNativeRealmPolicy,
} from '../lib/lattice-postgres-admission.ts';
import { createLatticeNativeFileIndexer } from '../lib/lattice-native-file.ts';
import { createLatticeNativeCardIndexer } from '../lib/lattice-native-card-indexer.ts';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import { createLatticeNativeWorker } from '../lib/lattice-native-worker.ts';
import { createLatticeCodeWorker } from '../lib/lattice-code-worker.ts';
import { registerLatticeCodePolicies } from '../lib/lattice-code-admission.ts';
import { LatticeMaterializationInputs } from '../lib/lattice-materialization-inputs.ts';
import { latticeReadState } from '@cardstack/runtime-common/lattice-materialization';
import {
  captureLatticeRenderInput,
  withLatticeRenderAuthority,
} from '@cardstack/runtime-common/lattice-render-authority';
import { validateLatticeRenderCheckpoint } from '@cardstack/runtime-common/lattice-render-checkpoint';
import { openLatticeNativeWork } from '../lib/lattice-native-work.ts';
import { latticeMaterializationReadySQL } from '@cardstack/runtime-common/jobs/lattice';
import { setupDB } from './helpers/index.ts';
import { persistFileMeta } from '@cardstack/runtime-common/file-meta';

const { module, test } = QUnit;
const realm = 'https://lattice-pg.example/';
const base = 'https://lattice-base.example/';
const actor = '@native:example.com';
const codeRef = { module: rri(realm + 'score'), name: 'Score' };
const sourceCode = 'reviewed Score source';
const md5 = (value: string) => createHash('md5').update(value).digest('hex');
const formula = (source: string) =>
  getBxlComputeDefinition(
    bxl(source, { readableSyntax: false, libraries: ['core'] }),
  )!;
const numberField = {
  type: 'contains' as const,
  fieldOrCard: { module: rri(base + 'number'), name: 'Number' },
  isPrimitive: true,
  isComputed: false,
  nativeCodec: { kind: 'primitive' as const, serializer: 'number' as const },
};
const definition: Definition = {
  type: 'card-def',
  codeRef,
  displayName: 'Score',
  nativeIndex: { types: [codeRef], displayNames: ['Score'], cardType: 'Score' },
  nativeCodec: { kind: 'compound', resourceType: 'card' },
  fields: { amount: 'amount', doubled: 'doubled', cardTitle: 'title' },
  fieldDefs: {
    amount: numberField,
    doubled: { ...numberField, isComputed: true, bxl: formula('.amount * 2') },
    title: {
      ...numberField,
      isComputed: true,
      nativeCodec: { kind: 'primitive', scalar: 'string' },
      bxl: formula('"Score"'),
    },
  },
};

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let worker: LatticeBxlWorker;
  let network: VirtualNetwork;
  let policy: LatticeNativeRealmPolicy;
  let request: LatticeNativeCardIndexRequest;
  let runtime: string;

  async function file(realmURL: string, path: string, content: string) {
    await db.execute(
      `INSERT INTO realm_file_meta
      (realm_url,file_path,created_at,content_hash,content_size) VALUES ($1,$2,1,$3,$4)`,
      { bind: [realmURL, path, md5(content), Buffer.byteLength(content)] },
    );
  }

  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      worker = new LatticeBxlWorker();
      network = new VirtualNetwork();
      runtime = 'native-runtime-1';
      request = {
        url: realm + 'Score/one.json',
        realmURL: realm,
        sourceJSON: JSON.stringify({
          data: {
            type: 'card',
            attributes: { amount: 3 },
            meta: { adoptsFrom: { module: '../score', name: 'Score' } },
          },
        }),
        generation: 1,
        loaderEpoch: 'code-1',
        lastModified: 1,
        resourceCreatedAt: 1,
      };
      policy = {
        realmURL: realm,
        actorUserId: actor,
        runtimeRevision: runtime,
        roots: [codeRef],
        noScreenshotThumbnail: true,
        modules: [
          {
            url: realm + 'score',
            realmURL: realm,
            cacheScope: 'realm-auth',
            authUserId: actor,
            sourcePath: 'score.gts',
            sourceMD5: md5(sourceCode),
          },
          {
            url: base + 'number',
            realmURL: base,
            cacheScope: 'public',
            authUserId: '',
            sourcePath: 'number.gts',
            sourceMD5: md5('reviewed Number'),
          },
        ],
        definitions: [
          {
            codeRef,
            moduleURL: realm + 'score',
            cacheKey: 'Score',
            definitionSHA256: latticeDefinitionDigest(definition),
          },
        ],
      };
      await db.execute(
        'INSERT INTO realm_generations (realm_url,current_generation,loader_epoch) VALUES ($1,0,$2)',
        { bind: [realm, request.loaderEpoch] },
      );
      for (const [url, username] of [
        [realm, actor],
        [base, '*'],
      ]) {
        await db.execute('INSERT INTO realm_metadata (url) VALUES ($1)', {
          bind: [url],
        });
        await db.execute(
          'INSERT INTO realm_user_permissions (realm_url,username,read,write) VALUES ($1,$2,TRUE,FALSE)',
          { bind: [url, username] },
        );
      }
      await file(realm, 'Score/one.json', request.sourceJSON);
      await file(realm, 'score.gts', sourceCode);
      await file(base, 'number.gts', 'reviewed Number');
      for (const item of policy.modules) {
        const definitions =
          item.url === realm + 'score'
            ? { Score: { type: 'definition', definition } }
            : {};
        await db.execute(
          `INSERT INTO modules
        (url,resolved_realm_url,cache_scope,auth_user_id,definitions,deps)
        VALUES ($1,$2,$3,$4,$5,'[]')`,
          {
            bind: [
              item.url,
              item.realmURL,
              item.cacheScope,
              item.authUserId,
              JSON.stringify(definitions),
            ],
          },
        );
      }
    },
  });
  hooks.afterEach(async () => {
    sinon.restore();
    await worker.close();
  });

  function indexer() {
    return createLatticeNativeCardIndexer({
      worker,
      admit: createPostgresLatticeAdmission({
        db,
        network,
        policies: [policy],
        runtimeRevision: () => runtime,
      }),
    });
  }
  async function candidate() {
    const result = await indexer()(request);
    if (!result) throw new Error('Expected native admission');
    return result;
  }
  async function validate(result: Awaited<ReturnType<typeof candidate>>) {
    await db.withWriteLock('native-publication-test', async (tx) => {
      await result.assertCurrent(tx!);
    });
  }

  test('primary native admission tolerates an intervening data publication but still fences its source', async (assert) => {
    const prepared = await candidate();
    await db.execute(
      'UPDATE realm_generations SET current_generation=current_generation+1 WHERE realm_url=$1',
      { bind: [realm] },
    );
    await validate(prepared);
    assert.ok(
      true,
      'an unrelated wave does not invalidate primary computation',
    );
    await db.execute(
      "UPDATE realm_generations SET loader_epoch='changed' WHERE realm_url=$1",
      { bind: [realm] },
    );
    await assert.rejects(
      validate(prepared),
      /generation changed/,
      'code epoch fencing remains intact',
    );
  });

  const linkedImports = `import {CardDef, field, contains, NumberField} from '${base}number';
    import {bxl} from '@cardstack/bxl';`;
  const linkedSource = `${linkedImports} export class Score extends CardDef {
    @field amount = contains(NumberField);
    @field doubled = contains(NumberField, {computeVia: bxl('.amount * 2', {readableSyntax:false})});
  }`;
  async function prepareLinked(source = linkedSource, link = true) {
    policy.codeLinking = {
      trustedModules: [
        {
          moduleURL: base + 'number',
          moduleURLs: [base + 'number'],
          exports: ['CardDef', 'field', 'contains', 'NumberField'],
        },
      ],
    };
    policy.modules[0].sourceMD5 = md5(source);
    await db.execute(
      'UPDATE realm_file_meta SET content_hash=$1,content_size=$2 WHERE realm_url=$3 AND file_path=$4',
      {
        bind: [md5(source), Buffer.byteLength(source), realm, 'score.gts'],
      },
    );
    await registerLatticeCodePolicies(db, [policy]);
    const batch = await new IndexWriter(db, {
      lattice: new LatticeRealmConfig([realm]),
    }).createBatch(new URL(realm), network);
    await batch.updateEntry(new URL(realm + 'score.gts'), {
      type: 'file',
      lastModified: 1,
      resourceCreatedAt: 1,
      searchData: { latticeAnalysis: null },
      resource: {
        id: rri(realm + 'score.gts'),
        type: 'file-meta',
        attributes: {
          latticeAnalysis: analyzeLatticeGtsSource(realm + 'score.gts', source),
        },
        meta: {
          adoptsFrom: {
            module: rri(base + 'gts-file-def'),
            name: 'GtsFileDef',
          },
        },
      },
      types: [],
      displayNames: ['GTS Module'],
      deps: new Set(),
      iconHTML: '',
    });
    await batch.done({
      latticeRealmUsername: 'native',
      carryForwardRealmMeta: true,
      countIndexEntries: false,
    });
    const [revision] = await db.execute(
      'SELECT current_generation,loader_epoch FROM realm_generations WHERE realm_url=$1',
      { bind: [realm] },
    );
    request.generation = Number(revision.current_generation) + 1;
    request.loaderEpoch = String(revision.loader_epoch);
    if (link)
      await createLatticeCodeWorker({
        db,
        network,
        policies: [policy],
        runtimeRevision: () => runtime,
      })({ realmURL: realm, realmUsername: 'native' });
  }

  test('published GTS classification is consumed by native admission and fenced in the actual index commit', async (assert) => {
    await prepareLinked();
    const result = await candidate();
    assert.strictEqual(
      result.card.searchDoc?.doubled,
      6,
      'the official BXL worker computes admitted data',
    );
    await validate(result);
    const batch = await new IndexWriter(db, {
      lattice: new LatticeRealmConfig([realm]),
    }).createBatch(new URL(realm), network);
    batch.registerLatticeNativeCard(request.url, result.assertCurrent);
    await batch.updateEntry(new URL(request.url), {
      type: 'instance',
      resource: result.card.serialized!.data,
      searchData: result.card.searchDoc!,
      types: result.card.types!,
      displayNames: result.card.displayNames!,
      deps: new Set(result.card.deps),
      lastModified: 1,
      resourceCreatedAt: 1,
    });
    await db.execute(
      'UPDATE lattice_code_artifacts SET dirty=TRUE,work_version=work_version+1 WHERE realm_url=$1',
      { bind: [realm] },
    );
    await assert.rejects(
      batch.done(),
      /classification changed before publication/,
    );
    const rows = await db.execute(
      "SELECT url FROM boxel_index WHERE type='instance' AND realm_url=$1",
      { bind: [realm] },
    );
    assert.deepEqual(
      rows,
      [],
      'no stale result escaped the publication transaction',
    );
  });

  test('Chrome-only and unresolved classifications decline native data indexing even with an operator review', async (assert) => {
    await prepareLinked(`${linkedImports} export class Score extends CardDef {
      @field amount = contains(NumberField);
      @field doubled = contains(NumberField, {computeVia: function() { return this.amount * 2; }});
    }`);
    const [row] = await db.execute(
      "SELECT receipt->'exports'->'Score'->>'state' AS state FROM lattice_code_artifacts WHERE realm_url=$1",
      { bind: [realm] },
    );
    assert.strictEqual(row.state, 'chrome-data');
    assert.strictEqual(
      await indexer()(request),
      undefined,
      'existing visit routing gives data indexing to Chrome',
    );
    await prepareLinked(
      `import {Missing} from './not-indexed'; export class Score extends Missing {}`,
    );
    assert.strictEqual(
      await indexer()(request),
      undefined,
      'missing analysis cannot admit Node execution',
    );
  });

  test('configured linked admission waits for a current classification and rejects a runtime mismatch', async (assert) => {
    await prepareLinked(linkedSource, false);
    assert.strictEqual(
      await indexer()(request),
      undefined,
      'a pending receipt is not execution authority',
    );
    await createLatticeCodeWorker({
      db,
      network,
      policies: [policy],
      runtimeRevision: () => runtime,
    })({ realmURL: realm, realmUsername: 'native' });
    assert.ok(await indexer()(request));
    await registerLatticeCodePolicies(db, [
      { ...policy, runtimeRevision: 'native-runtime-2' },
    ]);
    assert.strictEqual(
      await indexer()(request),
      undefined,
      'an old provider cannot admit work after reconfiguration',
    );
  });

  test('reviewed scoped definitions compute in Node and publish using the real index transaction', async (assert) => {
    const result = await candidate();
    assert.strictEqual(result.card.searchDoc?.doubled, 6);
    assert.deepEqual(result.card.deps, [realm + 'score', base + 'number']);
    const batch = await new IndexWriter(db, {
      lattice: new LatticeRealmConfig([realm]),
    }).createBatch(new URL(realm), network);
    batch.registerLatticeNativeCard(request.url, result.assertCurrent);
    await batch.updateEntry(new URL(request.url), {
      type: 'instance',
      resource: result.card.serialized!.data,
      searchData: result.card.searchDoc!,
      types: result.card.types!,
      displayNames: result.card.displayNames!,
      deps: new Set(result.card.deps),
      lastModified: 1,
      resourceCreatedAt: 1,
    });
    await batch.done();
    const [row] = await db.execute(
      "SELECT search_doc FROM boxel_index WHERE realm_url=$1 AND type='instance'",
      { bind: [realm] },
    );
    assert.strictEqual((row.search_doc as any).doubled, 6);
  });

  async function prepareCodeOwner() {
    const root = structuredClone(definition);
    root.nativeIndex!.materialized = true;
    policy.definitions[0].definitionSHA256 = latticeDefinitionDigest(root);
    await db.execute('UPDATE modules SET definitions=$1 WHERE url=$2', {
      bind: [
        JSON.stringify({ Score: { type: 'definition', definition: root } }),
        realm + 'score',
      ],
    });
    await prepareLinked();
    const lookup = {
      lookupDefinition: async () => root,
    } as unknown as DefinitionLookup;
    const writer = new IndexWriter(db, {
      lattice: new LatticeRealmConfig([realm]),
    });
    const publication = writer.latticePublication(lookup, network);
    const readRevision = async () => {
      const [row] = await db.execute(
        'SELECT current_generation,loader_epoch FROM realm_generations WHERE realm_url=$1',
        { bind: [realm] },
      );
      return {
        generation: Number(row.current_generation),
        loaderEpoch: String(row.loader_epoch),
      };
    };
    const inputs = async () =>
      LatticeMaterializationInputs.open({
        db,
        network,
        realmURL: realm,
        actor,
        lookup,
        ...(await readRevision()),
      });
    const createRun = () =>
      createLatticeNativeCardIndexer({
        worker,
        admit: createPostgresLatticeAdmission({
          db,
          network,
          policies: [policy],
          runtimeRevision: () => runtime,
        }),
        openInputs: async () => inputs(),
      });
    const run = createRun();
    const publish = async (
      result: NonNullable<Awaited<ReturnType<typeof run>>>,
      ready: boolean,
    ) => {
      const batch = await writer.createBatch(new URL(realm), network);
      batch.registerLatticeNativeCard(
        request.url,
        result.assertCurrent,
        result.codeReference,
      );
      await batch.updateEntry(new URL(request.url), {
        type: 'instance',
        resource: result.card.serialized!.data,
        searchData: result.card.searchDoc!,
        types: result.card.types!,
        displayNames: result.card.displayNames!,
        deps: new Set(result.card.deps),
        lastModified: 1,
        resourceCreatedAt: 1,
      });
      await batch.done({
        lattice: publication,
        ...(ready
          ? { latticeInputGeneration: request.inputSnapshot!.generation }
          : { latticeRealmUsername: 'native' }),
        carryForwardRealmMeta: true,
        countIndexEntries: false,
      });
      while (await publication.matchPending(realm, 'native')) {
        /* drain the committed source barrier */
      }
    };
    await publish((await run(request))!, false);
    const revision = await readRevision();
    request.generation = revision.generation + 1;
    request.loaderEpoch = revision.loaderEpoch;
    request.inputSnapshot = {
      realmURL: realm,
      generation: revision.generation,
    };
    const result = (await run(request))!;
    await publish(result, true);
    const stored = async () => {
      const [row] = await db.execute(
        "SELECT xmin::text AS version,pristine_doc FROM boxel_index WHERE realm_url=$1 AND url=$2 AND type='instance'",
        { bind: [realm, request.url] },
      );
      return {
        version: row.version,
        resource: row.pristine_doc as unknown as NonNullable<
          typeof result.card.serialized
        >['data'],
      };
    };
    return {
      root,
      writer,
      publication,
      inputs,
      readRevision,
      stored,
      reference: result.codeReference!,
      async recompute() {
        while (await publication.matchPending(realm, 'native')) {
          /* code capture must pass through ordinary secondary matching */
        }
        const current = await readRevision();
        request.generation = current.generation + 1;
        request.loaderEpoch = current.loaderEpoch;
        request.inputSnapshot = {
          realmURL: realm,
          generation: current.generation,
        };
        // Admission is revisioned configuration; refresh it after the fixture
        // explicitly updates the reviewed code policy.
        const candidate = (await createRun()(request))!;
        await publish(candidate, true);
        return candidate.codeReference;
      },
    };
  }

  for (const stale of [false, true]) {
    test(`native ${stale ? 'stale' : 'fresh'} materialization fences an intervening generation`, async (assert) => {
      const lab = await prepareCodeOwner();
      const revision = await lab.readRevision();
      const lookup = {
        lookupDefinition: async () => lab.root,
      } as unknown as DefinitionLookup;
      const run = createLatticeNativeCardIndexer({
        worker,
        admit: createPostgresLatticeAdmission({
          db,
          network,
          policies: [policy],
          runtimeRevision: () => runtime,
        }),
        openInputs: async () =>
          LatticeMaterializationInputs.open({
            db,
            network,
            realmURL: realm,
            actor,
            lookup,
            ...revision,
            ...(stale ? { stale: true as const } : {}),
          }),
      });
      const prepared = await run({
        ...request,
        generation: revision.generation + 1,
        loaderEpoch: revision.loaderEpoch,
        inputSnapshot: {
          realmURL: realm,
          generation: revision.generation,
          ...(stale ? { stale: true as const } : {}),
        },
      });
      if (!prepared) throw new Error('Expected native materialization');
      await db.execute(
        'UPDATE realm_generations SET current_generation=current_generation+1 WHERE realm_url=$1',
        { bind: [realm] },
      );
      if (stale) {
        await validate(prepared);
        assert.ok(
          true,
          'stale computation tolerates an unrelated committed revision',
        );
        await db.execute(
          "UPDATE realm_file_meta SET content_hash='changed' WHERE file_path='Score/one.json'",
        );
        await assert.rejects(
          validate(prepared),
          /source or reviewed code/,
          'staleness never weakens the owner source fence',
        );
      } else {
        await assert.rejects(
          validate(prepared),
          /generation changed/,
          'an ordinary computation cannot report old input as current',
        );
      }
    });
  }

  test('equal native output retains its code authority until the code itself changes', async (assert) => {
    const lab = await prepareCodeOwner();
    const before = (await lab.stored()).resource;
    const reference = await lab.recompute();
    assert.deepEqual(reference, lab.reference);
    const retained = (await lab.stored()).resource;
    assert.strictEqual(
      retained.meta.publication!.outputRevision,
      before.meta.publication!.outputRevision,
    );
    assert.true(
      retained.meta.publication!.validatedThrough >
        before.meta.publication!.validatedThrough,
    );
    const [binding] = await db.execute(
      'SELECT generation FROM lattice_owner_code WHERE realm_url=$1 AND owner_url=$2',
      { bind: [realm, request.url] },
    );
    assert.strictEqual(
      Number(binding.generation),
      retained.meta.publication!.outputRevision,
    );
    assert.strictEqual(
      await latticeReadState(
        db,
        realm,
        request.url,
        retained.meta.publication!,
      ),
      'ready',
    );
    const frame = await lab.inputs();
    await frame.read([request.url]);
    await db.withWriteLock('feeder-commit', (tx) =>
      frame.seal().assertCurrent(tx!),
    );
    const render = await captureLatticeRenderInput(db, realm, request.url);
    assert.strictEqual(render.status, 'ready');
    // A real re-analysis, with equal card values, must acquire new output authority.
    await prepareLinked(linkedSource + '\n');
    const changedReference = await lab.recompute();
    assert.notDeepEqual(changedReference, reference);
    const changed = (await lab.stored()).resource;
    assert.deepEqual(changed.attributes, before.attributes);
    assert.true(
      changed.meta.publication!.outputRevision! >
        retained.meta.publication!.outputRevision!,
    );
    assert.strictEqual(
      await latticeReadState(db, realm, request.url, changed.meta.publication!),
      'ready',
    );
  });

  test('an unrelated GTS epoch preserves published data and feeder reads while rendering uses the current loader', async (assert) => {
    const lab = await prepareCodeOwner();
    const before = await lab.stored();
    assert.strictEqual(before.resource.attributes?.doubled, 6);
    assert.ok(
      lab.reference,
      'the native publication supplies the code binding',
    );
    assert.strictEqual(
      await latticeReadState(
        db,
        realm,
        request.url,
        before.resource.meta.publication!,
      ),
      'ready',
    );
    const change = await lab.writer.createBatch(new URL(realm), network);
    await change.invalidate([new URL(realm + 'unrelated.gts')]);
    await change.done({
      lattice: lab.publication,
      latticeRealmUsername: 'native',
      carryForwardRealmMeta: true,
      countIndexEntries: false,
    });
    while (await lab.publication.matchPending(realm, 'native')) {
      /* one bounded matching chunk per call */
    }
    const after = await lab.stored();
    const revision = await lab.readRevision();
    assert.notStrictEqual(
      revision.loaderEpoch,
      before.resource.meta.publication!.definitionRevision,
    );
    assert.deepEqual(
      after,
      before,
      'neither data bytes nor the stored row were rewritten',
    );
    assert.deepEqual(
      await lab.publication.registry.pending(realm),
      [],
      'no materialization was requested for unchanged code',
    );
    assert.strictEqual(
      await latticeReadState(
        db,
        realm,
        request.url,
        after.resource.meta.publication!,
      ),
      'ready',
    );
    const frame = await lab.inputs();
    assert.strictEqual(
      (await frame.read([request.url]))[0].resource.attributes?.doubled,
      6,
    );
    assert.strictEqual(
      (
        await frame.query('owners', {
          filter: { type: codeRef },
          page: { size: 20 },
        })
      ).cards.length,
      1,
    );
    await db.withWriteLock('feeder-commit', (tx) =>
      frame.seal().assertCurrent(tx!),
    );
    const render = await captureLatticeRenderInput(db, realm, request.url);
    assert.strictEqual(render.status, 'ready');
    if (render.status !== 'ready') throw new Error('Expected render input');
    assert.strictEqual(render.authority.loaderEpoch, revision.loaderEpoch);
    assert.strictEqual(
      render.authority.definitionRevision,
      before.resource.meta.publication!.definitionRevision,
    );
    const receipt = await validateLatticeRenderCheckpoint(render.checkpoint, {
      id: request.url,
      realmURL: realm,
      loaderEpoch: revision.loaderEpoch,
    });
    assert.deepEqual(
      await withLatticeRenderAuthority(db, render, receipt, async () => true),
      { published: true, value: true },
    );
  });

  test('a code edit invalidates cached feeder inputs before reindexing and schedules its card after linking', async (assert) => {
    const lab = await prepareCodeOwner();
    const before = await lab.stored();
    const frame = await lab.inputs();
    await frame.read([request.url]);
    const receipt = frame.seal();
    const edited = linkedSource + '\n';
    await db.execute(
      'UPDATE realm_file_meta SET content_hash=$1,content_size=$2 WHERE realm_url=$3 AND file_path=$4',
      { bind: [md5(edited), Buffer.byteLength(edited), realm, 'score.gts'] },
    );
    assert.strictEqual(
      await latticeReadState(
        db,
        realm,
        request.url,
        before.resource.meta.publication!,
      ),
      'pending',
    );
    assert.deepEqual(
      await lab.stored(),
      before,
      'the last published value stays available',
    );
    await assert.rejects(
      db.withWriteLock('feeder-commit', (tx) => receipt.assertCurrent(tx!)),
      /feeder code changed/,
    );
    const pending = await lab.inputs();
    await assert.rejects(
      pending.query('owners', {
        filter: { type: codeRef },
        page: { size: 20 },
      }),
      /unsettled materialized inputs/,
    );
    await prepareLinked(edited);
    assert.strictEqual(
      (await lab.publication.registry.pending(realm)).length,
      1,
      'code publication creates the downstream obligation',
    );
    assert.strictEqual(
      await latticeReadState(
        db,
        realm,
        request.url,
        before.resource.meta.publication!,
      ),
      'pending',
    );
  });

  test('running and queued card work notices code invalidation without a realm generation change', async (assert) => {
    const lab = await prepareCodeOwner();
    const revision = await lab.readRevision();
    request.inputSnapshot = {
      realmURL: realm,
      generation: revision.generation,
    };
    request.generation = revision.generation + 1;
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=$1 WHERE realm_url=$2',
      { bind: [revision.generation, realm] },
    );
    const work = await openLatticeNativeWork(db, request, {
      inputActor: actor,
      deps: [realm + 'score'],
      resolve: (url) => url,
      codeReference: lab.reference,
    });
    const canRun = async () => {
      const [row] = await db.execute(
        `WITH j AS (SELECT 'lattice-materialize'::text AS job_type,jsonb_build_object('realmURL',$1::text) AS args) SELECT ${latticeMaterializationReadySQL} AS ready FROM j`,
        { bind: [realm] },
      );
      return row.ready;
    };
    try {
      assert.true(await canRun());
      const edited = linkedSource + '\n';
      await persistFileMeta(
        db,
        realm,
        [
          {
            path: 'score.gts',
            contentHash: md5(edited),
            contentSize: Buffer.byteLength(edited),
          },
        ],
        true,
      );
      for (let i = 0; i < 20 && !work.signal.aborted; i++)
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert.true(
        work.signal.aborted,
        'the current attempt observes the shared code receipt',
      );
      assert.deepEqual(
        await lab.readRevision(),
        revision,
        'no index-generation event was needed',
      );
      assert.false(
        await canRun(),
        'pending code leaves the card job unreserved',
      );
      const other = realm + 'Score/other.json';
      await db.execute(
        `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired)
        VALUES($1,$2,$3,$4,$3,$5,FALSE)`,
        {
          bind: [
            realm,
            other,
            revision.generation,
            revision.generation - 1,
            revision.loaderEpoch,
          ],
        },
      );
      assert.true(
        await canRun(),
        'a code wait does not block another runnable owner',
      );
      assert.deepEqual(
        (
          await lab.publication.registry.pending(realm, { runnableOnly: true })
        ).map((row) => row.ownerURL),
        [other],
      );
      await db.execute('DELETE FROM lattice_owners WHERE owner_url=$1', {
        bind: [other],
      });
      await db.execute(
        'INSERT INTO lattice_pending_generations(realm_url,generation,definition_revision) VALUES($1,$2,$3)',
        { bind: [realm, revision.generation, revision.loaderEpoch] },
      );
      assert.true(
        await canRun(),
        'the matching barrier can still drain before code is ready',
      );
      await db.execute(
        'DELETE FROM lattice_pending_generations WHERE realm_url=$1',
        { bind: [realm] },
      );
      await db.execute(
        "UPDATE jobs SET status='resolved' WHERE job_type='lattice-materialize' AND concurrency_group=$1",
        { bind: ['lattice:' + realm] },
      );
      await persistFileMeta(
        db,
        realm,
        [
          {
            path: 'score.gts',
            contentHash: md5(linkedSource),
            contentSize: Buffer.byteLength(linkedSource),
          },
        ],
        true,
      );
      await createLatticeCodeWorker({
        db,
        network,
        policies: [policy],
        runtimeRevision: () => runtime,
      })({ realmURL: realm, realmUsername: 'native' });
      const wakeups = await db.execute(
        "SELECT id FROM jobs WHERE job_type='lattice-materialize' AND status='unfulfilled' AND concurrency_group=$1",
        { bind: ['lattice:' + realm] },
      );
      assert.strictEqual(
        wakeups.length,
        1,
        'an equal code result still wakes a data obligation that waited for it',
      );
      assert.true(await canRun());
    } finally {
      await work.close();
    }
  });

  test('a code binding requires coverage of every reviewed implementation source', async (assert) => {
    await prepareLinked();
    await file(realm, 'extra-code.gts', 'reviewed extra implementation');
    policy.modules.push({
      url: realm + 'extra-code',
      realmURL: realm,
      cacheScope: 'realm-auth',
      authUserId: actor,
      sourcePath: 'extra-code.gts',
      sourceMD5: md5('reviewed extra implementation'),
    });
    await db.execute(
      "INSERT INTO modules(url,resolved_realm_url,cache_scope,auth_user_id,definitions,deps) VALUES($1,$2,'realm-auth',$3,'{}','[]')",
      { bind: [realm + 'extra-code', realm, actor] },
    );
    await registerLatticeCodePolicies(db, [policy]);
    await createLatticeCodeWorker({
      db,
      network,
      policies: [policy],
      runtimeRevision: () => runtime,
    })({ realmURL: realm, realmUsername: 'native' });
    const admitted = await createPostgresLatticeAdmission({
      db,
      network,
      policies: [policy],
      runtimeRevision: () => runtime,
    })(request);
    assert.ok(
      admitted,
      'the complete semantic review can still admit execution',
    );
    assert.strictEqual(
      admitted!.codeReference,
      undefined,
      'the narrower import receipt cannot replace its full freshness guard',
    );
  });

  test('a compatibility publication does not inherit previous native code authority', async (assert) => {
    const lab = await prepareCodeOwner();
    const before = await lab.stored();
    const revision = await lab.readRevision();
    const resource = structuredClone(before.resource);
    resource.meta.publication!.validatedThrough = revision.generation;
    Object.assign(resource.meta, { latticeCodeReference: lab.reference });
    const batch = await lab.writer.createBatch(new URL(realm), network);
    await batch.updateEntry(new URL(request.url), {
      type: 'instance',
      resource,
      searchData: { amount: 3, doubled: 6 },
      types: [realm + 'score/Score'],
      displayNames: ['Score'],
      deps: new Set([realm + 'score']),
      lastModified: 1,
      resourceCreatedAt: 1,
    });
    await batch.done({
      lattice: lab.publication,
      latticeInputGeneration: revision.generation,
      carryForwardRealmMeta: true,
      countIndexEntries: false,
    });
    const refs = await db.execute(
      'SELECT owner_url FROM lattice_owner_code WHERE realm_url=$1',
      { bind: [realm] },
    );
    assert.deepEqual(
      refs,
      [],
      'card JSON cannot supply the native capability binding',
    );
    const current = await lab.stored();
    assert.strictEqual(
      await latticeReadState(
        db,
        realm,
        request.url,
        current.resource.meta.publication!,
      ),
      'ready',
    );
    const change = await lab.writer.createBatch(new URL(realm), network);
    await change.invalidate([new URL(realm + 'unrelated.gts')]);
    await change.done({
      lattice: lab.publication,
      latticeRealmUsername: 'native',
      carryForwardRealmMeta: true,
      countIndexEntries: false,
    });
    while (await lab.publication.matchPending(realm, 'native')) {
      /* drain matching */
    }
    assert.strictEqual(
      await latticeReadState(
        db,
        realm,
        request.url,
        current.resource.meta.publication!,
      ),
      'pending',
      'unbound legacy output retains its epoch guard',
    );
  });

  test('losing a code binding cannot silently downgrade a native publication to the legacy epoch guard', async (assert) => {
    const lab = await prepareCodeOwner();
    const value = await lab.stored();
    assert.strictEqual(
      await latticeReadState(
        db,
        realm,
        request.url,
        value.resource.meta.publication!,
      ),
      'ready',
    );
    await db.execute('DELETE FROM lattice_owner_code WHERE realm_url=$1', {
      bind: [realm],
    });
    assert.strictEqual(
      await latticeReadState(
        db,
        realm,
        request.url,
        value.resource.meta.publication!,
      ),
      'pending',
    );
    const frame = await lab.inputs();
    await assert.rejects(frame.read([request.url]), /feeder is not current/);
    assert.strictEqual(
      (await captureLatticeRenderInput(db, realm, request.url)).status,
      'pending',
    );
  });

  async function reviewJsonFile() {
    const ref = { module: rri(base + 'json-file-def'), name: 'JsonFileDef' };
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M0 0h1v1z"></path></svg>';
    const fileDefinition: Definition = {
      type: 'file-def',
      codeRef: ref,
      displayName: 'JSON',
      fields: {},
      fieldDefs: {},
      nativeFileIndex: {
        types: [ref],
        displayNames: ['JSON'],
        staticIcon: { svg, contentHash: md5(svg) },
      },
    };
    policy.fileExtractors = [{ codeRef: ref, kind: 'base-json' }];
    policy.modules.push({
      url: ref.module,
      realmURL: base,
      cacheScope: 'public',
      authUserId: '',
      sourcePath: 'json-file-def.gts',
      sourceMD5: md5('reviewed JSON'),
    });
    policy.definitions.push({
      codeRef: ref,
      moduleURL: ref.module,
      cacheKey: 'JsonFileDef',
      definitionSHA256: latticeDefinitionDigest(fileDefinition),
    });
    await file(base, 'json-file-def.gts', 'reviewed JSON');
    await db.execute(
      `INSERT INTO modules (url,resolved_realm_url,cache_scope,auth_user_id,definitions,deps)
      VALUES ($1,$2,'public','',$3,$4)`,
      {
        bind: [
          ref.module,
          base,
          JSON.stringify({
            JsonFileDef: { type: 'definition', definition: fileDefinition },
          }),
          JSON.stringify([base + 'card-api', base + 'icons/json']),
        ],
      },
    );
    network.addRealmMapping('@cardstack/base/', base);
    request.fileDefCodeRef = ref;
    return { ref, svg };
  }

  test('reviewed JSON extraction preserves the file row and shares the code publication fence', async (assert) => {
    const { ref, svg } = await reviewJsonFile();
    const result = await candidate();
    assert.strictEqual(
      result.file?.extract.searchDoc?.content,
      request.sourceJSON,
    );
    assert.strictEqual(
      result.file?.extract.searchDoc?.contentHash,
      md5(request.sourceJSON),
    );
    assert.strictEqual(
      result.file?.extract.resource?.meta.lastModified,
      request.lastModified,
    );
    assert.deepEqual(result.file?.extract.resource?.meta.adoptsFrom, ref);
    assert.deepEqual(result.file?.extract.deps, [
      ref.module,
      base + 'card-api',
      base + 'icons/json',
      base + 'file-api',
    ]);
    assert.strictEqual(result.file?.render.iconHTML, svg);
    await validate(result);
    await db.execute('UPDATE modules SET deps=$1 WHERE url=$2', {
      bind: [JSON.stringify([base + 'icons/new-json']), ref.module],
    });
    await assert.rejects(
      validate(result),
      /definition cache changed/,
      'changing even dependency metadata invalidates the entire result',
    );
  });

  test('an oversized dependency payload retains file extraction without decoding an unbounded module graph', async (assert) => {
    const { ref } = await reviewJsonFile();
    await db.execute('UPDATE modules SET deps=$1 WHERE url=$2', {
      bind: [JSON.stringify([base + 'x'.repeat(1_048_576)]), ref.module],
    });
    const result = await candidate();
    assert.strictEqual(result.file, undefined);
    assert.strictEqual(result.card.searchDoc?.doubled, 6);
    await validate(result);
  });

  test('file metadata is not execution authority and a different resolved file type retains extraction', async (assert) => {
    const { ref } = await reviewJsonFile();
    policy.fileExtractors = [];
    assert.strictEqual((await candidate()).file, undefined);
    policy.fileExtractors = [{ codeRef: ref, kind: 'base-json' }];
    request.fileDefCodeRef = { ...ref, name: 'CustomJsonFile' };
    assert.strictEqual((await candidate()).file, undefined);
    request.fileDefCodeRef = ref;
    await db.execute(
      'UPDATE realm_file_meta SET content_hash=$1 WHERE realm_url=$2 AND file_path=$3',
      {
        bind: [md5('edited JSON code'), base, 'json-file-def.gts'],
      },
    );
    assert.strictEqual(
      await indexer()(request),
      undefined,
      'changed extractor source cannot run under the old review',
    );
  });

  async function gtsFileFixture(withIcon = true) {
    const ref = { module: rri(base + 'gts-file-def'), name: 'GtsFileDef' };
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>';
    const def: Definition = {
      type: 'file-def',
      codeRef: ref,
      displayName: 'GTS Module',
      fields: {},
      fieldDefs: {},
      nativeFileIndex: {
        types: [ref],
        displayNames: ['GTS Module'],
        ...(withIcon ? { staticIcon: { svg, contentHash: md5(svg) } } : {}),
      },
    };
    policy.fileExtractors = [
      { codeRef: ref, kind: 'base-gts', moduleURLs: [ref.module] },
    ];
    policy.modules.push({
      url: ref.module,
      realmURL: base,
      cacheScope: 'public',
      authUserId: '',
      sourcePath: 'gts-file-def.gts',
      sourceMD5: md5('reviewed GTS extractor'),
    });
    policy.definitions.push({
      codeRef: ref,
      moduleURL: ref.module,
      cacheKey: 'GtsFileDef',
      definitionSHA256: latticeDefinitionDigest(def),
    });
    await file(base, 'gts-file-def.gts', 'reviewed GTS extractor');
    await db.execute(
      `INSERT INTO modules (url,resolved_realm_url,cache_scope,auth_user_id,definitions,deps) VALUES ($1,$2,'public','',$3,$4)`,
      {
        bind: [
          ref.module,
          base,
          JSON.stringify({
            GtsFileDef: { type: 'definition', definition: def },
          }),
          JSON.stringify([base + 'file-api']),
        ],
      },
    );
    network.addRealmMapping('@cardstack/base/', base);
    const source = `import {CardDef, field, contains, NumberField} from '@cardstack/base/card-api';
import {bxl} from '@cardstack/bxl';
throw new Error('must never execute the source being analyzed');
export class Counter extends CardDef { @field count = contains(NumberField); @field doubled = contains(NumberField, {computeVia: bxl('.count * 2', {readableSyntax:false,libraries:['core']})}); }`;
    network.addURLMapping(
      new URL('https://cardstack.com/base/'),
      new URL(base),
    );
    const request: LatticeNativeFileIndexRequest = {
      url: realm + 'new-card.gts',
      realmURL: realm,
      source,
      fileDefCodeRef: ref,
      generation: 1,
      loaderEpoch: 'code-1',
      lastModified: 1,
      resourceCreatedAt: 1,
    };
    await file(realm, 'new-card.gts', source);
    const index = createLatticeNativeFileIndexer({
      admit: createPostgresLatticeFileAdmission({
        db,
        network,
        policies: [policy],
        runtimeRevision: () => runtime,
      }),
    });
    return { request, index, ref };
  }

  async function validateFile(result: LatticeNativeFileIndexResult) {
    await db.withWriteLock('native-file-publication-test', (tx) =>
      result.assertCurrent(tx!),
    );
  }

  test('native GTS file analysis publishes through the index transaction without loading the source or visiting Chrome', async (assert) => {
    const { request, index } = await gtsFileFixture();
    const batch = await new IndexWriter(db, {
      lattice: new LatticeRealmConfig([realm]),
    }).createBatch(new URL(realm), network);
    await batch.invalidate([new URL(request.url)]);
    assert.notStrictEqual(
      batch.loaderEpoch,
      request.loaderEpoch,
      'source edit mints a future loader epoch',
    );
    const visited = await renderFileForIndexing({
      nativeFileIndexer: index,
      url: new URL(request.url),
      realmURL: new URL(realm),
      ignoreMap: new Map(),
      realmPaths: new RealmPaths(new URL(realm), network),
      reader: {
        readFile: async () => ({
          content: request.source,
          lastModified: 1,
          created: 1,
          path: 'new-card.gts',
        }),
        readStream: async () => {
          throw new Error('Unexpected stream read');
        },
        mtimes: async () => ({ [request.url]: 1 }),
      } satisfies Reader,
      batch,
      jobInfo: { jobId: 42, reservationId: 1, priority: 10, queueWaitMs: null },
      auth: '',
      batchId: 'gts-native-test',
      prerenderer: {
        prerenderVisit: async () => {
          throw new Error('GTS data extraction entered Chrome');
        },
      } as unknown as Prerenderer,
      virtualNetwork: network,
      consumeClearCacheForRender: () => true,
      logDebug() {},
      logWarn() {},
    });
    assert.ok(visited?.fileExtract?.resource);
    assert.strictEqual(
      visited?.card,
      undefined,
      'source analysis does not instantiate a card',
    );
    const analysis = visited!.fileExtract!.resource!.attributes!
      .latticeAnalysis as LatticeGtsAnalysis;
    assert.strictEqual(
      analysis.exports[0].fields[1].bxl?.expression,
      '.count * 2',
    );
    assert.strictEqual(
      analysis.exports[0].indexing,
      'chrome-data',
      'authored runtime effects still need compatible card indexing',
    );
    assert.true(
      visited!.diagnostics!.latticeNative!,
      'interrupted native file output must re-establish its publication fence',
    );
    const dependencyResolver = new IndexRunnerDependencyManager({
      realmURL: new URL(realm),
      virtualNetwork: network,
      readDefinitionCacheEntries: async () => ({}),
      getDependencyRows: async () => [],
      getOrderingDependencyRows: async () => [],
      getInvalidations: () => batch.invalidations,
    });
    await performFileIndexing({
      path: visited!.localPath,
      fileURL: request.url,
      lastModified: 1,
      resourceCreatedAt: 1,
      hasModulePrerender: true,
      realmURL: new URL(realm),
      auth: '',
      jobInfo: { jobId: 42, reservationId: 1, priority: 10, queueWaitMs: null },
      precomputedExtractResult: visited!.fileExtract,
      precomputedRenderResult: visited!.fileRender,
      diagnostics: visited!.diagnostics,
      dependencyResolver,
      virtualNetwork: network,
      updateEntry: (url, entry) => batch.updateEntry(url, entry),
      logWarn() {},
    });
    await batch.done();
    const [row] = await db.execute(
      `SELECT pristine_doc,search_doc FROM boxel_index WHERE realm_url=$1 AND url=$2 AND type='file'`,
      { bind: [realm, request.url] },
    );
    assert.strictEqual((row.search_doc as any).latticeAnalysis, null);
    assert.deepEqual(
      (row.pristine_doc as any).attributes.latticeAnalysis,
      analysis,
      'source-file identity owns the persisted artifact',
    );
  });

  test('native GTS analysis does not depend on the application module cache and fences later source and extractor changes', async (assert) => {
    const { request, index, ref } = await gtsFileFixture();
    await db.execute('UPDATE modules SET error_doc=$1 WHERE url=$2', {
      bind: [
        JSON.stringify({ message: 'application source changed' }),
        realm + 'score',
      ],
    });
    const first = await index(request);
    assert.ok(
      first,
      'unrelated application review does not prevent source analysis',
    );
    await validateFile(first!);
    await db.execute(
      'UPDATE realm_file_meta SET content_hash=$1 WHERE realm_url=$2 AND file_path=$3',
      { bind: [md5(request.source + '\n'), realm, 'new-card.gts'] },
    );
    await assert.rejects(
      validateFile(first!),
      /source or reviewed code changed/,
    );
    await db.execute(
      'UPDATE realm_file_meta SET content_hash=$1 WHERE realm_url=$2 AND file_path=$3',
      { bind: [md5(request.source), realm, 'new-card.gts'] },
    );
    const second = await index(request);
    assert.ok(second);
    await db.execute('UPDATE modules SET deps=$1 WHERE url=$2', {
      bind: [JSON.stringify([base + 'changed-file-api']), ref.module],
    });
    await assert.rejects(validateFile(second!), /definition cache changed/);
  });

  test('GTS data admission is independent of icon production and requires an explicit extractor closure', async (assert) => {
    const { request, index } = await gtsFileFixture(false);
    const result = await index(request);
    assert.ok(
      result?.extract.resource,
      'data is available without an icon artifact',
    );
    assert.strictEqual(
      result?.render,
      undefined,
      'existing Chrome presentation remains eligible',
    );
    await validateFile(result!);
    policy.fileExtractors![0].moduleURLs = undefined;
    const withoutClosure = createLatticeNativeFileIndexer({
      admit: createPostgresLatticeFileAdmission({
        db,
        network,
        policies: [policy],
        runtimeRevision: () => runtime,
      }),
    });
    assert.strictEqual(
      await withoutClosure(request),
      undefined,
      'file metadata alone does not grant native extraction',
    );
  });

  test('warm admission reuses the projected definition; cache replacement is re-read', async (assert) => {
    const run = indexer();
    const first = await run(request);
    const calls = sinon.spy(db, 'execute');
    assert.ok(await run(request));
    assert.false(
      calls.getCalls().some((call) => call.args[0].includes('AS entry')),
      'no definition JSON is decoded again for an unchanged module version',
    );
    await db.execute(
      'UPDATE modules SET definitions=definitions WHERE url=$1',
      { bind: [realm + 'score'] },
    );
    calls.resetHistory();
    assert.ok(await run(request));
    assert.true(
      calls.getCalls().some((call) => call.args[0].includes('AS entry')),
    );
    await assert.rejects(validate(first!), /definition cache changed/);
  });

  test('operator configuration installs the native capability and rejects a mismatched runtime', async (assert) => {
    const directory = await mkdtemp(join(tmpdir(), 'lattice-native-review-'));
    const reviewFile = join(directory, 'review.json');
    await writeFile(reviewFile, JSON.stringify([policy]));
    try {
      await assert.rejects(
        createLatticeNativeWorker({
          db,
          network,
          reviewFile,
          runtimeRevision: 'different-runtime',
        }),
        /matching, versioned realm policies/,
      );
      const native = await createLatticeNativeWorker({
        db,
        network,
        reviewFile,
        runtimeRevision: runtime,
      });
      try {
        const result = await native.indexer(request);
        assert.strictEqual(result?.card.searchDoc?.doubled, 6);
        await validate(result!);
      } finally {
        await native.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('reviewed bootstrap dependencies use registry authority without archive metadata', async (assert) => {
    await db.execute('DELETE FROM realm_metadata WHERE url=$1', {
      bind: [base],
    });
    await db.execute(
      `INSERT INTO realm_registry (url,kind,disk_id,owner_username)
       VALUES ($1,'source','native-base','system')`,
      { bind: [base] },
    );
    assert.strictEqual(
      await indexer()(request),
      undefined,
      'a source registry row cannot replace missing archive authority',
    );
    await db.execute(
      "UPDATE realm_registry SET kind='bootstrap' WHERE url=$1",
      { bind: [base] },
    );
    const result = await candidate();
    assert.strictEqual(result.card.searchDoc?.doubled, 6);
    await validate(result);
    await db.execute("UPDATE realm_registry SET kind='source' WHERE url=$1", {
      bind: [base],
    });
    await assert.rejects(validate(result), /read permission changed/);
    assert.strictEqual(
      await indexer()(request),
      undefined,
      'the changed registry no longer authorizes native work',
    );
  });

  const admissionChanges: [string, () => void | Promise<unknown>][] = [
    [
      'different source bytes',
      () => {
        request.sourceJSON += ' ';
      },
    ],
    [
      'different reviewed source code',
      () => {
        policy.modules[0].sourceMD5 = md5('new code');
      },
    ],
    [
      'different definition digest',
      () => {
        policy.definitions[0].definitionSHA256 = 'different';
      },
    ],
    [
      'another private cache identity',
      () => {
        policy.modules[0].authUserId = '@other:example.com';
      },
    ],
    [
      'public scope without a public grant',
      () => {
        policy.modules[0].cacheScope = 'public';
        policy.modules[0].authUserId = '';
      },
    ],
    [
      'unreviewed root',
      () => {
        policy.roots = [];
      },
    ],
    [
      'missing archive-state row',
      () =>
        db.execute('DELETE FROM realm_metadata WHERE url=$1', { bind: [base] }),
    ],
  ];
  for (const [name, change] of admissionChanges) {
    test(`declines ${name} before native computation`, async (assert) => {
      await change();
      assert.strictEqual(await indexer()(request), undefined);
    });
  }

  const publicationChanges: [string, string, () => void | Promise<unknown>][] =
    [
      [
        'authored bytes',
        'source or reviewed code',
        () =>
          db.execute(
            "UPDATE realm_file_meta SET content_hash='changed' WHERE file_path='Score/one.json'",
          ),
      ],
      [
        'base code',
        'source or reviewed code',
        () =>
          db.execute(
            "UPDATE realm_file_meta SET content_hash='changed' WHERE file_path='number.gts'",
          ),
      ],
      [
        'definition deletion',
        'definition cache',
        () =>
          db.execute('DELETE FROM modules WHERE url=$1', {
            bind: [realm + 'score'],
          }),
      ],
      [
        'read permission',
        'read permission',
        () =>
          db.execute(
            'UPDATE realm_user_permissions SET read=FALSE WHERE realm_url=$1',
            { bind: [realm] },
          ),
      ],
      [
        'realm archive',
        'read permission',
        () =>
          db.execute(
            'UPDATE realm_metadata SET archived_at=CURRENT_TIMESTAMP WHERE url=$1',
            { bind: [base] },
          ),
      ],
      [
        'loader epoch',
        'realm generation',
        () => db.execute("UPDATE realm_generations SET loader_epoch='code-2'"),
      ],
      [
        'missing source clock',
        'realm generation',
        () => db.execute('DELETE FROM realm_generations'),
      ],
      [
        'runtime revision',
        'receipt no longer matches',
        () => {
          runtime = 'native-runtime-2';
        },
      ],
    ];
  for (const [name, error, change] of publicationChanges) {
    test(`a changed ${name} prevents publication`, async (assert) => {
      const result = await candidate();
      await change();
      await assert.rejects(validate(result), new RegExp(error));
    });
  }

  test('aliased reviewed modules sharing a source file do not duplicate commit rows', async (assert) => {
    policy.modules[1].realmURL = realm;
    policy.modules[1].sourcePath = 'score.gts';
    policy.modules[1].sourceMD5 = md5(sourceCode);
    policy.modules[1].cacheScope = 'realm-auth';
    policy.modules[1].authUserId = actor;
    await db.execute(
      'UPDATE modules SET resolved_realm_url=$1,cache_scope=$2,auth_user_id=$3 WHERE url=$4',
      { bind: [realm, 'realm-auth', actor, base + 'number'] },
    );
    await validate(await candidate());
    assert.ok(true, 'the shared file is validated once');
  });

  test('publication locks prevent archive from racing the final checks', async (assert) => {
    const result = await candidate();
    const other = new PgAdapter();
    const entered = new Deferred<void>(),
      release = new Deferred<void>();
    const order: string[] = [];
    const publishing = db.withWriteLock(
      'native-publication-test',
      async (tx) => {
        await result.assertCurrent(tx!);
        entered.fulfill();
        await release.promise;
        order.push('published');
      },
    );
    await entered.promise;
    const archiving = other
      .execute(
        'UPDATE realm_metadata SET archived_at=CURRENT_TIMESTAMP WHERE url=$1',
        { bind: [realm] },
      )
      .then(() => {
        order.push('archived');
      });
    try {
      let blocked = false;
      const deadline = Date.now() + 3000;
      while (!blocked && Date.now() < deadline) {
        const [row] = await db.execute(`SELECT EXISTS (SELECT 1 FROM pg_locks
          WHERE locktype='transactionid' AND NOT granted) AS blocked`);
        blocked = row.blocked === true;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.true(blocked, 'Postgres reports the competing archive waiting');
      release.fulfill();
      await publishing;
      await archiving;
      assert.deepEqual(order, ['published', 'archived']);
    } finally {
      release.fulfill();
      await Promise.allSettled([publishing, archiving]);
      await other.close();
    }
  });
});
