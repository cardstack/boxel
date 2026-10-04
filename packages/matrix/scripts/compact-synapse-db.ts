// Shrinks a local synapse SQLite database by pruning its device-list change
// log, then rewriting the file without the freed pages.
//
// Synapse writes a `device_lists_changes_in_room` row for every room a user
// has joined each time one of their devices changes, and never deletes those
// rows. Server users that log in often and sit in many session rooms grow the
// table into tens of gigabytes. The rows are a change feed, not room or user
// data: once synapse has fanned a row out to remote servers
// (`converted_to_destinations`), it only reads it to answer "which users'
// devices changed since sync token X?", and it answers a token older than the
// table's oldest row with a full device-list resync. So the converted rows can
// go; the unconverted ones are kept for synapse to process.
//
// Synapse caches the table's oldest stream id, so the container must be
// stopped first:
//
//   pnpm stop:synapse && pnpm compact:synapse-db && pnpm start:synapse
//
// Pass --no-backup to skip copying the database aside first.

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, renameSync, rmSync, statSync } from 'fs';
import { join, resolve } from 'path';
import {
  getEnvironmentSlug,
  getSynapseContainerName,
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
let containerName = getSynapseContainerName();

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

let running = execFileSync(
  'docker',
  ['ps', '--quiet', '--filter', `name=^/${containerName}$`],
  { encoding: 'utf8' },
).trim();
if (running) {
  fail(
    `Container '${containerName}' is running. Stop it with \`pnpm stop:synapse\` first; anything using this synapse loses it until \`pnpm start:synapse\`.`,
  );
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
// scanning the whole table.
let indexedBy = hasUnconvertedIndex ? `INDEXED BY ${UNCONVERTED_INDEX}` : '';

console.log(`Pruning converted rows from ${TABLE}`);
db.exec('BEGIN');
try {
  db.exec(
    `CREATE TEMP TABLE kept_device_list_changes AS
       SELECT * FROM ${TABLE} ${indexedBy} WHERE NOT converted_to_destinations`,
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
renameSync(compactPath, dbPath);
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });

console.log(
  `Done: ${gigabytes(dbPath)}. Start synapse with \`pnpm start:synapse\`.`,
);
