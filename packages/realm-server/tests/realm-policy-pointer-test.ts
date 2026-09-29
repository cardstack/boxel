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
import { realmConfigCardJSON, setupDB } from './helpers/index.ts';

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

  function mayName(url: string) {
    return mayNameRealmPolicy(url, { reconciler, realmsRootPath });
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

  test('a realm.json with a pointer may name a policy, well-formed or not', async function (assert) {
    let named = await realm(
      'named',
      realmConfigCardJSON({ policy: 'http://127.0.0.1:4444/lib/policy' }),
    );
    let malformed = await realm(
      'malformed',
      realmConfigCardJSON({ policy: 5 }),
    );
    await reconciler.reconcile();

    assert.true(await mayName(named), 'a card URL');
    assert.true(
      await mayName(malformed),
      'a value the realm itself would refuse, and so is left to it to refuse',
    );
  });

  test('a realm this process holds is asked directly, not read from disk', async function (assert) {
    // Nothing on disk and no registry row: only the mounted realm could answer.
    let url = 'http://127.0.0.1:4444/held/';
    reconciler.registerExistingMounts([{ url } as Realm]);

    assert.true(await mayName(url));
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
