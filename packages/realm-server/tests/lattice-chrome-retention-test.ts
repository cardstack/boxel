import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  RealmPaths,
  CachingDefinitionLookup,
  rri,
  type LooseSingleCardDocument,
  type VirtualNetwork,
  type InstanceEntry,
  type Prerenderer as PrerendererAPI,
} from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import type { LatticeBrowserInputCapture } from '@cardstack/runtime-common/lattice-browser-inputs';
import { renderFileForIndexing } from '@cardstack/runtime-common/index-runner/visit-file';
import type { Prerenderer } from '../prerender/prerenderer.ts';
import {
  getPrerendererForTesting,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
  waitUntil,
} from './helpers/index.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';

const { module, test } = QUnit;
const realmURL = 'http://127.0.0.1:4454/lattice-retention/';
const actor = '@lattice-retention:localhost';
const ownerURL = realmURL + 'Owner/one.json';
const source = `
  import { CardDef, Component, field, contains, linksTo, linksToMany } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  export class Person extends CardDef {
    @field firstName = contains(StringField);
    @field peer = linksTo(Person);
  }
  export class Owner extends CardDef {
    static materialized = true;
    @field direct = linksTo(Person);
    @field people = linksToMany(Person, { query: { page: { size: 20 } } });
    @field privatePeople = linksToMany(Person, { query: { page: { size: 20 } }, snapshot: false });
    @field names = contains(StringField, { computeVia: function() {
      return (this.direct?.firstName ?? '') + ':' + this.people.map(p => p.peer?.firstName ?? p.firstName).join(',');
    } });
    static isolated = class extends Component<typeof this> { <template><output>{{@model.names}}</output></template> };
  }
`;
const card = (
  name: string,
  attributes: Record<string, unknown>,
  relationships = {},
): LooseSingleCardDocument => ({
  data: {
    type: 'card',
    attributes,
    relationships,
    meta: { adoptsFrom: { module: rri('../cards'), name } },
  },
});
const owner = card(
  'Owner',
  {},
  { direct: { links: { self: '../Person/one' } } },
);

module('Lattice | Chrome retained input publication', (hooks) => {
  let db: PgAdapter;
  let network: VirtualNetwork;
  let browser: Prerenderer;
  let lastCapture: LatticeBrowserInputCapture | undefined;
  let originPatch: ReturnType<
    typeof installRealmServerAssertOwnRealmServerBypassPatch
  >;
  const auth = () => {
    const sessions = JSON.parse(
      testCreatePrerenderAuth(actor, {
        [realmURL]: ['read', 'write', 'realm-owner'],
      }),
    );
    sessions[new URL(realmURL).origin + '/'] = sessions[realmURL];
    return JSON.stringify(sessions);
  };
  const renderer: PrerendererAPI = {
    async prerenderVisit(args) {
      const response = (await browser.prerenderVisit(args)).response;
      if (args.inputSnapshot?.retainLinks)
        lastCapture = response.card?.retainedInputs;
      return response;
    },
    async prerenderModule(args) {
      return (await browser.prerenderModule(args)).response;
    },
    async runCommand() {
      throw new Error('Unexpected command');
    },
    async releaseBatch(args) {
      await browser.releaseBatch(args);
    },
  };
  hooks.before(() => {
    originPatch = installRealmServerAssertOwnRealmServerBypassPatch();
    browser = getPrerendererForTesting({
      serverURL: new URL(realmURL).origin,
      maxPages: 2,
    });
  });
  hooks.after(async () => {
    await originPatch.restore();
    await browser.stop();
  });
  setupPermissionedRealm(hooks, {
    latticeEnabled: true,
    mode: 'before',
    realmURL: new URL(realmURL),
    permissions: { '*': ['read'], [actor]: ['read', 'write', 'realm-owner'] },
    fileSystem: {
      'cards.gts': source,
      'Person/one.json': card(
        'Person',
        { firstName: 'Avery' },
        { peer: { links: { self: './two' } } },
      ),
      'Person/two.json': card('Person', { firstName: 'Quinn' }),
      'Owner/one.json': owner,
    },
    prerenderer: renderer,
    onRealmSetup({ dbAdapter, virtualNetwork }) {
      db = dbAdapter;
      network = virtualNetwork;
    },
  });

  test('real Chrome supplies trusted query and declared links to guarded Batch publication', async (assert) => {
    await waitUntil(
      async () =>
        !(
          await db.execute(
            "SELECT 1 FROM jobs WHERE status='unfulfilled' LIMIT 1",
          )
        ).length,
      {
        timeout: 60_000,
        timeoutMessage: 'Retention fixture indexing did not finish',
      },
    );
    await db.execute(
      'INSERT INTO realm_metadata(url) VALUES($1) ON CONFLICT DO NOTHING',
      { bind: [realmURL] },
    );
    const writer = new IndexWriter(db, {
      lattice: new LatticeRealmConfig([realmURL]),
    });
    const lookup = new CachingDefinitionLookup(
      db,
      renderer,
      network,
      testCreatePrerenderAuth,
    );
    const publication = writer.latticePublication(lookup, network);
    const prepare = async () => {
      const batch = await writer.createBatch(new URL(realmURL), network);
      const unexpected = async (): Promise<never> => {
        throw new Error('Unexpected stream');
      };
      const result = await renderFileForIndexing({
        url: new URL(ownerURL),
        realmURL: new URL(realmURL),
        realmPaths: new RealmPaths(new URL(realmURL), network),
        batch,
        ignoreMap: new Map(),
        auth: auth(),
        batchId: 'chrome-retention',
        jobInfo: {
          jobId: 918,
          reservationId: 1,
          priority: 10,
          queueWaitMs: null,
        },
        virtualNetwork: network,
        prerenderer: renderer,
        inputSnapshot: {
          realmURL,
          generation: batch.currentGeneration - 1,
        },
        reader: {
          readFile: async () => ({
            content: JSON.stringify(owner),
            lastModified: 1,
            created: 1,
            path: 'Owner/one.json',
          }),
          readStream: unexpected,
          mtimes: async () => ({ [ownerURL]: 1 }),
        },
        consumeClearCacheForRender: () => false,
        logDebug() {},
        logWarn(message) {
          console.warn(message);
        },
      });
      if (
        !result?.card?.serialized ||
        result.card.error ||
        !result.card.searchDoc
      )
        throw new Error(
          'Chrome retention failed: ' + result?.card?.error?.error.message,
        );
      await batch.updateEntry(new URL(ownerURL), {
        type: 'instance',
        resource: result.card.serialized.data,
        searchData: result.card.searchDoc,
        types: result.card.types!,
        displayNames: result.card.displayNames!,
        deps: new Set(result.card.deps),
        lastModified: 1,
        resourceCreatedAt: 1,
      } as InstanceEntry);
      return {
        result,
        generation: batch.currentGeneration,
        capture: lastCapture,
        publish: () =>
          batch.done({
            lattice: publication,
            latticeInputGeneration: batch.currentGeneration - 1,
            countIndexEntries: false,
          }),
      };
    };
    const initialBodies = await db.execute(
      'SELECT digest FROM lattice_retained_bodies ORDER BY digest',
    );
    const first = await prepare();
    assert.ok(
      first.capture?.inputs.length,
      'real Chrome returned input receipts',
    );
    assert.strictEqual(
      first.result.card!.serialized!.data.attributes?.names,
      'Avery:Quinn,Quinn',
    );
    assert.deepEqual(
      await db.execute(
        'SELECT digest FROM lattice_retained_bodies ORDER BY digest',
      ),
      initialBodies,
      'rendering does not write retained copies',
    );
    await first.publish();
    assert.deepEqual(
      await db.execute(
        'SELECT owner_url,field_path,source_url FROM lattice_retained_snapshots ORDER BY owner_url,field_path,source_url',
      ),
      [
        {
          owner_url: ownerURL.slice(0, -5),
          field_path: 'direct',
          source_url: realmURL + 'Person/one',
        },
        {
          owner_url: ownerURL.slice(0, -5),
          field_path: 'people',
          source_url: realmURL + 'Person/one',
        },
        {
          owner_url: ownerURL.slice(0, -5),
          field_path: 'people',
          source_url: realmURL + 'Person/two',
        },
        {
          owner_url: realmURL + 'Person/one',
          field_path: 'peer',
          source_url: realmURL + 'Person/two',
        },
      ],
    );
    const before = await db.execute(
      'SELECT owner_url,field_path,digest,validated_through FROM lattice_retained_snapshots ORDER BY owner_url,field_path,source_url',
    );
    const [bodies] = await db.execute(
      `SELECT bool_and(b.document=jsonb_build_object('data',
        jsonb_set(i.pristine_doc,'{id}',to_jsonb(s.source_url)))) AS complete
       FROM lattice_retained_snapshots s
       JOIN lattice_retained_bodies b ON b.realm_url=s.realm_url AND b.digest=s.digest
       JOIN boxel_index i ON i.realm_url=s.source_realm_url
         AND i.url=s.source_url || '.json' AND i.type='instance'`,
    );
    assert.true(
      bodies.complete,
      'retains the full indexed bodies, not sparse search items',
    );
    // Change a real input so publication promotes a changed owner. An equal
    // output correctly keeps its old generation and cannot exercise this CHECK.
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,firstName}','\"Rollback candidate\"') WHERE url=$1 AND type='instance'",
      { bind: [realmURL + 'Person/two.json'] },
    );
    const failed = await prepare();
    await db.execute(
      `ALTER TABLE boxel_index ADD CONSTRAINT reject_chrome_retained_owner
       CHECK (url NOT LIKE '%Owner/one.json' OR generation <> ${failed.generation})`,
    );
    try {
      await assert.rejects(failed.publish(), /reject_chrome_retained_owner/);
      assert.deepEqual(
        await db.execute(
          'SELECT owner_url,field_path,digest,validated_through FROM lattice_retained_snapshots ORDER BY owner_url,field_path,source_url',
        ),
        before,
        'a failure after capture rolls back copies with owner promotion',
      );
      const [generation] = await db.execute(
        'SELECT current_generation FROM realm_generations WHERE realm_url=$1',
        { bind: [realmURL] },
      );
      assert.strictEqual(
        Number(generation.current_generation),
        first.generation,
      );
    } finally {
      await db.execute(
        'ALTER TABLE boxel_index DROP CONSTRAINT reject_chrome_retained_owner',
      );
    }
    const stale = await prepare();
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,firstName}','\"Changed\"') WHERE url=$1",
      { bind: [realmURL + 'Person/two.json'] },
    );
    await assert.rejects(
      stale.publish(),
      /Retained input changed before capture/,
    );
    assert.deepEqual(
      await db.execute(
        'SELECT owner_url,field_path,digest,validated_through FROM lattice_retained_snapshots ORDER BY owner_url,field_path,source_url',
      ),
      before,
      'stale input rejection preserves all previously committed copies',
    );
  });
});
