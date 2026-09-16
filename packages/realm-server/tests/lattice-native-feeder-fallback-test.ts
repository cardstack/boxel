import QUnit from 'qunit';
import { basename } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  rri,
  type LooseSingleCardDocument,
  type Prerenderer as Renderer,
  type Realm,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import type { LatticeNativeCardIndexer } from '@cardstack/runtime-common/lattice-native-index';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import type { Prerenderer } from '../prerender/prerenderer.ts';
import { publishedNativeIndexer } from './helpers/lattice-captured-native-indexer.ts';
import {
  createJWT,
  getPrerendererForTesting,
  localBaseRealm,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
  waitUntil,
} from './helpers/index.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';

const { module, test } = QUnit;
const origin = 'http://127.0.0.1:4456/';
const realmURL = origin + 'lattice-feeder-fallback/';
const actor = '@lattice-feeder:localhost';
const feeder = realmURL + 'Feeder/one';
const owner = realmURL + 'Summary/one';
const source = `
  import { bxl } from '@cardstack/bxl';
  import { CardDef, field, contains, linksTo, linksToMany } from '@cardstack/base/card-api';
  import NumberField from '@cardstack/base/number';
  const formula = (expression) => bxl(expression, { libraries: ['core'], readableSyntax: false });
  export class Student extends CardDef {
    @field points = contains(NumberField);
  }
  export class Feeder extends CardDef {
    @field student = linksTo(Student);
    @field multiplier = contains(NumberField);
    // This is valid in Chrome but has no native linkInputs declaration.
    @field score = contains(NumberField, { computeVia: formula('.student.points * .multiplier') });
  }
  export class Summary extends CardDef {
    static materialized = true;
    static queryInputs = { feeders: {} };
    @field feeders = linksToMany(Feeder, { query: { filter: {}, page: { size: 20 } } });
    @field total = contains(NumberField, { computeVia: formula('[.feeders[].score] | add // 0') });
  }
`;
function card(
  name: string,
  attributes: Record<string, unknown>,
): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes,
      meta: { adoptsFrom: { module: rri(realmURL + 'cards'), name } },
    },
  };
}
const feederSource = (multiplier: number): LooseSingleCardDocument => ({
  data: {
    ...card('Feeder', { multiplier }).data,
    relationships: { student: { links: { self: '../Student/one' } } },
  },
});
const fixtures = {
  'cards.gts': source,
  'Student/one.json': card('Student', { points: 5 }),
  'Feeder/one.json': feederSource(1),
  'Summary/one.json': card('Summary', {}),
};

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let network: VirtualNetwork;
  let realm: Realm;
  let render: Prerenderer;
  let worker: LatticeBxlWorker;
  let native: LatticeNativeCardIndexer | undefined;
  let restore: ReturnType<
    typeof installRealmServerAssertOwnRealmServerBypassPatch
  >;
  const rejections: string[] = [];
  const chromeData: string[] = [];
  const nativeData: string[] = [];
  const renderer: Renderer = {
    async prerenderVisit(args) {
      if (
        native &&
        args.visitType === 'index' &&
        args.renderOptions?.cardRender
      )
        chromeData.push(args.url);
      return (await render.prerenderVisit(args)).response;
    },
    async prerenderModule(args) {
      return (await render.prerenderModule(args)).response;
    },
    async releaseBatch(args) {
      await render.releaseBatch(args);
    },
    async runCommand() {
      throw new Error('Unexpected fixture command');
    },
  };
  hooks.before(() => {
    restore = installRealmServerAssertOwnRealmServerBypassPatch();
    render = getPrerendererForTesting({ serverURL: origin, maxPages: 2 });
    worker = new LatticeBxlWorker();
    const evaluate = worker.evaluateCard.bind(worker);
    worker.evaluateCard = async (...args) => {
      try {
        return await evaluate(...args);
      } catch (error) {
        rejections.push(String(error));
        throw error;
      }
    };
  });
  setupPermissionedRealm(hooks, {
    latticeEnabled: true,
    mode: 'before',
    realmURL: new URL(realmURL),
    permissions: { '*': ['read'], [actor]: ['read', 'write', 'realm-owner'] },
    fileSystem: fixtures,
    prerenderer: renderer,
    assetsURL: new URL(process.env.HOST_URL ?? 'http://localhost:4200/'),
    nativeCardIndexer: async (request) => {
      const result = await native?.(request);
      if (result) nativeData.push(request.url);
      return result;
    },
    onRealmSetup({ dbAdapter, virtualNetwork, testRealm }) {
      db = dbAdapter;
      network = virtualNetwork;
      realm = testRealm;
      network.mount(async (request) => {
        if (!request.url.startsWith(origin + 'base/')) return null;
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
          return new Response(null, { status: 405 });
        const headers = new Headers(request.headers);
        headers.delete('authorization');
        return fetch(
          request.url.replace(origin + 'base/', localBaseRealm + '/'),
          {
            method: request.method,
            headers,
            signal: request.signal,
          },
        );
      });
    },
  });
  hooks.after(async () => {
    await worker?.close();
    await render?.stop();
    await restore?.restore();
  });
  async function idle() {
    await waitUntil(
      async () =>
        !(
          await db.execute(
            "SELECT 1 FROM jobs WHERE status='unfulfilled' LIMIT 1",
          )
        ).length,
      {
        timeout: 60_000,
        timeoutMessage: 'Feeder fixture queue failed to settle',
      },
    );
  }
  async function indexed(url: string) {
    const rows = await db.execute(
      "SELECT pristine_doc,search_doc,has_error,error_doc,diagnostics FROM boxel_index WHERE url=$1 AND type='instance'",
      { bind: [url + '.json'] },
    );
    if (rows.length !== 1) throw new Error(`Missing fixture row: ${url}`);
    return rows[0];
  }
  test('an undeclared native feeder input falls back to Chrome and its owner publishes current data', async (assert) => {
    await idle();
    const initialFeeder = await indexed(feeder);
    const initialOwner = await indexed(owner);
    assert.false(initialFeeder.has_error, 'Chrome feeder starts healthy');
    assert.false(initialOwner.has_error, 'Chrome owner starts healthy');
    const feederAttributes = (
      initialFeeder.pristine_doc as unknown as LooseSingleCardDocument['data']
    ).attributes!;
    const ownerAttributes = (
      initialOwner.pristine_doc as unknown as LooseSingleCardDocument['data']
    ).attributes!;
    assert.strictEqual(feederAttributes.score, 5);
    assert.strictEqual(ownerAttributes.total, 5);
    native = await publishedNativeIndexer({
      db,
      network,
      realm,
      actor,
      renderer,
      worker,
      refs: ['Feeder', 'Summary'].map((name) => ({
        module: rri(realmURL + 'cards'),
        name,
      })),
      sourcePaths: Object.keys(fixtures),
      createPrerenderAuth: testCreatePrerenderAuth,
    });
    const response = await fetch(feeder + '.json', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.card+source',
        'Content-Type': 'application/vnd.card+source',
        Authorization: `Bearer ${await createJWT(realm, actor, ['read', 'write', 'realm-owner'])}`,
      },
      body: JSON.stringify(feederSource(2)),
    });
    assert.true(response.ok, 'ordinary source save succeeds');
    await response.arrayBuffer();
    await idle();
    assert.true(
      rejections.some((error) =>
        error.includes('Unadmitted computed input: $.student.points'),
      ),
      'actual native evaluation refuses the undeclared input',
    );
    assert.true(
      chromeData.some((url) => url === feeder || url === feeder + '.json'),
      'real Chrome computes the feeder after native refusal',
    );
    assert.true(
      nativeData.includes(owner + '.json'),
      'downstream owner still uses guarded native publication',
    );
    const nextFeeder = await indexed(feeder);
    const nextOwner = await indexed(owner);
    assert.false(nextFeeder.has_error, JSON.stringify(nextFeeder.error_doc));
    assert.false(nextOwner.has_error, JSON.stringify(nextOwner.error_doc));
    assert.true(
      (nextOwner.diagnostics as { latticeNative?: boolean })?.latticeNative,
      'the committed owner row came from the native producer',
    );
    for (const [previous, next] of [
      [initialFeeder, nextFeeder],
      [initialOwner, nextOwner],
    ]) {
      assert.deepEqual(
        (next.pristine_doc as unknown as LooseSingleCardDocument['data'])
          .relationships,
        (previous.pristine_doc as unknown as LooseSingleCardDocument['data'])
          .relationships,
        'published relationships retain their card identities',
      );
    }
    assert.deepEqual(
      (nextFeeder.pristine_doc as unknown as LooseSingleCardDocument['data'])
        .attributes,
      { ...feederAttributes, multiplier: 2, score: 10 },
      'complete feeder attributes are preserved',
    );
    assert.deepEqual(
      (nextOwner.pristine_doc as unknown as LooseSingleCardDocument['data'])
        .attributes,
      { ...ownerAttributes, total: 10 },
      'complete owner attributes update',
    );
    assert.strictEqual(
      (nextOwner.search_doc as Record<string, unknown>).total,
      10,
      'searchable output matches',
    );
    const owners = await db.execute(
      'SELECT dirty_generation,published_generation FROM lattice_owners WHERE realm_url=$1 AND owner_url=$2',
      { bind: [realmURL, owner + '.json'] },
    );
    assert.strictEqual(owners.length, 1);
    assert.true(
      Number(owners[0]?.published_generation) >=
        Number(owners[0]?.dirty_generation),
      'owner publication is current',
    );
  });
});
