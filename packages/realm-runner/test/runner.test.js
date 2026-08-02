import assert from 'node:assert/strict';
import test from 'node:test';

import { runRealmScript } from '../src/runner.js';

class FakeAdapter {
  constructor(files = {}, searchResults = []) {
    this.files = new Map(Object.entries(files));
    this.searchResults = searchResults;
    this.commits = [];
    this.searchCalls = [];
    this.rawRequests = [];
  }

  async listRealms() {
    return [
      {
        id: 'https://example.test/one/',
        url: 'https://example.test/one/',
        canRead: true,
        canWrite: true,
      },
      {
        id: 'https://example.test/two/',
        url: 'https://example.test/two/',
        canRead: true,
        canWrite: false,
      },
    ];
  }

  async listFiles() {
    return [...this.files.keys()];
  }

  async readText(_realm, path) {
    return this.files.get(path);
  }

  async indexingErrors() {
    return { data: [] };
  }

  async search(realms) {
    this.searchCalls.push(structuredClone(realms));
    return structuredClone(this.searchResults);
  }

  async atomicWrite(_realm, changes) {
    this.commits.push(structuredClone(changes));
    for (let change of changes) {
      if (change.operation === 'remove') this.files.delete(change.path);
      else this.files.set(change.path, change.content);
    }
    return { committed: changes.length };
  }

  async realmRequest(realm, method, path, options) {
    this.rawRequests.push({ scope: 'realm', realm, method, path, options });
    return { ok: true, status: 201, headers: {}, body: { created: true } };
  }

  async serverRequest(method, path, options) {
    this.rawRequests.push({ scope: 'server', method, path, options });
    return { ok: true, status: 202, headers: {}, body: { queued: true } };
  }
}

class FakeBxl {
  evaluate(expression, input, options) {
    return { expression, input, syntax: options?.syntax ?? 'auto' };
  }
}

test('runs a Realm Script with no ambient Node authority', async () => {
  let result = await runRealmScript({
    code: `return {
      current: realm.current,
      processType: typeof process,
      requireType: typeof require,
      fetchType: typeof fetch,
    };`,
    realm: 'https://example.test/demo/',
    adapter: new FakeAdapter(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    current: { url: 'https://example.test/demo/', mode: 'preview' },
    processType: 'undefined',
    requireType: 'undefined',
    fetchType: 'undefined',
  });
});

test('advertises notebook and activity support in Realm API v2', async () => {
  let notebook = {
    sessionId: 'research',
    cellId: 'search',
    revision: 2,
    executionId: 'a'.repeat(64),
    persistence: 'ephemeral',
  };
  let result = await runRealmScript({
    code: `return {
      apiVersion: realm.apiVersion,
      features: realm.features,
      notebook: realm.notebook,
      help: await realm.help(),
    };`,
    realm: 'https://example.test/demo/',
    notebook,
    adapter: new FakeAdapter(),
  });

  assert.equal(result.value.apiVersion, '2');
  assert.deepEqual(result.value.features, {
    notebooks: true,
    activity: true,
    streamingActivity: true,
  });
  assert.deepEqual(result.value.notebook, notebook);
  assert.equal(result.value.help.apiVersion, '2');
  assert.equal(result.value.help.features.notebooks, true);
  assert.equal(
    result.value.help.methods.includes('realm.activity(messageOrDetails)'),
    true,
  );
});

test('emits sanitized semantic and automatic activity without arguments or results', async () => {
  let activity = [];
  await runRealmScript({
    code: `
      await realm.activity({
        phase: 'narrow',
        message: 'Narrowing candidates',
        current: 1,
        total: 2,
      });
      await realm.fs.glob('private/**/*.gts');
      return 'secret-result';
    `,
    realm: 'https://example.test/demo/',
    adapter: new FakeAdapter({ 'private/secret.gts': 'secret source' }),
    onActivity(event) {
      activity.push(event);
    },
  });

  assert.deepEqual(
    activity.map(({ phase, message, source, status }) => ({
      phase,
      message,
      source,
      status,
    })),
    [
      {
        phase: 'start',
        message: 'Starting Realm Script',
        source: 'runtime',
        status: 'running',
      },
      {
        phase: 'narrow',
        message: 'Narrowing candidates',
        source: 'script',
        status: 'running',
      },
      {
        phase: 'list',
        message: 'Finding candidate files',
        source: 'runtime',
        status: 'running',
      },
      {
        phase: 'finalize',
        message: 'Finalizing Realm Script preview',
        source: 'runtime',
        status: 'running',
      },
      {
        phase: 'complete',
        message: 'Realm Script complete',
        source: 'runtime',
        status: 'completed',
      },
    ],
  );
  assert.equal(JSON.stringify(activity).includes('private/secret.gts'), false);
  assert.equal(JSON.stringify(activity).includes('secret-result'), false);
});

test('provides deeply frozen JSON input to an isolated Realm Script', async () => {
  let result = await runRealmScript({
    code: `
      const before = realm.input.nested.count;
      try { realm.input.nested.count = 99; } catch {}
      return {
        before,
        after: realm.input.nested.count,
        frozen: Object.isFrozen(realm.input) && Object.isFrozen(realm.input.nested),
      };
    `,
    realm: 'https://example.test/demo/',
    input: { nested: { count: 3 } },
    adapter: new FakeAdapter(),
  });

  assert.deepEqual(result.value, { before: 3, after: 3, frozen: true });
});

test('globs, reads, transforms, and previews JSON writes', async () => {
  let adapter = new FakeAdapter({
    'data/a.json': '{"count":1}\n',
    'data/b.json': '{"count":2}\n',
    'notes/readme.md': 'hello\n',
  });
  let result = await runRealmScript({
    code: `
      const paths = await realm.fs.glob('data/*.json');
      for (const path of paths) {
        const value = await realm.fs.readJSON(path);
        value.count += 10;
        await realm.fs.writeJSON(path, value);
      }
      return { paths };
    `,
    realm: 'https://example.test/demo/',
    adapter,
  });

  assert.deepEqual(result.value.paths, ['data/a.json', 'data/b.json']);
  assert.equal(result.changes.length, 2);
  assert.equal(adapter.commits.length, 0);
  assert.equal(adapter.files.get('data/a.json'), '{"count":1}\n');
});

test('commits staged writes once through the atomic adapter', async () => {
  let adapter = new FakeAdapter({
    'hello.txt': 'hello\n',
    'obsolete.txt': 'remove me\n',
  });
  let result = await runRealmScript({
    code: `
      await realm.fs.replace('hello.txt', 'hello', 'goodbye', { expectedMatches: 1 });
      await realm.fs.writeText('new.txt', 'created\\n');
      await realm.fs.remove('obsolete.txt');
      return 'done';
    `,
    realm: 'https://example.test/demo/',
    mode: 'commit',
    adapter,
  });

  assert.equal(result.value, 'done');
  assert.equal(adapter.commits.length, 1);
  assert.equal(adapter.commits[0].length, 3);
  assert.equal(adapter.files.get('hello.txt'), 'goodbye\n');
  assert.equal(adapter.files.get('new.txt'), 'created\n');
  assert.equal(adapter.files.has('obsolete.txt'), false);
});

test('captures bounded console output', async () => {
  let result = await runRealmScript({
    code: `console.log('found', 3); return true;`,
    realm: 'https://example.test/demo/',
    adapter: new FakeAdapter(),
  });

  assert.deepEqual(result.logs, [{ level: 'log', args: ['found', 3] }]);
});

test('exposes Realm discovery and federated search to guest programs', async () => {
  let adapter = new FakeAdapter({}, [
    { type: 'file-meta', id: 'https://example.test/one/module.gts' },
  ]);
  let result = await runRealmScript({
    code: `
      const grants = await realm.listRealms({ permission: 'read' });
      const found = await realm.search(
        { filter: { any: [{ matches: 'three' }, { matches: 'threejs' }] } },
        { realms: grants.map((grant) => grant.url) },
      );
      return { grants, found };
    `,
    realm: 'https://example.test/one/',
    adapter,
  });

  assert.deepEqual(adapter.searchCalls, [
    ['https://example.test/one/', 'https://example.test/two/'],
  ]);
  assert.equal(result.value.grants.length, 2);
  assert.equal(result.value.found[0].id.endsWith('module.gts'), true);
});

test('greps an exact federated candidate list passed through realm.input', async () => {
  let adapter = new FakeAdapter({
    'module.gts': `import * as THREE from 'three';\n`,
    'other.gts': `export const unrelated = true;\n`,
  });
  let result = await runRealmScript({
    code: `
      return await realm.fs.grep(/from\\s+['"]three/i, {
        files: realm.input.candidates,
        glob: '**/*.gts',
      });
    `,
    realm: 'https://example.test/one/',
    input: {
      candidates: [
        { id: 'https://example.test/two/module.gts' },
        { id: 'https://example.test/two/other.gts' },
      ],
    },
    adapter,
  });

  assert.deepEqual(result.value, [
    {
      id: 'https://example.test/two/module.gts',
      path: 'module.gts',
      line: 1,
      column: 19,
      text: `import * as THREE from 'three';`,
    },
  ]);
});

test('opens an authorized federated Realm as a read-only handle', async () => {
  let adapter = new FakeAdapter({
    'remote.gts': 'export const remote = true;\n',
  });
  let result = await runRealmScript({
    code: `
      const remote = realm.open('https://example.test/two/');
      return {
        current: remote.current,
        source: await remote.fs.readText('remote.gts'),
        writeType: typeof remote.fs.writeText,
      };
    `,
    realm: 'https://example.test/one/',
    adapter,
  });

  assert.deepEqual(result.value, {
    current: { url: 'https://example.test/two/', mode: 'read-only' },
    source: 'export const remote = true;\n',
    writeType: 'undefined',
  });
});

test('opens an explicitly writable cross-Realm API handle in commit mode', async () => {
  let adapter = new FakeAdapter();
  adapter.listRealms = async () => [
    {
      id: 'https://example.test/one/',
      url: 'https://example.test/one/',
      canRead: true,
      canWrite: true,
    },
    {
      id: 'https://example.test/two/',
      url: 'https://example.test/two/',
      canRead: true,
      canWrite: true,
    },
  ];

  let result = await runRealmScript({
    code: `
      const remote = realm.open('https://example.test/two/', { write: true });
      const response = await remote.api.request('DELETE', 'obsolete.json');
      return { current: remote.current, response };
    `,
    realm: 'https://example.test/one/',
    mode: 'commit',
    adapter,
  });

  assert.equal(result.value.current.mode, 'commit');
  assert.equal(adapter.rawRequests[0].realm, 'https://example.test/two/');
  assert.equal(result.effects[0].realm, 'https://example.test/two/');
});

test('exposes BXL as the jq-like data transformation layer', async () => {
  let result = await runRealmScript({
    code: `return {
      jq: await realm.bxl.jq('.items | length', { items: [1, 2, 3] }),
      readable: await realm.bxl.evaluate('Score + 1', { Score: 4 }, { syntax: 'readable' }),
    };`,
    realm: 'https://example.test/demo/',
    adapter: new FakeAdapter(),
    bxl: new FakeBxl(),
  });

  assert.deepEqual(result.value, {
    jq: {
      expression: '.items | length',
      input: { items: [1, 2, 3] },
      syntax: 'jq',
    },
    readable: {
      expression: 'Score + 1',
      input: { Score: 4 },
      syntax: 'readable',
    },
  });
});

test('exposes the full authenticated Realm API through one guest tool', async () => {
  let adapter = new FakeAdapter();
  let result = await runRealmScript({
    code: `
      const created = await realm.api.request('POST', 'Card', {
        body: { data: { type: 'card', attributes: { title: 'Created' } } },
        bodyType: 'json',
        contentType: 'application/vnd.card+json',
      });
      const queued = await realm.server.request('POST', '_publish-realm', {
        body: { sourceRealmURL: realm.current.url },
        bodyType: 'json',
        contentType: 'application/json',
      });
      return { created, queued };
    `,
    realm: 'https://example.test/demo/',
    mode: 'commit',
    adapter,
  });

  assert.equal(result.value.created.status, 201);
  assert.equal(result.value.queued.status, 202);
  assert.deepEqual(result.effects, [
    {
      scope: 'realm',
      realm: 'https://example.test/demo/',
      method: 'POST',
      path: 'Card',
      status: 201,
      ok: true,
    },
    {
      scope: 'server',
      method: 'POST',
      path: '_publish-realm',
      status: 202,
      ok: true,
    },
  ]);
  assert.deepEqual(
    adapter.rawRequests.map(({ scope, method, path }) => ({
      scope,
      method,
      path,
    })),
    [
      { scope: 'realm', method: 'POST', path: 'Card' },
      { scope: 'server', method: 'POST', path: '_publish-realm' },
    ],
  );
});

test('reports raw API effects when a later guest operation fails', async () => {
  let adapter = new FakeAdapter();

  await assert.rejects(
    runRealmScript({
      code: `
        await realm.api.request('POST', 'created-before-error.json');
        throw new Error('later failure');
      `,
      realm: 'https://example.test/demo/',
      mode: 'commit',
      adapter,
    }),
    (error) => {
      assert.equal(error.code, 'RUNTIME_ERROR');
      assert.deepEqual(error.details.effects, [
        {
          scope: 'realm',
          realm: 'https://example.test/demo/',
          method: 'POST',
          path: 'created-before-error.json',
          status: 201,
          ok: true,
        },
      ]);
      return true;
    },
  );
});

test('transports RegExp grep patterns without exposing host RegExp objects', async () => {
  let adapter = new FakeAdapter({
    'src/a.gts': "import Three from 'three';\n",
    'src/b.gts': 'const unrelated = true;\n',
  });
  let result = await runRealmScript({
    code: `return await realm.fs.grep(/from\\s+['"]three/i, { glob: '**/*.gts' });`,
    realm: 'https://example.test/demo/',
    adapter,
  });

  assert.deepEqual(
    result.value.map(({ path, line, column }) => ({ path, line, column })),
    [{ path: 'src/a.gts', line: 1, column: 14 }],
  );
});

test('interrupts an infinite loop', async () => {
  await assert.rejects(
    runRealmScript({
      code: 'while (true) {}',
      realm: 'https://example.test/demo/',
      adapter: new FakeAdapter(),
      limits: { timeoutMs: 25 },
    }),
    (error) => error.code === 'TIME_LIMIT',
  );
});

test('does not charge Realm I/O latency against the QuickJS CPU deadline', async () => {
  let adapter = new FakeAdapter({ 'slow.txt': 'eventually\n' });
  let originalReadText = adapter.readText.bind(adapter);
  adapter.readText = async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return originalReadText(...args);
  };

  let result = await runRealmScript({
    code: `return await realm.fs.readText('slow.txt');`,
    realm: 'https://example.test/demo/',
    adapter,
    limits: { timeoutMs: 10 },
  });

  assert.equal(result.value, 'eventually\n');
});

test('bounds total wall-clock time including Realm I/O', async () => {
  let adapter = new FakeAdapter({ 'slow.txt': 'too late\n' });
  let originalReadText = adapter.readText.bind(adapter);
  adapter.readText = async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return originalReadText(...args);
  };

  await assert.rejects(
    runRealmScript({
      code: `return await realm.fs.readText('slow.txt');`,
      realm: 'https://example.test/demo/',
      adapter,
      limits: { timeoutMs: 100, wallTimeoutMs: 10 },
    }),
    (error) =>
      error.code === 'TIME_LIMIT' && error.message.includes('wall-clock'),
  );
});

test('reports an unknown raw-mutation outcome when the wall deadline wins', async () => {
  let adapter = new FakeAdapter();
  adapter.realmRequest = async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return FakeAdapter.prototype.realmRequest.call(adapter, ...args);
  };

  await assert.rejects(
    runRealmScript({
      code: `await realm.api.request('POST', 'possibly-created.json');`,
      realm: 'https://example.test/demo/',
      mode: 'commit',
      adapter,
      limits: { timeoutMs: 100, wallTimeoutMs: 10 },
    }),
    (error) => {
      assert.equal(error.code, 'TIME_LIMIT');
      assert.deepEqual(error.details.effects, [
        {
          scope: 'realm',
          realm: 'https://example.test/demo/',
          method: 'POST',
          path: 'possibly-created.json',
          status: null,
          ok: null,
        },
      ]);
      return true;
    },
  );
});
