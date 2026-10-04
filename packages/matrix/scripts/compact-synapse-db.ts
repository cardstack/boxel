// Shrinks a local synapse SQLite database by pruning its device-list change
// log, then rewriting the file without the freed pages.
//
// Synapse writes a `device_lists_changes_in_room` row for every room a user
// has joined each time one of their devices changes, and never deletes those
// rows. A user that gets a new device on every login and sits in thousands of
// session rooms grows the table into tens of gigabytes. The rows are a change
// feed, not room or user data: once synapse has fanned a row out to remote
// servers (`converted_to_destinations`), it only reads it to answer "which
// users' devices changed since sync token X?", and it answers a token older
// than the table's oldest row with a full device-list resync. So the converted
// rows can go, except the newest change: synapse reads an empty table's oldest
// row as stream 0, which would make every old token look current and answer
// it with "no changes" instead of a resync. The unconverted rows are kept for
// synapse to process.
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
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import {
  getEnvironmentSlug,
  isEnvironmentMode,
} from '../support/environment-config.ts';

const TABLE = 'device_lists_changes_in_room';
const UNCONVERTED_INDEX = 'device_lists_changes_in_stream_id_unconverted';

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
let hasUnconvertedIndex = Boolean(
  db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`)
    .get(UNCONVERTED_INDEX),
);
// The partial index holds only unconverted rows, so reading through it avoids
// scanning the whole table. The newest change is found through the
// (stream_id, room_id) index.
let indexedBy = hasUnconvertedIndex ? `INDEXED BY ${UNCONVERTED_INDEX}` : '';

console.log(`Pruning converted rows from ${TABLE}`);
db.exec('BEGIN');
try {
  db.exec(
    `CREATE TEMP TABLE kept_device_list_changes AS
       SELECT * FROM ${TABLE} ${indexedBy} WHERE NOT converted_to_destinations
       UNION
       SELECT * FROM ${TABLE}
         WHERE stream_id = (SELECT MAX(stream_id) FROM ${TABLE})`,
  );
  // An unconditional DELETE lets SQLite drop the table's pages wholesale
  // instead of deleting row by row.
  db.exec(`DELETE FROM ${TABLE}`);
  db.exec(`INSERT INTO ${TABLE} SELECT * FROM kept_device_list_changes`);
  db.exec('DROP TABLE kept_device_list_changes');
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
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
