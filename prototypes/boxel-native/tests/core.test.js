import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSqlite } from '../core/sqlite.js';
import { BoxelNativeRuntime } from '../core/runtime.js';
import { seed } from '../core/seed.js';
import { planSync } from '../core/sync-logic.js';

function boot() {
  const db = createSqlite();
  const runtime = new BoxelNativeRuntime(db);
  runtime.bootstrap(seed);
  return runtime;
}

test('lite indexer writes boxel_index rows from the realm filesystem', () => {
  const runtime = boot();
  const cards = runtime.searchCards();
  const titles = cards.map((c) => c.title).sort();
  assert.ok(titles.includes('Maple Grove'));
  assert.ok(titles.includes('River Stone'));
  assert.ok(titles.includes('Nimbus'));
  assert.ok(titles.includes('Offline draft'));
  const maple = runtime.getCard('maple-grove');
  assert.equal(maple.searchDoc.firstName, 'Maple');
  assert.equal(maple.pristineDoc.meta.adoptsFrom.name, 'Person');
});

test('search uses sqlite json_extract against search_doc', () => {
  const runtime = boot();
  const hits = runtime.searchCards('nimbus');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].fileAlias, 'nimbus');
});

test('creating a card writes a JSON file then reindexes', () => {
  const runtime = boot();
  const card = runtime.createPersonCard({
    firstName: 'Cedar',
    lastName: 'Hollow',
  });
  assert.equal(card.title, 'Cedar Hollow');
  assert.ok(runtime.fs.read('cedar-hollow.json'));
  assert.equal(runtime.searchCards('Cedar').length, 1);
  const plan = runtime.previewSync('newest');
  const created = plan.find((p) => p.relativePath === 'cedar-hollow.json');
  assert.equal(created.action, 'push');
});

test('offline messages queue; going online marks them synced', () => {
  const runtime = boot();
  assert.equal(runtime.online, false);
  runtime.sendMessage({
    roomId: 'offline-notes',
    body: 'queued on device',
    cardAlias: 'offline-draft',
  });
  assert.equal(runtime.messenger.queuedMessages().length, 1);
  runtime.setOnline(true);
  assert.equal(runtime.messenger.queuedMessages().length, 0);
});

test('sync plan matches boxel-cli classify: local-only push, remote-only pull', () => {
  const runtime = boot();
  const plan = runtime.previewSync('newest');
  const byPath = Object.fromEntries(plan.map((p) => [p.relativePath, p]));
  assert.equal(byPath['offline-draft.json'].action, 'push');
  assert.equal(byPath['server-welcome.json'].action, 'pull');
  assert.equal(byPath['maple-grove.json'].action, 'noop');
});

test('online sync with prefer-newest pushes the draft and pulls the server card', () => {
  const runtime = boot();
  runtime.setOnline(true);
  const result = runtime.sync({ prefer: 'newest' });
  const actions = result.log.map((l) => `${l.action}:${l.relativePath}`).sort();
  assert.ok(actions.includes('push:offline-draft.json'));
  assert.ok(actions.includes('pull:server-welcome.json'));
  assert.ok(runtime.fs.read('server-welcome.json'));
  assert.ok(runtime.remote.read('offline-draft.json'));
  assert.ok(runtime.getCard('server-welcome'));
  const after = runtime.previewSync('newest');
  assert.ok(after.every((p) => p.action === 'noop'));
});

test('sync refuses to run while offline', () => {
  const runtime = boot();
  assert.throws(() => runtime.sync({ prefer: 'newest' }), /offline/i);
});

test('planSync conflict without a strategy stays conflict', () => {
  const plan = planSync({
    localHashes: new Map([['a.json', 'local']]),
    localMtimes: new Map([['a.json', Date.now()]]),
    remoteMtimes: new Map([['a.json', 1]]),
    manifest: {
      realmUrl: 'https://local.boxel/preview/',
      files: { 'a.json': 'old' },
      remoteMtimes: { 'a.json': 0 },
    },
    prefer: null,
  });
  assert.equal(plan[0].action, 'conflict');
});
