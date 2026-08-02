import assert from 'node:assert/strict';
import test from 'node:test';

import { RealmCapabilityHost } from '../src/capability.js';
import { realmPath } from '../src/path.js';

class FakeAdapter {
  constructor() {
    this.searchCalls = [];
    this.readCalls = [];
    this.atomicWrites = [];
    this.rawRequests = [];
    this.files = new Map([
      ['a.txt', 'alpha\nbeta\nALPHA\n'],
      ['src/card.gts', "import Component from '@glimmer/component';\n"],
    ]);
  }

  async listRealms() {
    return [
      {
        id: 'https://example.test/a/',
        url: 'https://example.test/a/',
        canRead: true,
        canWrite: true,
      },
      {
        id: 'https://example.test/b/',
        url: 'https://example.test/b/',
        canRead: true,
        canWrite: false,
      },
      {
        id: 'https://example.test/denied/',
        url: 'https://example.test/denied/',
        canRead: false,
        canWrite: false,
      },
    ];
  }
  async listFiles() {
    return [...this.files.keys()];
  }
  async readText(_realm, path) {
    this.readCalls.push({ realm: _realm, path });
    return this.files.get(path);
  }
  async readBase64(_realm, path) {
    let content = this.files.get(path);
    return content === undefined
      ? undefined
      : Buffer.from(content).toString('base64');
  }
  async readTranspiled(_realm, path) {
    return `transpiled:${path}`;
  }
  async lint(_realm, path, source) {
    return { ok: true, path, sourceBytes: Buffer.byteLength(source) };
  }
  async indexingErrors() {
    return { data: [] };
  }
  async realmGet(_realm, path, options) {
    return { ok: true, status: 200, headers: {}, body: { path, options } };
  }
  async realmHead(_realm, path, options) {
    return { ok: true, status: 200, headers: {}, body: { path, options } };
  }
  async realmQuery(_realm, path, body, options) {
    return {
      ok: true,
      status: 200,
      headers: {},
      body: { path, queryBody: body, options },
    };
  }
  async serverGet(path, options) {
    return { ok: true, status: 200, headers: {}, body: { path, options } };
  }
  async serverHead(path, options) {
    return { ok: true, status: 200, headers: {}, body: { path, options } };
  }
  async serverQuery(path, body, options) {
    return {
      ok: true,
      status: 200,
      headers: {},
      body: { path, queryBody: body, options },
    };
  }
  async realmRequest(realm, method, path, options) {
    this.rawRequests.push({ scope: 'realm', realm, method, path, options });
    return {
      ok: true,
      status: 200,
      headers: {},
      body:
        options.responseType === 'base64'
          ? Buffer.from('binary-response').toString('base64')
          : { method, path },
    };
  }
  async serverRequest(method, path, options) {
    this.rawRequests.push({ scope: 'server', method, path, options });
    return {
      ok: true,
      status: 202,
      headers: {},
      body: { method, path },
    };
  }
  async search(realms) {
    this.searchCalls.push(realms);
    return realms.map((realm) => ({
      type: 'file-meta',
      id: `${realm}file.gts`,
    }));
  }
  async atomicWrite(_realm, changes) {
    this.atomicWrites.push(changes);
  }
}

test('normalizes Realm-relative paths and rejects escape attempts', () => {
  assert.equal(realmPath('./cards/a.json'), 'cards/a.json');
  assert.throws(() => realmPath('../secret'), { code: 'PATH_OUTSIDE_REALM' });
  assert.throws(() => realmPath('%2e%2e/secret'), {
    code: 'PATH_OUTSIDE_REALM',
  });
  assert.throws(() => realmPath('folder/%2fsecret'), {
    code: 'PATH_OUTSIDE_REALM',
  });
  assert.throws(() => realmPath('/etc/passwd'), { code: 'PATH_OUTSIDE_REALM' });
  assert.throws(() => realmPath('https://example.test/file'), {
    code: 'PATH_OUTSIDE_REALM',
  });
  assert.throws(() => realmPath('./'), { code: 'PATH_OUTSIDE_REALM' });
  assert.throws(() => realmPath('file.gts?raw'), { code: 'INVALID_PATH' });
});

test('rejects replace when match cardinality differs', async () => {
  let host = new RealmCapabilityHost({
    adapter: new FakeAdapter(),
    realmUrl: 'https://example.test/demo/',
  });
  await assert.rejects(
    host.dispatch('fs.replace', [
      'a.txt',
      'alpha',
      'b',
      { expectedMatches: 2 },
    ]),
    { code: 'MATCH_COUNT_MISMATCH' },
  );
});

test('greps selected Realm files with line context', async () => {
  let host = new RealmCapabilityHost({
    adapter: new FakeAdapter(),
    realmUrl: 'https://example.test/demo/',
  });

  let matches = await host.dispatch('fs.grep', [
    'alpha',
    {
      glob: '**/*.txt',
      caseSensitive: false,
      contextLines: 1,
    },
  ]);

  assert.deepEqual(matches, [
    {
      path: 'a.txt',
      line: 1,
      column: 1,
      text: 'alpha',
      before: [],
      after: ['beta'],
    },
    {
      path: 'a.txt',
      line: 3,
      column: 1,
      text: 'ALPHA',
      before: ['beta'],
      after: [''],
    },
  ]);
});

test('globs with one or more ignored patterns', async () => {
  let host = new RealmCapabilityHost({
    adapter: new FakeAdapter(),
    realmUrl: 'https://example.test/demo/',
  });

  assert.deepEqual(
    await host.dispatch('fs.glob', ['**/*', { ignore: 'src/**' }]),
    ['a.txt'],
  );
});

test('reads bounded base64 bytes in current and authorized Realms', async () => {
  let host = new RealmCapabilityHost({
    adapter: new FakeAdapter(),
    realmUrl: 'https://example.test/a/',
  });

  assert.equal(
    Buffer.from(
      await host.dispatch('fs.readBase64', ['a.txt']),
      'base64',
    ).toString(),
    'alpha\nbeta\nALPHA\n',
  );
  assert.equal(
    Buffer.from(
      await host.dispatch('scoped.fs.readBase64', [
        'https://example.test/b/',
        'a.txt',
      ]),
      'base64',
    ).toString(),
    'alpha\nbeta\nALPHA\n',
  );
});

test('stats staged content and exposes preview diffs', async () => {
  let host = new RealmCapabilityHost({
    adapter: new FakeAdapter(),
    realmUrl: 'https://example.test/demo/',
  });

  await host.dispatch('fs.appendText', ['a.txt', 'omega\n']);
  let stat = await host.dispatch('fs.stat', ['a.txt']);
  let changes = await host.dispatch('fs.diff', ['a.txt']);

  assert.equal(stat.staged, true);
  assert.equal(stat.size, Buffer.byteLength('alpha\nbeta\nALPHA\nomega\n'));
  assert.equal(changes.length, 1);
  assert.match(changes[0].diff, /\+omega/);
});

test('stages removals in the overlay', async () => {
  let host = new RealmCapabilityHost({
    adapter: new FakeAdapter(),
    realmUrl: 'https://example.test/demo/',
  });

  await host.dispatch('fs.remove', ['a.txt']);
  let changes = await host.dispatch('fs.diff', ['a.txt']);

  assert.equal(await host.dispatch('fs.exists', ['a.txt']), false);
  assert.equal((await host.dispatch('fs.list', [])).includes('a.txt'), false);
  await assert.rejects(host.dispatch('fs.readText', ['a.txt']), {
    code: 'NOT_FOUND',
  });
  assert.equal(changes[0].operation, 'remove');
  assert.equal(changes[0].afterHash, null);
  assert.match(changes[0].diff, /-alpha/);
});

test('rejects a commit when a staged file changed concurrently', async () => {
  let adapter = new FakeAdapter();
  let host = new RealmCapabilityHost({
    adapter,
    realmUrl: 'https://example.test/demo/',
    mode: 'commit',
  });

  await host.dispatch('fs.appendText', ['a.txt', 'staged\n']);
  adapter.files.set('a.txt', 'changed elsewhere\n');

  await assert.rejects(host.finish(), { code: 'WRITE_CONFLICT' });
  assert.equal(adapter.atomicWrites.length, 0);
});

test('uses Boxel-backed transpile, lint, and indexing diagnostics', async () => {
  let host = new RealmCapabilityHost({
    adapter: new FakeAdapter(),
    realmUrl: 'https://example.test/demo/',
  });

  assert.equal(
    await host.dispatch('fs.readTranspiled', ['src/card.gts']),
    'transpiled:src/card.gts',
  );
  assert.deepEqual(await host.dispatch('fs.lint', ['src/card.gts']), {
    ok: true,
    path: 'src/card.gts',
    sourceBytes: 44,
  });
  assert.deepEqual(await host.dispatch('indexingErrors', []), { data: [] });
});

test('exposes bounded read-only Realm and server API access', async () => {
  let host = new RealmCapabilityHost({
    adapter: new FakeAdapter(),
    realmUrl: 'https://example.test/demo/',
  });

  let info = await host.dispatch('api.get', [
    '_info',
    {
      accept: 'application/vnd.card+json',
    },
  ]);
  let status = await host.dispatch('server.get', ['_queue-status']);
  let query = await host.dispatch('api.query', [
    '_search',
    { filter: { matches: 'three' } },
    { accept: 'application/vnd.card+json' },
  ]);

  assert.deepEqual(info.body, {
    path: '_info',
    options: { accept: 'application/vnd.card+json' },
  });
  assert.equal(status.body.path, '_queue-status');
  assert.deepEqual(query.body, {
    path: '_search',
    queryBody: { filter: { matches: 'three' } },
    options: { accept: 'application/vnd.card+json' },
  });
});

test('gates raw API mutations to commit mode and preserves caller auth', async () => {
  let previewAdapter = new FakeAdapter();
  let preview = new RealmCapabilityHost({
    adapter: previewAdapter,
    realmUrl: 'https://example.test/demo/',
  });

  await assert.rejects(
    preview.dispatch('api.request', [
      'PATCH',
      '_permissions',
      { body: { add: ['read'] }, bodyType: 'json' },
    ]),
    { code: 'CAPABILITY_DENIED' },
  );
  assert.equal(previewAdapter.rawRequests.length, 0);

  let adapter = new FakeAdapter();
  let commit = new RealmCapabilityHost({
    adapter,
    realmUrl: 'https://example.test/demo/',
    mode: 'commit',
  });
  let response = await commit.dispatch('api.request', [
    'PATCH',
    '_permissions',
    {
      body: { add: ['read'] },
      bodyType: 'json',
      contentType: 'application/json',
      headers: { 'If-Match': 'current' },
    },
  ]);

  assert.equal(response.status, 200);
  assert.deepEqual(adapter.rawRequests[0], {
    scope: 'realm',
    realm: 'https://example.test/demo/',
    method: 'PATCH',
    path: '_permissions',
    options: {
      body: { add: ['read'] },
      bodyType: 'json',
      responseType: 'auto',
      maxResponseBytes: 4 * 1024 * 1024,
      headers: { 'If-Match': 'current' },
      contentType: 'application/json',
    },
  });
  assert.equal(commit.stats.apiRequests, 1);
  assert.ok(commit.stats.apiBytesSent > 0);
  assert.ok(commit.stats.apiBytesReceived > 0);
});

test('supports binary API bodies and responses within configured budgets', async () => {
  let adapter = new FakeAdapter();
  let host = new RealmCapabilityHost({
    adapter,
    realmUrl: 'https://example.test/demo/',
    mode: 'commit',
  });
  let body = Buffer.from([0, 1, 2, 255]).toString('base64');
  let response = await host.dispatch('api.request', [
    'POST',
    'asset.bin',
    {
      body,
      bodyType: 'base64',
      contentType: 'application/octet-stream',
      responseType: 'base64',
    },
  ]);

  assert.equal(
    Buffer.from(response.body, 'base64').toString(),
    'binary-response',
  );
  assert.equal(adapter.rawRequests[0].options.body, body);
});

test('supports every HTTP method used by Realm and Realm-server routes', async () => {
  let adapter = new FakeAdapter();
  let host = new RealmCapabilityHost({
    adapter,
    realmUrl: 'https://example.test/demo/',
    mode: 'commit',
  });

  for (let method of [
    'GET',
    'HEAD',
    'QUERY',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
  ]) {
    await host.dispatch('api.request', [method, '_operation']);
  }

  assert.deepEqual(
    adapter.rawRequests.map(({ method }) => method),
    ['GET', 'HEAD', 'QUERY', 'POST', 'PUT', 'PATCH', 'DELETE'],
  );
});

test('invalidates file helper caches after an immediate raw mutation', async () => {
  let adapter = new FakeAdapter();
  adapter.files.set('mutable.txt', 'before');
  adapter.realmRequest = async (realm, method, path, options) => {
    adapter.rawRequests.push({ scope: 'realm', realm, method, path, options });
    adapter.files.set(path, options.body);
    return { ok: true, status: 204, headers: {}, body: '' };
  };
  let host = new RealmCapabilityHost({
    adapter,
    realmUrl: 'https://example.test/demo/',
    mode: 'commit',
  });

  assert.equal(await host.dispatch('fs.readText', ['mutable.txt']), 'before');
  await host.dispatch('api.request', [
    'POST',
    'mutable.txt',
    { body: 'after', bodyType: 'text' },
  ]);
  assert.equal(await host.dispatch('fs.readText', ['mutable.txt']), 'after');
});

test('keeps cross-Realm raw API handles read-only', async () => {
  let adapter = new FakeAdapter();
  let host = new RealmCapabilityHost({
    adapter,
    realmUrl: 'https://example.test/a/',
    mode: 'commit',
  });

  await host.dispatch('scoped.api.request', [
    'https://example.test/b/',
    'GET',
    '_info',
    {},
  ]);
  await assert.rejects(
    host.dispatch('scoped.api.request', [
      'https://example.test/b/',
      'DELETE',
      'card',
      {},
    ]),
    { code: 'CAPABILITY_DENIED' },
  );
  assert.equal(adapter.rawRequests.length, 1);
});

test('permits explicit cross-Realm writes only with a discovered write grant', async () => {
  let adapter = new FakeAdapter();
  adapter.listRealms = async () => [
    {
      id: 'https://example.test/a/',
      url: 'https://example.test/a/',
      canRead: true,
      canWrite: true,
    },
    {
      id: 'https://example.test/b/',
      url: 'https://example.test/b/',
      canRead: true,
      canWrite: true,
    },
    {
      id: 'https://example.test/c/',
      url: 'https://example.test/c/',
      canRead: true,
      canWrite: false,
    },
  ];
  let host = new RealmCapabilityHost({
    adapter,
    realmUrl: 'https://example.test/a/',
    mode: 'commit',
  });

  await host.dispatch('scoped.api.request', [
    'https://example.test/b/',
    'DELETE',
    'old.json',
    {},
    true,
  ]);
  await assert.rejects(
    host.dispatch('scoped.api.request', [
      'https://example.test/c/',
      'DELETE',
      'old.json',
      {},
      true,
    ]),
    { code: 'CAPABILITY_DENIED' },
  );

  assert.equal(adapter.rawRequests.length, 1);
  assert.equal(adapter.rawRequests[0].realm, 'https://example.test/b/');
});

test('blocks credential overrides and oversized raw API bodies', async () => {
  let host = new RealmCapabilityHost({
    adapter: new FakeAdapter(),
    realmUrl: 'https://example.test/demo/',
    mode: 'commit',
    limits: { apiRequestBytes: 3 },
  });

  await assert.rejects(
    host.dispatch('server.request', [
      'POST',
      '_create-realm',
      { headers: { Authorization: 'Bearer forged' } },
    ]),
    { code: 'CAPABILITY_DENIED' },
  );
  await assert.rejects(
    host.dispatch('api.request', [
      'GET',
      '_info',
      { headers: { 'X-Boxel-Job-Id': 'internal' } },
    ]),
    { code: 'CAPABILITY_DENIED' },
  );
  await assert.rejects(
    host.dispatch('api.request', [
      'POST',
      'file.txt',
      { body: 'four', bodyType: 'text' },
    ]),
    { code: 'BYTE_LIMIT' },
  );
});

test('enforces cumulative raw API request and response budgets', async () => {
  let requestAdapter = new FakeAdapter();
  let requestHost = new RealmCapabilityHost({
    adapter: requestAdapter,
    realmUrl: 'https://example.test/demo/',
    mode: 'commit',
    limits: { apiTotalRequestBytes: 5 },
  });

  await requestHost.dispatch('api.request', [
    'POST',
    'one.txt',
    { body: 'abc', bodyType: 'text' },
  ]);
  await assert.rejects(
    requestHost.dispatch('api.request', [
      'POST',
      'two.txt',
      { body: 'def', bodyType: 'text' },
    ]),
    { code: 'BYTE_LIMIT' },
  );
  assert.equal(requestAdapter.rawRequests.length, 1);

  let responseAdapter = new FakeAdapter();
  let responseHost = new RealmCapabilityHost({
    adapter: responseAdapter,
    realmUrl: 'https://example.test/demo/',
    limits: { apiTotalResponseBytes: 35 },
  });
  await responseHost.dispatch('api.request', ['GET', 'a', {}]);
  await assert.rejects(responseHost.dispatch('api.request', ['GET', 'b', {}]), {
    code: 'BYTE_LIMIT',
  });
  assert.ok(responseAdapter.rawRequests[1].options.maxResponseBytes < 35);
});

test('lists effective Realm grants and filters by permission', async () => {
  let host = new RealmCapabilityHost({
    adapter: new FakeAdapter(),
    realmUrl: 'https://example.test/a/',
  });

  let readable = await host.dispatch('realms.list', [{ permission: 'read' }]);
  let writable = await host.dispatch('realms.list', [{ permission: 'write' }]);

  assert.deepEqual(
    readable.map((grant) => grant.url),
    ['https://example.test/a/', 'https://example.test/b/'],
  );
  assert.deepEqual(
    writable.map((grant) => grant.url),
    ['https://example.test/a/'],
  );
});

test('federates explicit Realm searches in bounded batches', async () => {
  let adapter = new FakeAdapter();
  adapter.listRealms = async () =>
    ['a', 'b', 'c'].map((name) => ({
      id: `https://example.test/${name}/`,
      url: `https://example.test/${name}/`,
      canRead: true,
      canWrite: name === 'a',
    }));
  let host = new RealmCapabilityHost({
    adapter,
    realmUrl: 'https://example.test/a/',
    limits: { searchRealmBatchSize: 2 },
  });
  let realms = [
    'https://example.test/a/',
    'https://example.test/b/',
    'https://example.test/c/',
  ];

  let results = await host.dispatch('search', [
    { filter: { matches: 'three' } },
    { realms },
  ]);

  assert.deepEqual(adapter.searchCalls, [realms.slice(0, 2), realms.slice(2)]);
  assert.deepEqual(
    results.map((item) => item.id),
    realms.map((realm) => `${realm}file.gts`),
  );
});

test('denies explicit federated searches outside discovered read grants', async () => {
  let adapter = new FakeAdapter();
  let host = new RealmCapabilityHost({
    adapter,
    realmUrl: 'https://example.test/a/',
  });

  await assert.rejects(
    host.dispatch('search', [
      { filter: { matches: 'secret' } },
      { realms: ['https://example.test/denied/'] },
    ]),
    { code: 'CAPABILITY_DENIED' },
  );
  assert.equal(adapter.searchCalls.length, 0);
});

test('searches every readable Realm with realms all', async () => {
  let adapter = new FakeAdapter();
  let host = new RealmCapabilityHost({
    adapter,
    realmUrl: 'https://example.test/a/',
  });

  await host.dispatch('search', [{}, { realms: 'all' }]);

  assert.deepEqual(adapter.searchCalls, [
    ['https://example.test/a/', 'https://example.test/b/'],
  ]);
});

test('reads a federated-search hit through an authorized Realm scope', async () => {
  let adapter = new FakeAdapter();
  let host = new RealmCapabilityHost({
    adapter,
    realmUrl: 'https://example.test/a/',
  });

  let content = await host.dispatch('scoped.fs.readText', [
    'https://example.test/b/',
    'src/card.gts',
  ]);

  assert.match(content, /@glimmer\/component/);
  assert.deepEqual(adapter.readCalls.at(-1), {
    realm: 'https://example.test/b/',
    path: 'src/card.gts',
  });
});

test('denies scoped reads outside discovered Realm grants', async () => {
  let host = new RealmCapabilityHost({
    adapter: new FakeAdapter(),
    realmUrl: 'https://example.test/a/',
  });

  await assert.rejects(
    host.dispatch('scoped.fs.readText', ['https://evil.test/realm/', 'a.txt']),
    { code: 'CAPABILITY_DENIED' },
  );
});
