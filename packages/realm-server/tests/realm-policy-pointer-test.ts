import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import type { PgAdapter } from '@cardstack/postgres';
import type { Realm } from '@cardstack/runtime-common';
import { mayNameRealmPolicy } from '../lib/realm-policy-pointer.ts';
import { RealmRegistryReconciler } from '../lib/realm-registry-reconciler.ts';
import { insertSourceRealmInRegistry } from '../lib/realm-registry-writes.ts';
import {
  createVirtualNetwork,
  realmConfigCardJSON,
  setupDB,
} from './helpers/index.ts';

// Whether a realm may name a policy, told without mounting it: read from the
// realm's `realm.json` on disk, found through its registry row. The realms
// here are directories and registry rows only, and the reconciler refuses to
// mount any of them, so an answer that needed a mount would fail the test.
module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let root: string;
  let realmsRootPath: string;
  let reconciler: RealmRegistryReconciler;

  setupDB(hooks, {
    beforeEach: async (dbAdapter) => {
      db = dbAdapter;
      root = dirSync({ unsafeCleanup: true }).name;
      realmsRootPath = join(root, 'realms');
      reconciler = new RealmRegistryReconciler({
        dbAdapter,
        prepareRealmFromRow: (row) => {
          throw new Error(`nothing here may be mounted: ${row.url}`);
        },
        unmount: async () => {},
        pollIntervalMs: 1_000_000,
      });
    },
  });

  // A source realm registered under `diskId`, whose directory holds
  // `realmJSON` as its `realm.json`, or no `realm.json` at all.
  async function realm(diskId: string, realmJSON?: string) {
    let url = `http://127.0.0.1:4444/${diskId.replace(/\W/g, '')}/`;
    let dir = join(realmsRootPath, diskId);
    mkdirSync(dir, { recursive: true });
    if (realmJSON !== undefined) {
      writeFileSync(join(dir, 'realm.json'), realmJSON);
    }
    await insertSourceRealmInRegistry(db, {
      url,
      diskId,
      ownerUsername: 'owner',
    });
    return url;
  }

  // The network a realm on this server is mounted on, which resolves the
  // prefix form of a pointer.
  let virtualNetwork = createVirtualNetwork();

  function mayName(url: string) {
    return mayNameRealmPolicy(url, {
      reconciler,
      realmsRootPath,
      virtualNetwork,
    });
  }

  test('a realm.json that names no policy, or one its owner cleared, says so', async function (assert) {
    let absent = await realm('absent', realmConfigCardJSON({ name: 'Absent' }));
    let cleared = await realm('cleared', realmConfigCardJSON({ policy: null }));
    let blank = await realm('blank', realmConfigCardJSON({ policy: '  ' }));
    await reconciler.reconcile();

    assert.false(await mayName(absent), 'no `policy` attribute');
    assert.false(await mayName(cleared), 'a null `policy`');
    assert.false(await mayName(blank), 'a blank `policy`');
  });

  test('a realm.json with a pointer the realm would keep may name a policy', async function (assert) {
    let named = await realm(
      'named',
      realmConfigCardJSON({ policy: 'http://127.0.0.1:4444/lib/policy' }),
    );
    let prefixed = await realm(
      'prefixed',
      realmConfigCardJSON({ policy: '@cardstack/catalog/policies/policy' }),
    );
    await reconciler.reconcile();

    assert.true(await mayName(named), 'a card URL');
    assert.true(await mayName(prefixed), 'a realm-prefixed card id');
  });

  test('a realm.json with a pointer the realm would drop names no policy, as the realm mounted would say', async function (assert) {
    let number = await realm('number', realmConfigCardJSON({ policy: 5 }));
    let object = await realm(
      'object',
      realmConfigCardJSON({ policy: { card: 'http://127.0.0.1:4444/p' } }),
    );
    let relative = await realm(
      'relative',
      realmConfigCardJSON({ policy: 'policies/policy' }),
    );
    let script = await realm(
      'script',
      realmConfigCardJSON({ policy: 'javascript:void 0' }),
    );
    await reconciler.reconcile();

    assert.false(await mayName(number), 'a number');
    assert.false(await mayName(object), 'an object');
    assert.false(
      await mayName(relative),
      'a relative reference, which has no base to resolve against',
    );
    assert.false(await mayName(script), 'a URL that is not http(s)');
  });

  test('a realm this process holds answers from the pointer it read, not from disk', async function (assert) {
    // Nothing on disk and no registry row: only the mounted realm could answer.
    let held = (url: string, getRealmPolicy: Realm['getRealmPolicy']) =>
      ({ url, getRealmPolicy }) as unknown as Realm;
    let withPolicy = 'http://127.0.0.1:4444/held-with-policy/';
    let withoutPolicy = 'http://127.0.0.1:4444/held-without-policy/';
    let unreadable = 'http://127.0.0.1:4444/held-unreadable/';
    reconciler.registerExistingMounts([
      held(withPolicy, async () => ({
        card: 'http://127.0.0.1:4444/lib/policy',
      })),
      held(withoutPolicy, async () => undefined),
      held(unreadable, async () => {
        throw new Error('the realm could not read its realm.json');
      }),
    ]);

    assert.true(await mayName(withPolicy), 'a realm with a policy');
    assert.false(
      await mayName(withoutPolicy),
      'a realm with none says so, though holding it would make asking it cheap',
    );
    assert.true(
      await mayName(unreadable),
      'a realm whose pointer cannot be read is left to answer when asked',
    );
  });

  test('a realm.json that cannot be read is left to the realm to answer', async function (assert) {
    let missing = await realm('missing');
    let unparseable = await realm('unparseable', '{ "data": ');
    // Outside the realms root, where a `disk_id` must not reach. Its
    // `realm.json` names no policy, so reading it would answer `false`.
    let escaping = await realm('../outside', realmConfigCardJSON({}));
    await reconciler.reconcile();
    // Written after the reconciler last read the registry, so it has no row
    // for it yet.
    let unseen = await realm('unseen', realmConfigCardJSON({}));

    assert.true(await mayName(missing), 'no realm.json');
    assert.true(await mayName(unparseable), 'a realm.json that is not JSON');
    assert.true(
      await mayName(escaping),
      'a registry row whose disk_id leaves the realms root',
    );
    assert.true(
      await mayName(unseen),
      'a realm the reconciler has no registry row for yet',
    );
  });
});
