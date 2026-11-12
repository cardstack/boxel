// The files an automation's runs created, one `automation_files` row each:
// what the automation's storage charge prices and the console's storage view
// lists.
//
// A run's batch commits through the realm's own write path, which records the
// files the batch created in the same transaction as their `realm_file_meta`
// rows, and forgets a file in the same transaction as its `realm_file_meta`
// row when anyone deletes it. So a file counts from the commit that created it
// until whoever deletes it, and a file the run only changed counts for no
// automation.
//
// Files are spelled as `realm_file_meta` spells them, the realm's URL and the
// file's realm-local path, so the measurement below reads each file's size by
// primary key.

import type { DBAdapter } from './db.ts';
import {
  addExplicitParens,
  dbAdapterQuerier,
  param,
  separatedByCommas,
  type Expression,
  type Querier,
} from './expression.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';

// The run a write commits for: set on a write by the commit of an automation
// run's batch, and on no other write.
export interface AutomationRunWrite {
  // The `automation_runs` id.
  runId: string;
  // The automation card's canonical identifier.
  automationId: RealmResourceIdentifier;
}

// Records `paths`, files a run's commit just created in `realmURL`, as the
// run's automation's. A file already recorded keeps the automation that
// created it.
export async function recordAutomationFiles(
  querier: Querier,
  realmURL: string,
  run: AutomationRunWrite,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  let rows = paths.map(
    (path) =>
      addExplicitParens(
        separatedByCommas([
          [param(realmURL)],
          [param(path)],
          [param(run.automationId)],
          [param(run.runId)],
        ]),
      ) as Expression,
  );
  await querier([
    'INSERT INTO automation_files (realm_url, file_path, automation_id, run_id) VALUES',
    ...separatedByCommas(rows),
    'ON CONFLICT (realm_url, file_path) DO NOTHING',
  ] as Expression);
}

// Forgets `paths`, files just deleted from `realmURL`, whichever automation
// created them.
export async function forgetAutomationFiles(
  querier: Querier,
  realmURL: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  await querier([
    'DELETE FROM automation_files WHERE realm_url =',
    param(realmURL),
    'AND file_path IN',
    ...(addExplicitParens(
      separatedByCommas(paths.map((path) => [param(path)])),
    ) as Expression),
  ] as Expression);
}

// One file an automation's runs created, and the bytes it takes:
//
// - `fileBytes`: its size on disk, as its write recorded it.
// - `indexBytes`: the size of its rows in the index, when it is a card: its
//   `boxel_index` row and its `prerendered_html` row, as Postgres stores them.
//   A file that isn't a card, or isn't indexed yet, has none.
export interface AutomationFile {
  realmURL: string;
  path: string;
  runId: string;
  createdAt: string;
  fileBytes: number;
  indexBytes: number;
}

export interface AutomationStorage {
  files: AutomationFile[];
  fileBytes: number;
  indexBytes: number;
}

// The files the automation's runs created that still exist, and the bytes they
// take on disk and in the index.
export async function getAutomationStorage(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
): Promise<AutomationStorage> {
  let query = dbAdapterQuerier(dbAdapter);
  let rows = await query([
    `SELECT f.realm_url, f.file_path, f.run_id, f.created_at,
       COALESCE(m.content_size, 0) AS file_bytes,
       COALESCE((SELECT SUM(pg_column_size(i.*)) FROM boxel_index i
         WHERE i.realm_url = f.realm_url AND i.url = f.realm_url || f.file_path
           AND i.type = 'instance' AND i.is_deleted IS NOT TRUE), 0)
       + COALESCE((SELECT SUM(pg_column_size(h.*)) FROM prerendered_html h
         WHERE h.realm_url = f.realm_url AND h.url = f.realm_url || f.file_path
           AND h.type = 'instance' AND h.is_deleted IS NOT TRUE), 0)
         AS index_bytes
     FROM automation_files f
     JOIN realm_file_meta m
       ON m.realm_url = f.realm_url AND m.file_path = f.file_path
     WHERE f.automation_id =`,
    param(automationId),
    'ORDER BY f.realm_url, f.file_path',
  ]);
  let files = rows.map((row) => ({
    realmURL: String(row.realm_url),
    path: String(row.file_path),
    runId: String(row.run_id),
    createdAt: new Date(row.created_at as string).toISOString(),
    fileBytes: Number(row.file_bytes),
    indexBytes: Number(row.index_bytes),
  }));
  return {
    files,
    fileBytes: files.reduce((sum, file) => sum + file.fileBytes, 0),
    indexBytes: files.reduce((sum, file) => sum + file.indexBytes, 0),
  };
}
