import QUnit from 'qunit';
import { basename } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  rri,
  type Realm,
  type Prerenderer as Renderer,
} from '@cardstack/runtime-common';
import type { Prerenderer } from '../prerender/prerenderer.ts';
import {
  createJWT,
  getPrerendererForTesting,
  localBaseRealm,
  setupPermissionedRealm,
  waitUntil,
} from './helpers/index.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';

const { module, test } = QUnit;
const origin = 'http://127.0.0.1:4457/';
const realmURL = origin + 'lattice-port-refusal/';
const actor = '@lattice-port:localhost';
const unsafe = realmURL + 'Unsafe/one';
const safe = realmURL + 'Safe/one';
const source = `
  import { bxl } from '@cardstack/bxl';
  import { CardDef, field, contains, linksToMany } from '@cardstack/base/card-api';
  import NumberField from '@cardstack/base/number';
  import { JsonField } from '@cardstack/base/json-field';
  const formula = (text) => bxl(text, { libraries: ['core'], readableSyntax: false });
  export class Entry extends CardDef { @field amount = contains(NumberField); }
  export class Safe extends CardDef {
    static materialized = true;
    static queryInputs = { entries: {} };
    @field entries = linksToMany(Entry, { query: { filter: {}, page: { size: 20 } } });
    @field summary = contains(JsonField, { computeVia: formula('{ rows: [.entries[] | { amount: .amount }] }') });
  }
  export class Unsafe extends CardDef {
    static materialized = true;
    static queryInputs = { entries: {} };
    @field entries = linksToMany(Entry, { query: { filter: {}, page: { size: 20 } } });
    @field summary = contains(JsonField, { computeVia: formula('{ rows: .entries }') });
  }
`;
const card = (name: string, attributes = {}) => ({
  data: {
    type: 'card' as const,
    attributes,
    meta: { adoptsFrom: { module: rri(realmURL + 'cards'), name } },
  },
});

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let realm: Realm;
  let browser: Prerenderer;
  let restore: ReturnType<
    typeof installRealmServerAssertOwnRealmServerBypassPatch
  >;
  let unsafeChromeVisits = 0;
  const renderer: Renderer = {
    async prerenderVisit(args) {
      if (args.inputSnapshot && args.url === unsafe + '.json')
        unsafeChromeVisits++;
      return (await browser.prerenderVisit(args)).response;
    },
    async prerenderModule(args) {
      return (await browser.prerenderModule(args)).response;
    },
    async releaseBatch(args) {
      await browser.releaseBatch(args);
    },
    async runCommand() {
      throw new Error('Unexpected fixture command');
    },
  };
  hooks.before(() => {
    restore = installRealmServerAssertOwnRealmServerBypassPatch();
    browser = getPrerendererForTesting({ serverURL: origin, maxPages: 2 });
  });
  setupPermissionedRealm(hooks, {
    latticeEnabled: true,
    mode: 'before',
    realmURL: new URL(realmURL),
    permissions: { '*': ['read'], [actor]: ['read', 'write', 'realm-owner'] },
    fileSystem: {
      'cards.gts': source,
      'Entry/one.json': card('Entry', { amount: 5 }),
      'Safe/one.json': card('Safe'),
    },
    prerenderer: renderer,
    assetsURL: new URL(process.env.HOST_URL ?? 'http://localhost:4200/'),
    onRealmSetup({ dbAdapter, virtualNetwork, testRealm }) {
      db = dbAdapter;
      realm = testRealm;
      virtualNetwork.mount(async (request) => {
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
    await browser?.stop();
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
        timeoutMessage: 'Port-refusal fixture queue failed to settle',
      },
    );
  }
  test('without native review a whole-card JSON output refuses rather than publishing empty objects', async (assert) => {
    await idle();
    const saved = await fetch(unsafe + '.json', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.card+source',
        'Content-Type': 'application/vnd.card+source',
        Authorization: `Bearer ${await createJWT(realm, actor, ['read', 'write', 'realm-owner'])}`,
      },
      body: JSON.stringify(card('Unsafe')),
    });
    assert.true(
      saved.ok,
      'source capture is independent of derived-output refusal',
    );
    await saved.arrayBuffer();
    await idle();
    assert.ok(
      unsafeChromeVisits > 0,
      'the actual Chrome producer attempted this owner',
    );
    const [owner] = await db.execute(
      'SELECT attributes_json,attributes_generation,dirty_generation FROM lattice_owners WHERE owner_url=$1',
      { bind: [unsafe + '.json'] },
    );
    assert.notEqual(
      owner.dirty_generation,
      null,
      'unsafe output remains pending',
    );
    assert.strictEqual(
      owner.attributes_generation,
      null,
      'no output is committed',
    );
    assert.strictEqual(
      owner.attributes_json,
      null,
      'no empty-object body is accepted',
    );
    const failures = await db.execute(
      'SELECT reason FROM lattice_work_failures WHERE owner_url=$1',
      { bind: [unsafe + '.json'] },
    );
    assert.true(
      failures.some((row) =>
        String(row.reason).includes('Lattice output contains a live card'),
      ),
      'refusal names the unsafe output',
    );
    const [healthy] = await db.execute(
      "SELECT pristine_doc,has_error FROM boxel_index WHERE url=$1 AND type='instance'",
      { bind: [safe + '.json'] },
    );
    assert.false(healthy.has_error);
    assert.deepEqual(
      (healthy.pristine_doc as any).attributes.summary,
      { rows: [{ amount: 5 }] },
      'an explicit data projection remains valid without native review',
    );
  });
});
