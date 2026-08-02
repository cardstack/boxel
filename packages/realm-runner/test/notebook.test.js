import assert from 'node:assert/strict';
import test from 'node:test';

import { RealmNotebookCoordinator } from '../src/notebook.js';
import {
  EncryptedNotebookStorage,
  MemoryNotebookStorage,
  RealmFileNotebookStorage,
} from '../src/notebook-storage.js';

function authorizationFor(user) {
  let encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `Bearer ${encode({ alg: 'none' })}.${encode({ user })}.signature`;
}

class FakeRealmAdapter {
  constructor() {
    this.files = new Map();
  }

  async readText(_realmUrl, path) {
    return this.files.get(path);
  }

  async atomicWrite(_realmUrl, changes) {
    for (let change of changes) {
      if (change.operation === 'remove') this.files.delete(change.path);
      else this.files.set(change.path, change.content);
    }
  }
}

test('ephemeral notebook storage expires records', async () => {
  let now = 1_000;
  let storage = new MemoryNotebookStorage({ now: () => now });
  await storage.set('session/record', { answer: 42 }, { expiresAt: 2_000 });

  assert.deepEqual(await storage.get('session/record'), { answer: 42 });
  now = 2_001;
  assert.equal(await storage.get('session/record'), undefined);
});

test('touching an ephemeral notebook extends every record in the session', async () => {
  let now = 1_000;
  let storage = new MemoryNotebookStorage({ now: () => now });
  await storage.set('session/manifest', { cells: {} }, { expiresAt: 2_000 });
  await storage.set(
    'session/executions/old',
    { value: 1 },
    { expiresAt: 2_000 },
  );

  now = 1_900;
  await storage.touchPrefix('session', 2_900);
  now = 2_100;

  assert.deepEqual(await storage.get('session/executions/old'), { value: 1 });
});

test('durable Realm notebook records are encrypted at rest', async () => {
  let adapter = new FakeRealmAdapter();
  let underlying = new RealmFileNotebookStorage({
    adapter,
    realmUrl: 'https://example.test/workspace/',
  });
  let storage = new EncryptedNotebookStorage({
    storage: underlying,
    keyMaterial: 'test-realm-secret-seed-that-is-long-enough',
  });

  await storage.set('scope/executions/abc', {
    privateSource: 'do not expose this federated source',
  });

  let persisted = [...adapter.files.values()][0];
  assert.equal(persisted.includes('do not expose'), false);
  assert.deepEqual(await storage.get('scope/executions/abc'), {
    privateSource: 'do not expose this federated source',
  });
});

test('notebook cells reuse completed work and pass immutable outputs forward', async () => {
  let coordinator = new RealmNotebookCoordinator();
  let calls = [];
  let common = {
    mode: 'preview',
    realmURL: 'https://example.test/workspace/',
    authorization: authorizationFor('@user:example.test'),
    adapter: {},
  };

  let search = await coordinator.execute({
    ...common,
    notebook: { sessionId: 'room-1', cellId: 'search' },
    code: 'return search();',
    run: async (input) => {
      calls.push({ cell: 'search', input });
      return {
        ok: true,
        mode: 'preview',
        value: { candidates: ['one.gts', 'two.gts'] },
        changes: [],
        effects: [],
        logs: [],
        stats: {},
      };
    },
  });

  let grep = await coordinator.execute({
    ...common,
    notebook: {
      sessionId: 'room-1',
      cellId: 'grep',
      inputs: {
        candidates: { cellId: 'search', pointer: '/result/value/candidates' },
      },
    },
    code: 'return grep(realm.input.candidates);',
    run: async (input) => {
      calls.push({ cell: 'grep', input });
      return {
        ok: true,
        mode: 'preview',
        value: input.candidates.filter((path) => path.startsWith('two')),
        changes: [],
        effects: [],
        logs: [],
        stats: {},
      };
    },
  });

  let repeatedSearch = await coordinator.execute({
    ...common,
    notebook: { sessionId: 'room-1', cellId: 'search' },
    code: 'return search();',
    run: async () => {
      throw new Error('completed cell must not execute again');
    },
  });

  assert.deepEqual(calls, [
    { cell: 'search', input: {} },
    {
      cell: 'grep',
      input: { candidates: ['one.gts', 'two.gts'] },
    },
  ]);
  assert.deepEqual(grep.value, ['two.gts']);
  assert.equal(search.notebook.reused, false);
  assert.equal(repeatedSearch.notebook.reused, true);
  assert.equal(
    repeatedSearch.notebook.executionId,
    search.notebook.executionId,
  );
});

test('notebook ownership isolates identical session ids', async () => {
  let coordinator = new RealmNotebookCoordinator();
  let execute = (user, value) =>
    coordinator.execute({
      notebook: { sessionId: 'same-room', cellId: 'cell' },
      code: 'return value;',
      mode: 'preview',
      realmURL: 'https://example.test/workspace/',
      authorization: authorizationFor(user),
      adapter: {},
      run: async () => ({ ok: true, value }),
    });

  let first = await execute('@one:example.test', 1);
  let second = await execute('@two:example.test', 2);

  assert.equal(first.value, 1);
  assert.equal(second.value, 2);
  assert.notEqual(first.notebook.executionId, second.notebook.executionId);
});

test('saved cell source can be rerun and downstream cells consume its latest output', async () => {
  let coordinator = new RealmNotebookCoordinator();
  let upstreamValue = 1;
  let common = {
    mode: 'preview',
    realmURL: 'https://example.test/workspace/',
    authorization: authorizationFor('@user:example.test'),
    adapter: {},
  };
  let runUpstream = async (_input, savedCode) => ({
    ok: true,
    value: { number: upstreamValue, savedCode },
  });

  await coordinator.execute({
    ...common,
    notebook: { sessionId: 'jupyter', cellId: 'source' },
    code: 'return loadCurrentData();',
    run: runUpstream,
  });
  let firstDownstream = await coordinator.execute({
    ...common,
    notebook: {
      sessionId: 'jupyter',
      cellId: 'transform',
      inputs: {
        source: { cellId: 'source', pointer: '/result/value/number' },
      },
    },
    code: 'return realm.input.source * 10;',
    run: async (input) => ({ ok: true, value: input.source * 10 }),
  });

  upstreamValue = 2;
  let rerunUpstream = await coordinator.execute({
    ...common,
    notebook: {
      sessionId: 'jupyter',
      cellId: 'source',
      runSaved: true,
      force: true,
    },
    code: undefined,
    run: runUpstream,
  });
  let secondDownstream = await coordinator.execute({
    ...common,
    notebook: {
      sessionId: 'jupyter',
      cellId: 'transform',
      runSaved: true,
      // Some clients naturally serialize an empty input-ref collection. A
      // saved run must still use the cell's saved bindings.
      inputs: {},
    },
    code: undefined,
    run: async (input, savedCode) => ({
      ok: true,
      value: { result: input.source * 10, savedCode },
    }),
  });
  let editedDownstream = await coordinator.execute({
    ...common,
    notebook: {
      sessionId: 'jupyter',
      cellId: 'transform',
      inputs: {
        source: { cellId: 'source', pointer: '/result/value/number' },
      },
    },
    code: 'return realm.input.source * 100;',
    run: async (input) => ({ ok: true, value: input.source * 100 }),
  });

  assert.equal(firstDownstream.value, 10);
  assert.equal(rerunUpstream.value.number, 2);
  assert.equal(rerunUpstream.value.savedCode, 'return loadCurrentData();');
  assert.deepEqual(secondDownstream.value, {
    result: 20,
    savedCode: 'return realm.input.source * 10;',
  });
  assert.equal(rerunUpstream.notebook.revision, 2);
  assert.equal(secondDownstream.notebook.revision, 2);
  assert.equal(
    rerunUpstream.notebook.snapshot.cells.find(
      (cell) => cell.cellId === 'transform',
    ).stale,
    true,
  );
  assert.equal(
    secondDownstream.notebook.snapshot.cells.find(
      (cell) => cell.cellId === 'transform',
    ).stale,
    false,
  );
  assert.equal(editedDownstream.value, 200);
  assert.equal(editedDownstream.notebook.revision, 3);
  assert.equal(
    editedDownstream.notebook.snapshot.cells.find(
      (cell) => cell.cellId === 'transform',
    ).source,
    'return realm.input.source * 100;',
  );
});

test('saved cells can be parameterized with new literal realm.input data', async () => {
  let coordinator = new RealmNotebookCoordinator();
  let common = {
    mode: 'preview',
    realmURL: 'https://example.test/workspace/',
    authorization: authorizationFor('@user:example.test'),
    adapter: {},
    run: async (input, savedCode) => ({
      ok: true,
      value: { product: input.value * 2, savedCode },
    }),
  };
  await coordinator.execute({
    ...common,
    notebook: { sessionId: 'parameters', cellId: 'double' },
    input: { value: 2 },
    code: 'return realm.input.value * 2;',
  });
  let rerun = await coordinator.execute({
    ...common,
    notebook: {
      sessionId: 'parameters',
      cellId: 'double',
      runSaved: true,
      force: true,
    },
    input: { value: 5 },
    code: undefined,
  });

  assert.deepEqual(rerun.value, {
    product: 10,
    savedCode: 'return realm.input.value * 2;',
  });
});
