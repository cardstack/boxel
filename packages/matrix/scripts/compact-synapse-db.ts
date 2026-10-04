// Shrinks a local synapse SQLite database by pruning its device-list change
// log, then rewriting the file without the freed pages.
//
// Synapse writes a `device_lists_changes_in_room` row for every room a user
// has joined each time one of their devices changes, and never deletes those
// rows. A user that gets a new device on every login and sits in thousands of
// session rooms grows the table into tens of gigabytes. The rows are a change
// feed, not room or user data. Synapse reads them for two things:
//
// - Converting each change into outbound pokes for the other homeservers in
//   the room, in (stream_id, room_id) order up to a cursor kept in
//   `device_lists_changes_converted_stream_position`.
// - Answering "which users' devices changed since sync token X?". A token
//   older than the table's oldest stream id gets a full device-list resync.
//
// So the script deletes only a prefix: every row before a boundary stream.
// That keeps the oldest-stream check sound, since every token the deleted rows
// could answer is now older than the table and gets a resync. When no room
// has a member on another homeserver, converting writes nothing but the
// cursor, so the boundary is the newest stream and the cursor moves to it.
// Otherwise the boundary is the cursor's stream, so no unconverted row is
// lost.
//
// Synapse caches the table's oldest stream id, so no running synapse may be
// using the database. The script refuses while a running container mounts the
// data directory; when that container is the dev synapse:
//
//   pnpm stop:synapse && pnpm compact:synapse-db && pnpm start:synapse
//
// The data directory is ./synapse-data (./synapse-data-<slug> in environment
// mode), or SYNAPSE_DATA_DIR when set. Each checkout has its own, and the dev
// synapse uses whichever checkout started it, so another checkout's database
// can be compacted while synapse keeps running.
//
// Pass --no-backup to skip copying the database aside first.

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import yaml from 'yaml';
import {
  getEnvironmentSlug,
  isEnvironmentMode,
} from '../support/environment-config.ts';

const TABLE = 'device_lists_changes_in_room';
const CURSOR_TABLE = 'device_lists_changes_converted_stream_position';
const KEPT_TABLE = 'compact_kept_device_list_changes';

let backup = !process.argv.slice(2).includes('--no-backup');
let dataDir = process.env.SYNAPSE_DATA_DIR
  ? resolve(process.env.SYNAPSE_DATA_DIR)
  : resolve(
      isEnvironmentMode()
        ? `./synapse-data-${getEnvironmentSlug()}`
        : './synapse-data',
    );
let dbPath = join(dataDir, 'db', 'homeserver.db');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function gigabytes(path: string) {
  return `${(statSync(path).size / 1e9).toFixed(2)} GB`;
}

if (!existsSync(dbPath)) {
  fail(`No synapse database at ${dbPath}`);
}

function docker(args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

let runningIds = docker(['ps', '--quiet']).split('\n').filter(Boolean);
if (runningIds.length > 0) {
  let realDataDir = realpathSync(dataDir);
  let mounting = docker([
    'inspect',
    '--format',
    '{{.Name}} {{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}',
    ...runningIds,
  ])
    .split('\n')
    // Container names have no spaces; the mount path may.
    .map((line) => {
      let space = line.indexOf(' ');
      return [line.slice(0, space), line.slice(space + 1)];
    })
    .filter(
      ([, source]) =>
        source && existsSync(source) && realpathSync(source) === realDataDir,
    )
    .map(([name]) => name.replace(/^\//, ''));
  if (mounting.length > 0) {
    fail(
      `${dataDir} is in use by running container ${mounting.join(', ')}. Stop it first (\`pnpm stop:synapse\` for the dev synapse); anything using that synapse loses it until \`pnpm start:synapse\`.`,
    );
  }
}

console.log(`Compacting ${dbPath} (${gigabytes(dbPath)})`);

// Fold the write-ahead log into the main file, so the backup copy and the
// rewrite below both see every committed write.
let db = new DatabaseSync(dbPath);
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();

if (backup) {
  let backupPath = `${dbPath}.bak-${Date.now()}`;
  console.log(`Backing up to ${backupPath}`);
  copyFileSync(dbPath, backupPath);
}

db = new DatabaseSync(dbPath);

function hasTable(name: string) {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name),
  );
}

// True when some room has a member on another homeserver, or is still
// joining one over federation; also when the local server can't be told
// apart from remote ones.
function federates() {
  let configPath = join(dataDir, 'homeserver.yaml');
  let serverName: unknown = existsSync(configPath)
    ? yaml.parse(readFileSync(configPath, 'utf8'))?.server_name
    : undefined;
  if (typeof serverName !== 'string') {
    return true;
  }
  if (
    hasTable('partial_state_rooms') &&
    db.prepare('SELECT 1 FROM partial_state_rooms LIMIT 1').get()
  ) {
    return true;
  }
  // A user id is @localpart:server, and a localpart can't contain a colon.
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM current_state_events
           WHERE type = 'm.room.member' AND membership = 'join'
             AND substr(state_key, instr(state_key, ':') + 1) != ?
           LIMIT 1`,
      )
      .get(serverName),
  );
}

let newest = db
  .prepare(
    `SELECT stream_id, MAX(room_id) AS room_id FROM ${TABLE}
       WHERE stream_id = (SELECT MAX(stream_id) FROM ${TABLE})`,
  )
  .get() as { stream_id: number | null; room_id: string | null };
let cursor = db
  .prepare(`SELECT MIN(stream_id) AS stream_id FROM ${CURSOR_TABLE}`)
  .get() as { stream_id: number | null };

if (newest.stream_id === null) {
  console.log(`${TABLE} is empty; nothing to prune`);
} else {
  let boundary: number;
  let advanceCursor = !federates();
  if (advanceCursor) {
    // No other homeserver shares a room, so converting a row writes no
    // outbound pokes and only advances the cursor; do that directly.
    boundary = newest.stream_id;
  } else {
    // Rows before the cursor's stream are already converted.
    boundary = cursor.stream_id ?? 0;
  }

  console.log(
    `Pruning ${TABLE} rows before stream ${boundary} (newest is ${newest.stream_id})`,
  );
  db.exec('BEGIN');
  try {
    if (advanceCursor) {
      db.prepare(
        `UPDATE ${CURSOR_TABLE} SET stream_id = ?, room_id = ?
           WHERE (stream_id, room_id) < (?, ?)`,
      ).run(newest.stream_id, newest.room_id, newest.stream_id, newest.room_id);
    }
    // Copy the kept rows aside and empty the table with an unconditional
    // DELETE, which drops its pages wholesale instead of deleting row by row.
    // The copy is a table in the database file rather than a TEMP table, so a
    // large one doesn't land in a memory-backed temp directory.
    db.exec(`DROP TABLE IF EXISTS ${KEPT_TABLE}`);
    db.prepare(
      `CREATE TABLE ${KEPT_TABLE} AS SELECT * FROM ${TABLE} WHERE stream_id >= ?`,
    ).run(boundary);
    db.exec(`DELETE FROM ${TABLE}`);
    db.exec(`INSERT INTO ${TABLE} SELECT * FROM ${KEPT_TABLE}`);
    db.exec(`DROP TABLE ${KEPT_TABLE}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

let compactPath = `${dbPath}.compact`;
rmSync(compactPath, { force: true });
console.log('Rewriting the database without free pages');
db.exec(`VACUUM INTO '${compactPath.replace(/'/g, "''")}'`);
db.close();

// The old file's write-ahead log and shared-memory index must not outlive it,
// or synapse would apply them to the new file.
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });
renameSync(compactPath, dbPath);

console.log(
  `Done: ${gigabytes(dbPath)}. If you stopped synapse for this, start it again with \`pnpm start:synapse\`.`,
);
