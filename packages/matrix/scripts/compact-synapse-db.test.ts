import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { tmpdir } from 'os';
import { join } from 'path';

const packageDir = join(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'compact-synapse-db-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

interface Setup {
  members: string[];
  cursor: [number, string];
  maxPruned?: number;
}

// The synapse tables the script reads, with the columns synapse gives them.
function createDataDir(name: string, setup: Setup) {
  let dataDir = join(scratch, name);
  mkdirSync(join(dataDir, 'db'), { recursive: true });
  writeFileSync(join(dataDir, 'homeserver.yaml'), 'server_name: localhost\n');
  let db = new DatabaseSync(join(dataDir, 'db', 'homeserver.db'));
  db.exec(`
    CREATE TABLE device_lists_changes_in_room (
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      stream_id BIGINT NOT NULL,
      converted_to_destinations BOOLEAN NOT NULL,
      opentracing_context TEXT,
      instance_name TEXT,
      inserted_ts BIGINT
    );
    CREATE UNIQUE INDEX device_lists_changes_in_stream_id
      ON device_lists_changes_in_room(stream_id, room_id);
    CREATE TABLE device_lists_changes_converted_stream_position (
      Lock CHAR(1) NOT NULL DEFAULT 'X' UNIQUE,
      stream_id BIGINT NOT NULL,
      room_id TEXT NOT NULL,
      instance_name TEXT
    );
    CREATE TABLE current_state_events (
      event_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      type TEXT NOT NULL,
      state_key TEXT NOT NULL,
      membership TEXT
    );
    CREATE TABLE partial_state_rooms (
      room_id TEXT PRIMARY KEY,
      device_lists_stream_id BIGINT NOT NULL DEFAULT 0
    );
  `);
  if (setup.maxPruned !== undefined) {
    db.exec(`
      CREATE TABLE device_lists_changes_in_room_max_pruned_stream_id (
        Lock CHAR(1) NOT NULL DEFAULT 'X' UNIQUE,
        stream_id BIGINT NOT NULL
      );
    `);
    db.prepare(
      'INSERT INTO device_lists_changes_in_room_max_pruned_stream_id (stream_id) VALUES (?)',
    ).run(setup.maxPruned);
  }
  let insertChange = db.prepare(
    `INSERT INTO device_lists_changes_in_room
       (user_id, device_id, room_id, stream_id, converted_to_destinations, instance_name, inserted_ts)
       VALUES ('@local-user:localhost', ?, ?, ?, TRUE, 'master', ?)`,
  );
  for (let stream = 1; stream <= 5; stream++) {
    for (let room of ['!a:localhost', '!b:localhost']) {
      insertChange.run(`DEVICE${stream}`, room, stream, 1000 * stream);
    }
  }
  db.prepare(
    `INSERT INTO device_lists_changes_converted_stream_position (stream_id, room_id, instance_name)
       VALUES (?, ?, 'master')`,
  ).run(...setup.cursor);
  let insertMember = db.prepare(
    `INSERT INTO current_state_events (event_id, room_id, type, state_key, membership)
       VALUES (?, '!a:localhost', 'm.room.member', ?, 'join')`,
  );
  setup.members.forEach((member, i) => insertMember.run(`$member${i}`, member));
  db.close();
  return dataDir;
}

function runScript(dataDir: string) {
  execFileSync(
    process.execPath,
    ['./scripts/compact-synapse-db.ts', '--no-backup'],
    {
      cwd: packageDir,
      env: { ...process.env, SYNAPSE_DATA_DIR: dataDir },
      stdio: 'pipe',
      encoding: 'utf8',
    },
  );
}

function compact(dataDir: string) {
  runScript(dataDir);
  return readState(dataDir);
}

function readState(dataDir: string) {
  let db = new DatabaseSync(join(dataDir, 'db', 'homeserver.db'), {
    readOnly: true,
  });
  let streams = (
    db
      .prepare(
        'SELECT DISTINCT stream_id FROM device_lists_changes_in_room ORDER BY stream_id',
      )
      .all() as { stream_id: number }[]
  ).map((row) => row.stream_id);
  let cursor = db
    .prepare(
      'SELECT stream_id, room_id FROM device_lists_changes_converted_stream_position',
    )
    .get() as { stream_id: number; room_id: string };
  let hasMarker = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table'
         AND name = 'device_lists_changes_in_room_max_pruned_stream_id'`,
    )
    .get();
  let maxPruned = hasMarker
    ? (
        db
          .prepare(
            'SELECT stream_id FROM device_lists_changes_in_room_max_pruned_stream_id',
          )
          .get() as { stream_id: number }
      ).stream_id
    : undefined;
  db.close();
  return { streams, cursor: [cursor.stream_id, cursor.room_id], maxPruned };
}

test('a local-only database keeps the newest stream and records the rest as pruned', () => {
  let result = compact(
    createDataDir('local-only', {
      members: ['@local-user:localhost'],
      cursor: [2, '!a:localhost'],
      maxPruned: 0,
    }),
  );
  assert.deepEqual(result.streams, [5]);
  assert.deepEqual(result.cursor, [5, '!b:localhost']);
  assert.equal(result.maxPruned, 4);
});

test('a federating database keeps the unconverted streams and records the converted ones as pruned', () => {
  let result = compact(
    createDataDir('federating', {
      members: ['@local-user:localhost', '@remote-user:elsewhere.example'],
      cursor: [3, '!a:localhost'],
      maxPruned: 0,
    }),
  );
  assert.deepEqual(result.streams, [3, 4, 5]);
  assert.deepEqual(result.cursor, [3, '!a:localhost']);
  assert.equal(result.maxPruned, 2);
});

test('a pruned-stream marker synapse already raised past the boundary is not lowered', () => {
  let result = compact(
    createDataDir('marker-ahead', {
      members: ['@local-user:localhost'],
      cursor: [2, '!a:localhost'],
      maxPruned: 10,
    }),
  );
  assert.deepEqual(result.streams, [5]);
  assert.equal(result.maxPruned, 10);
});

test('a database without the pruned-stream marker table is refused and left as it was', () => {
  let dataDir = createDataDir('no-marker', {
    members: ['@local-user:localhost'],
    cursor: [2, '!a:localhost'],
  });
  assert.throws(
    () => runScript(dataDir),
    (e: { stderr: string }) =>
      e.stderr.includes(
        'has no device_lists_changes_in_room_max_pruned_stream_id table',
      ),
  );
  let result = readState(dataDir);
  assert.deepEqual(result.streams, [1, 2, 3, 4, 5]);
  assert.deepEqual(result.cursor, [2, '!a:localhost']);
  assert.equal(result.maxPruned, undefined);
});
