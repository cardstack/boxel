import QUnit from 'qunit';
const { module, test } = QUnit;
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DeckdHistory } from '../src/deckd.ts';

// deckd is a separate Rust process, so what CAN be tested here is the
// client's half of the contract: the wire shape it sends, how it reads each
// reply, and how it behaves when no daemon answers. The daemon below is a
// stub implementing the documented protocol — these tests prove the client,
// not the daemon.

interface Call {
  path: string;
  body: Record<string, unknown>;
}

const SEALS: Record<string, string> = {
  vvvvvvvv: 'export const v = 1;\n',
  wwwwwwww: 'export const v = 2;\n',
};

function startStub(): Promise<{
  server: Server;
  url: string;
  calls: Call[];
  ensured: string[];
}> {
  let calls: Call[] = [];
  let ensured: string[] = [];
  let server = createServer((req, res) => {
    let chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      calls.push({ path: req.url ?? '', body });
      let reply = (value: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      switch (req.url) {
        case '/ensure':
          ensured.push(body.dir);
          reply({});
          return;
        case '/fork':
          reply({});
          return;
        case '/seal':
          if (body.message === 'boom') {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'working copy is locked' }));
            return;
          }
          reply({ changeId: body.message === 'clean' ? null : 'wwwwwwww' });
          return;
        case '/list':
          reply([
            {
              changeId: 'wwwwwwww',
              commitId: 'ab12',
              timestamp: '2026-08-07T10:00:00+0000',
              description: 'save: app.js',
              filesSummary: ['M app.js'],
            },
            {
              changeId: 'vvvvvvvv',
              commitId: 'cd34',
              timestamp: '2026-08-07T09:00:00+0000',
              description: 'first',
              filesSummary: ['A app.js'],
            },
          ]);
          return;
        case '/file-at': {
          let content = SEALS[body.revisionId as string];
          reply(
            content
              ? {
                  found: true,
                  contentBase64: Buffer.from(content).toString('base64'),
                }
              : { found: false },
          );
          return;
        }
        case '/restore-plan':
          reply({ writes: ['app.js'], deletes: ['added-later.js'] });
          return;
        case '/file-list-at':
          reply({ paths: ['app.js', 'lib/util.js'] });
          return;
        default:
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'no such endpoint' }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      let port = (server.address() as AddressInfo).port;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        calls,
        ensured,
      });
    });
  });
}

module('history: deckd client', function (hooks) {
  let stub: Awaited<ReturnType<typeof startStub>>;
  let history: DeckdHistory;
  const DIR = '/tmp/some-live-tree';

  hooks.beforeEach(async function () {
    stub = await startStub();
    history = new DeckdHistory({ baseUrl: stub.url, debounceMs: 20 });
  });

  hooks.afterEach(async function () {
    history.close();
    await new Promise<void>((resolve, reject) =>
      stub.server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  test('the tree is ensured exactly once, before anything else', async function (assert) {
    await history.seal(DIR, 'save: app.js');
    await history.seal(DIR, 'save: app.js again');
    assert.deepEqual(stub.ensured, [DIR], 'ensure is not repeated per call');
    assert.deepEqual(
      stub.calls[0],
      { path: '/ensure', body: { dir: DIR, watch: true } },
      'watched standalone mode is explicit and comes first',
    );
    assert.deepEqual(stub.calls[1], {
      path: '/seal',
      body: { dir: DIR, message: 'save: app.js' },
    });
    assert.strictEqual(history.kind, 'deckd');
  });

  test('writer-managed mode disables daemon filesystem capture', async function (assert) {
    let managed = new DeckdHistory({
      baseUrl: stub.url,
      debounceMs: 20,
      watch: false,
    });
    await managed.seal('/tmp/writer-managed-tree', 'accepted batch');
    assert.deepEqual(stub.calls.at(-2), {
      path: '/ensure',
      body: { dir: '/tmp/writer-managed-tree', watch: false },
    });
    managed.close();
  });

  test('fork creates one exact named workspace and marks it ensured', async function (assert) {
    await history.fork(
      DIR,
      '/tmp/some-live-tree/.deck/branches/ana%2Fbutton',
      'vvvvvvvv',
      'deck:ana/button',
    );
    assert.deepEqual(stub.calls.slice(-1), [
      {
        path: '/fork',
        body: {
          sourceDir: DIR,
          targetDir: '/tmp/some-live-tree/.deck/branches/ana%2Fbutton',
          revisionId: 'vvvvvvvv',
          workspaceName: 'deck:ana/button',
        },
      },
    ]);

    await history.seal(
      '/tmp/some-live-tree/.deck/branches/ana%2Fbutton',
      'branch save',
    );
    assert.strictEqual(
      stub.calls.filter(
        (call) =>
          call.path === '/ensure' &&
          call.body.dir === '/tmp/some-live-tree/.deck/branches/ana%2Fbutton',
      ).length,
      0,
      'the successful fork response is the target ensure boundary',
    );
  });

  test('a no-op seal reports nothing sealed', async function (assert) {
    assert.strictEqual(await history.seal(DIR, 'clean'), undefined);
    assert.strictEqual(await history.seal(DIR, 'dirty'), 'wwwwwwww');
  });

  test('head is the newest log entry — there is no /head endpoint', async function (assert) {
    assert.strictEqual(await history.head(DIR), 'wwwwwwww');
    assert.false(
      stub.calls.some((call) => call.path === '/head'),
      'the client never invents an endpoint the daemon does not have',
    );
  });

  test('file bytes arrive base64 and come back as bytes', async function (assert) {
    let bytes = await history.fileAt(DIR, 'vvvvvvvv', 'app.js');
    assert.strictEqual(bytes?.toString(), 'export const v = 1;\n');
    assert.strictEqual(
      await history.fileAt(DIR, 'zzzzzzzz', 'app.js'),
      undefined,
      'found:false is a miss',
    );
  });

  test('bad ids and paths never reach the daemon', async function (assert) {
    assert.strictEqual(await history.fileAt(DIR, '@', 'app.js'), undefined);
    assert.strictEqual(
      await history.fileAt(DIR, 'vvvvvvvv', '../escape'),
      undefined,
    );
    await assert.rejects(
      history.restorePlan(DIR, 'root()'),
      /invalid revision id/,
    );
    assert.false(
      stub.calls.some((call) => call.path === '/file-at'),
      'validation happens client-side, so the daemon is never asked',
    );
  });

  test('listing flushes first, so the log is never behind the tree', async function (assert) {
    history.noteMutation(DIR, 'app.js');
    let seals = await history.list(DIR);
    assert.strictEqual(seals.length, 2);
    let paths = stub.calls.map((call) => call.path);
    assert.strictEqual(paths.indexOf('/seal') < paths.indexOf('/list'), true);
    assert.strictEqual(
      stub.calls.find((call) => call.path === '/seal')!.body.message,
      'save: app.js',
      'the pending burst was consumed by the flush, not left to fire later',
    );
  });

  test('restore plans pass through unchanged', async function (assert) {
    assert.deepEqual(await history.restorePlan(DIR, 'vvvvvvvv'), {
      writes: ['app.js'],
      deletes: ['added-later.js'],
    });
  });

  test('deckd capabilities: actor on seal + file-list-at', async function (assert) {
    await history.seal(DIR, 'with actor', {
      name: 'Chris',
      email: 'chris@example.com',
    });
    assert.deepEqual(
      stub.calls.at(-1)!.body,
      {
        dir: DIR,
        message: 'with actor',
        actor: { name: 'Chris', email: 'chris@example.com' },
      },
      'actor rides the seal so deckd can stamp author',
    );
    assert.deepEqual(await history.fileListAt(DIR, 'vvvvvvvv'), [
      'app.js',
      'lib/util.js',
    ]);
  });

  test('no daemon: probe says so instead of failing every later save', async function (assert) {
    let orphan = new DeckdHistory({ baseUrl: 'http://127.0.0.1:1' });
    assert.false(await orphan.probe(DIR));
    orphan.close();
    assert.true(await history.probe(DIR));
  });

  test('a daemon error surfaces with its status and body', async function (assert) {
    await assert.rejects(
      history.seal(DIR, 'boom'),
      /deckd \/seal 500: .*working copy is locked/,
      'a failed seal is never mistaken for "nothing to seal"',
    );
    assert.strictEqual(
      await history.seal(DIR, 'save: app.js'),
      'wwwwwwww',
      'and the per-tree queue survives the failure',
    );
  });
});
