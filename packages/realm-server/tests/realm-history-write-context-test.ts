import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  query,
  param,
  rri,
  SupportedMimeType,
  WRITE_CHANNEL_HEADER,
  WRITE_AGENT_HEADER,
  WRITE_ROOM_HEADER,
  WRITE_TOOL_CALL_HEADER,
  WRITE_CONTEXT_HEADERS,
  PUSH_ID_HEADER,
  PUSH_FINAL_HEADER,
  X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
  type ChangeIntent,
  type Realm,
} from '@cardstack/runtime-common';
import { commitBatch } from '@cardstack/runtime-common/card-operations';
import { PostgresChangeJournal } from '../lib/change-journal.ts';
import {
  setupPermissionedRealmCached,
  createJWT,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

// A change event records how its write was made, from the write's request
// headers: the channel, and on an AI write the agent, room and tool call; on a
// push the push id and whether it was the push's last request. The headers
// are advisory: the author is always the authenticated user.

const personGts = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Person extends CardDef {
    @field firstName = contains(StringField);
  }
`;

interface EventRow {
  seq: number;
  author: string;
  channel: string;
  agent: string | null;
  room: string | null;
  correlationId: string | null;
  pushId: string | null;
  pushFinal: boolean;
  intent: ChangeIntent | null;
  paths: string[];
}

// The context fields an event carries, as the assertions compare them.
type Context = Pick<
  EventRow,
  'channel' | 'agent' | 'room' | 'correlationId' | 'pushId' | 'pushFinal'
>;

const AI_WRITE: Record<string, string> = {
  [WRITE_CHANNEL_HEADER]: 'ai-assistant',
  [WRITE_AGENT_HEADER]: 'anthropic/claude-sonnet-4.5',
  [WRITE_ROOM_HEADER]: '!ai-room:localhost',
  [WRITE_TOOL_CALL_HEADER]: 'toolu_01AbCdEf',
  [X_BOXEL_LOGGING_CORRELATION_ID_HEADER]: 'host-request-1',
};

const AI_CONTEXT: Context = {
  channel: 'ai-assistant',
  agent: 'anthropic/claude-sonnet-4.5',
  room: '!ai-room:localhost',
  correlationId: 'toolu_01AbCdEf',
  pushId: null,
  pushFinal: false,
};

const FINAL_PUSH: Record<string, string> = {
  [WRITE_CHANNEL_HEADER]: 'boxel-cli',
  [PUSH_ID_HEADER]: 'push-7f3a',
  [PUSH_FINAL_HEADER]: 'true',
  [X_BOXEL_LOGGING_CORRELATION_ID_HEADER]: 'cli-request-9',
};

const FINAL_PUSH_CONTEXT: Context = {
  channel: 'boxel-cli',
  agent: null,
  room: null,
  correlationId: 'cli-request-9',
  pushId: 'push-7f3a',
  pushFinal: true,
};

module(basename(import.meta.filename), function () {
  const realmURL = new URL('http://127.0.0.1:4476/test/');
  const realmHref = realmURL.href;
  const writer = '@john:localhost';
  let testRealm: Realm;
  let request: RealmRequest;
  let dbAdapter: PgAdapter;

  function onRealmSetup(args: {
    testRealm: Realm;
    request: SuperTest<Test>;
    dbAdapter: PgAdapter;
  }) {
    testRealm = args.testRealm;
    request = withRealmPath(args.request, realmURL);
    dbAdapter = args.dbAdapter;
  }

  // Registers the realm the way the realm server's registry would, and turns
  // its recording on. The test realm has no registry row of its own.
  async function startRecording(): Promise<void> {
    await query(dbAdapter, [
      'INSERT INTO realm_registry (url, kind, disk_id, owner_username, pinned) VALUES (',
      param(realmHref),
      ", 'source', 'test/test', '@user:localhost', false) ON CONFLICT (url) DO NOTHING",
    ]);
    await query(dbAdapter, [
      'INSERT INTO realm_history_state (realm_id, enabled)',
      'SELECT id, true FROM realm_registry WHERE url =',
      param(realmHref),
      'ON CONFLICT (realm_id) DO UPDATE SET enabled = true',
    ]);
  }

  async function events(): Promise<EventRow[]> {
    let rows = await query(dbAdapter, [
      'SELECT seq, author, channel, agent, room, correlation_id, push_id,',
      'push_final, intent, changes FROM realm_change_events WHERE realm_url =',
      param(realmHref),
      'ORDER BY seq',
    ]);
    return rows.map((row) => ({
      seq: Number(row.seq),
      author: String(row.author),
      channel: String(row.channel),
      agent: (row.agent as string | null) ?? null,
      room: (row.room as string | null) ?? null,
      correlationId: (row.correlation_id as string | null) ?? null,
      pushId: (row.push_id as string | null) ?? null,
      pushFinal: Boolean(row.push_final),
      intent: (row.intent as unknown as ChangeIntent | null) ?? null,
      paths: (row.changes as unknown as { path: string }[]).map(
        (change) => change.path,
      ),
    }));
  }

  function contextOf(event: EventRow): Context {
    let { channel, agent, room, correlationId, pushId, pushFinal } = event;
    return { channel, agent, room, correlationId, pushId, pushFinal };
  }

  // Runs one write and answers the events it left: a card PATCH can commit
  // twice, once more to reserialize, and each commit is an event.
  async function eventsOf(write: () => Promise<void>): Promise<EventRow[]> {
    let before = (await events()).length;
    await write();
    return (await events()).slice(before);
  }

  function auth() {
    return `Bearer ${createJWT(testRealm, writer, ['read', 'write'])}`;
  }

  function withHeaders(req: Test, headers: Record<string, string>): Test {
    for (let [name, value] of Object.entries(headers)) {
      req = req.set(name, value);
    }
    return req;
  }

  async function writeSource(
    path: string,
    content: string,
    headers: Record<string, string> = {},
  ) {
    let response = await withHeaders(
      request
        .post(`/${path}`)
        .set('Accept', SupportedMimeType.CardSource)
        .set('Content-Type', 'text/plain;charset=UTF-8')
        .set('Authorization', auth()),
      headers,
    ).send(content);
    if (response.status !== 204) {
      throw new Error(
        `writing ${path} answered ${response.status}: ${response.text}`,
      );
    }
  }

  // Every front door that changes a realm file, each making a write of its
  // own each time it runs (`n` keeps the bytes and paths distinct, so no
  // write is a no-op that records nothing). `prepare` lays down what the write
  // needs, outside the events the test reads.
  const WRITES: {
    kind: string;
    path: (n: number) => string;
    prepare?: (n: number) => Promise<void>;
    send: (headers: Record<string, string>, n: number) => Promise<void>;
  }[] = [
    {
      kind: 'a card PATCH',
      path: () => 'person-1.json',
      send: async (headers, n) => {
        let response = await withHeaders(
          request
            .patch('/person-1')
            .set('Accept', SupportedMimeType.CardJson)
            .set('Authorization', auth()),
          headers,
        ).send({
          data: {
            type: 'card',
            attributes: { firstName: `Mango ${n}` },
            meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
          },
        });
        if (response.status !== 200) {
          throw new Error(
            `PATCH answered ${response.status}: ${response.text}`,
          );
        }
      },
    },
    {
      kind: 'a source write',
      path: (n) => `notes/source-${n}.md`,
      send: (headers, n) =>
        writeSource(`notes/source-${n}.md`, `# source ${n}`, headers),
    },
    {
      kind: 'an /_atomic batch',
      path: (n) => `notes/atomic-${n}.md`,
      send: async (headers, n) => {
        let response = await withHeaders(
          request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set('Authorization', auth()),
          headers,
        ).send(
          JSON.stringify({
            'atomic:operations': [
              {
                op: 'add',
                href: `notes/atomic-${n}.md`,
                data: {
                  type: 'source',
                  attributes: { content: `# atomic ${n}` },
                  meta: {},
                },
              },
            ],
          }),
        );
        if (response.status !== 201) {
          throw new Error(
            `/_atomic answered ${response.status}: ${response.text}`,
          );
        }
      },
    },
    {
      kind: 'an /_operations batch',
      path: () => 'telemetry.log',
      send: async (headers, n) => {
        let response = await withHeaders(
          request
            .post('/_operations')
            .set('Accept', SupportedMimeType.BoxelOperations)
            .set('Content-Type', SupportedMimeType.BoxelOperations)
            .set('Authorization', auth()),
          headers,
        ).send(
          JSON.stringify({
            'boxel:operations': [
              {
                op: 'invoke',
                'boxel:name': 'appendLine',
                href: '/telemetry.log',
                data: { line: `entry ${n}` },
              },
            ],
          }),
        );
        if (response.status !== 200) {
          throw new Error(
            `/_operations answered ${response.status}: ${response.text}`,
          );
        }
      },
    },
    {
      kind: 'an upload',
      path: (n) => `uploads/bytes-${n}.bin`,
      send: async (headers, n) => {
        let response = await withHeaders(
          request
            .post(`/uploads/bytes-${n}.bin`)
            .set('Content-Type', 'application/octet-stream')
            .set('Authorization', auth()),
          headers,
        ).send(Buffer.from([1, 2, n]));
        if (response.status !== 204) {
          throw new Error(
            `upload answered ${response.status}: ${response.text}`,
          );
        }
      },
    },
    {
      kind: 'a source delete',
      path: (n) => `doomed-${n}.txt`,
      prepare: (n) => writeSource(`doomed-${n}.txt`, 'bye'),
      send: async (headers, n) => {
        let response = await withHeaders(
          request
            .delete(`/doomed-${n}.txt`)
            .set('Accept', SupportedMimeType.CardSource)
            .set('Authorization', auth()),
          headers,
        );
        if (response.status !== 204) {
          throw new Error(
            `delete answered ${response.status}: ${response.text}`,
          );
        }
      },
    },
  ];

  module('a recording realm', function (hooks) {
    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: {
        '*': ['read'],
        [writer]: ['read', 'write'],
      },
      fileSystem: {
        'person.gts': personGts,
        'person-1.json': {
          data: {
            type: 'card',
            attributes: { firstName: 'Mango' },
            meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
          },
        },
        'telemetry.log': 'boot\n',
      },
      history: { journal: new PostgresChangeJournal() },
      onRealmSetup,
    });

    hooks.beforeEach(async function () {
      await startRecording();
    });

    for (let { kind, path, prepare, send } of WRITES) {
      test(`${kind} records an AI write's channel, agent, room and tool call`, async function (assert) {
        await prepare?.(1);
        let recorded = await eventsOf(() => send(AI_WRITE, 1));
        assert.true(recorded.length > 0, 'the write left an event');
        for (let event of recorded) {
          assert.deepEqual(event.paths, [path(1)]);
          assert.deepEqual(contextOf(event), AI_CONTEXT);
          assert.strictEqual(event.author, writer, 'the authenticated user');
        }
      });

      test(`${kind} records a push's id and its final request`, async function (assert) {
        await prepare?.(2);
        let recorded = await eventsOf(() => send(FINAL_PUSH, 2));
        assert.true(recorded.length > 0, 'the write left an event');
        for (let event of recorded) {
          assert.deepEqual(event.paths, [path(2)]);
          assert.deepEqual(contextOf(event), FINAL_PUSH_CONTEXT);
        }
      });
    }

    test('a write that names no channel is recorded as api, with no context', async function (assert) {
      let [event] = await eventsOf(() => writeSource('plain.txt', 'plain'));
      assert.deepEqual(contextOf(event), {
        channel: 'api',
        agent: null,
        room: null,
        correlationId: null,
        pushId: null,
        pushFinal: false,
      });
    });

    test("a header claiming one of the realm server's own channels is recorded as api", async function (assert) {
      for (let claimed of ['system', 'deploy', 'operations', 'mcp']) {
        let [event] = await eventsOf(() =>
          writeSource(`claimed-${claimed}.txt`, claimed, {
            [WRITE_CHANNEL_HEADER]: claimed,
          }),
        );
        assert.strictEqual(event.channel, 'api', `a claim of ${claimed}`);
      }
      let [unknown] = await eventsOf(() =>
        writeSource('claimed-unknown.txt', 'unknown', {
          [WRITE_CHANNEL_HEADER]: 'robot',
        }),
      );
      assert.strictEqual(unknown.channel, 'api', 'an unknown channel');
      let [spelled] = await eventsOf(() =>
        writeSource('claimed-host.txt', 'host', {
          [WRITE_CHANNEL_HEADER]: ' Host ',
        }),
      );
      assert.strictEqual(
        spelled.channel,
        'host',
        "a client's channel, however it is cased",
      );
    });

    test("an AI write's tool call is its correlation id; any other write's is its logging correlation id", async function (assert) {
      let [ai] = await eventsOf(() =>
        writeSource('ai.txt', 'ai', {
          [WRITE_CHANNEL_HEADER]: 'ai-assistant',
          [WRITE_TOOL_CALL_HEADER]: 'call_42',
          [X_BOXEL_LOGGING_CORRELATION_ID_HEADER]: 'host-request-2',
        }),
      );
      assert.strictEqual(ai.correlationId, 'call_42', 'the tool call');

      let [cli] = await eventsOf(() =>
        writeSource('cli.txt', 'cli', {
          [WRITE_CHANNEL_HEADER]: 'boxel-cli',
          [WRITE_TOOL_CALL_HEADER]: 'call_43',
          [X_BOXEL_LOGGING_CORRELATION_ID_HEADER]: 'cli-request-3',
        }),
      );
      assert.strictEqual(
        cli.correlationId,
        'cli-request-3',
        'the logging correlation id, not a tool call',
      );

      let [untracked] = await eventsOf(() =>
        writeSource('ai-untracked.txt', 'ai', {
          [WRITE_CHANNEL_HEADER]: 'ai-assistant',
          [X_BOXEL_LOGGING_CORRELATION_ID_HEADER]: 'host-request-4',
        }),
      );
      assert.strictEqual(
        untracked.correlationId,
        'host-request-4',
        'an AI write naming no tool call falls back to its logging correlation id',
      );
    });

    test("the AI headers on a write that isn't the AI assistant's are dropped", async function (assert) {
      let [event] = await eventsOf(() =>
        writeSource('host.txt', 'host', {
          [WRITE_CHANNEL_HEADER]: 'host',
          [WRITE_AGENT_HEADER]: 'anthropic/claude-sonnet-4.5',
          [WRITE_ROOM_HEADER]: '!ai-room:localhost',
        }),
      );
      assert.deepEqual(contextOf(event), {
        channel: 'host',
        agent: null,
        room: null,
        correlationId: null,
        pushId: null,
        pushFinal: false,
      });
    });

    test('a push request that is not the last carries the push id alone, and a final mark needs a push id', async function (assert) {
      let [middle] = await eventsOf(() =>
        writeSource('push-middle.txt', 'middle', {
          [WRITE_CHANNEL_HEADER]: 'boxel-cli',
          [PUSH_ID_HEADER]: 'push-7f3a',
        }),
      );
      assert.strictEqual(middle.pushId, 'push-7f3a');
      assert.false(middle.pushFinal);

      let [orphan] = await eventsOf(() =>
        writeSource('push-orphan.txt', 'orphan', {
          [WRITE_CHANNEL_HEADER]: 'boxel-cli',
          [PUSH_FINAL_HEADER]: 'true',
        }),
      );
      assert.strictEqual(orphan.pushId, null);
      assert.false(orphan.pushFinal, 'no push to be the last request of');
    });

    test('a header value too long to keep is dropped', async function (assert) {
      let [event] = await eventsOf(() =>
        writeSource('long.txt', 'long', {
          [WRITE_CHANNEL_HEADER]: 'ai-assistant',
          [WRITE_AGENT_HEADER]: 'a'.repeat(300),
          [WRITE_ROOM_HEADER]: '!ai-room:localhost',
        }),
      );
      assert.strictEqual(event.agent, null);
      assert.strictEqual(event.room, '!ai-room:localhost');
    });

    test('the author is the authenticated user whatever the headers say', async function (assert) {
      let [event] = await eventsOf(() =>
        writeSource('authored.txt', 'authored', {
          ...AI_WRITE,
          [WRITE_AGENT_HEADER]: '@mallory:localhost',
          [PUSH_ID_HEADER]: '@mallory:localhost',
        }),
      );
      assert.strictEqual(event.author, writer);
      assert.strictEqual(event.agent, '@mallory:localhost', 'advisory only');
    });

    test('a cross-origin preflight naming every write context header is accepted', async function (assert) {
      let response = await request
        .options('/notes/preflight.md')
        .set('Origin', 'https://app.write-context.test')
        .set('Access-Control-Request-Method', 'POST')
        .set(
          'Access-Control-Request-Headers',
          WRITE_CONTEXT_HEADERS.join(', '),
        );
      assert.strictEqual(response.status, 204);
      let allowed = (response.headers['access-control-allow-headers'] ?? '')
        .split(',')
        .map((header: string) => header.trim().toLowerCase());
      for (let header of WRITE_CONTEXT_HEADERS) {
        assert.true(
          allowed.includes(header.toLowerCase()),
          `the preflight allows ${header}`,
        );
      }
    });

    test('an operation marks the batch it writes with a revert intent', async function (assert) {
      let intent: ChangeIntent = {
        kind: 'revert',
        revision: '1a2b3c4',
        path: 'notes/',
        forced: false,
      };
      let [event] = await eventsOf(async () => {
        await commitBatch(
          testRealm.batchCore,
          [
            {
              op: 'update',
              href: `${realmHref}notes/reverted.md`,
              content: '# as it was',
              rawSource: true,
            },
          ],
          {
            clientRequestId: 'revert-1',
            actor: writer,
            history: { channel: 'host', intent },
          },
        );
      });
      assert.deepEqual(event.intent, intent);
      assert.strictEqual(event.channel, 'host');
      assert.strictEqual(event.author, writer);
    });

    test('a writer with no request names the mcp channel itself', async function (assert) {
      let [event] = await eventsOf(async () => {
        await commitBatch(
          testRealm.batchCore,
          [
            {
              op: 'update',
              href: `${realmHref}notes/from-mcp.md`,
              content: '# from a connector',
              rawSource: true,
            },
          ],
          {
            clientRequestId: 'mcp-1',
            actor: writer,
            history: {
              channel: 'mcp',
              agent: 'claude',
              correlationId: 'write-7',
            },
          },
        );
      });
      assert.deepEqual(contextOf(event), {
        channel: 'mcp',
        agent: 'claude',
        room: null,
        correlationId: 'write-7',
        pushId: null,
        pushFinal: false,
      });
      assert.strictEqual(
        event.author,
        writer,
        'the user the connector acts for',
      );
    });
  });
});
