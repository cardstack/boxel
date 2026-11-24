import type { PgAdapter } from '@cardstack/postgres';
import {
  internalKeyFor,
  param,
  query,
  syncValueStore,
  type CodeRef,
  type VirtualNetwork,
} from '@cardstack/runtime-common';

// Rows written straight into boxel_index, as an index pass would leave them,
// for tests that query a fixture without indexing a realm. Their value-store
// rows are written from them, as the index writer writes a pass's.

export interface IndexRow {
  url: string;
  searchDoc: Record<string, unknown>;
  // the card's type, then its ancestors; none for a file
  types: CodeRef[];
  kind?: 'instance' | 'file'; // default 'instance'
  pristineDoc?: Record<string, unknown>; // default { id: url, type: 'card' }
  fileAlias?: string; // default the url
  lastModified?: number; // default 1_000
  indexedAt?: number; // default now
}

export async function seedIndexRows(
  dbAdapter: PgAdapter,
  vn: VirtualNetwork,
  realm: string,
  rows: IndexRow[],
): Promise<void> {
  for (let row of rows) {
    await query(dbAdapter, [
      `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified) VALUES (`,
      param(row.url),
      `,`,
      param(row.fileAlias ?? row.url),
      `,`,
      param(realm),
      `, 1,`,
      param(row.kind ?? 'instance'),
      `,`,
      param(JSON.stringify(row.pristineDoc ?? { id: row.url, type: 'card' })),
      `::jsonb,`,
      param(JSON.stringify(row.searchDoc)),
      `::jsonb, '[]'::jsonb,`,
      param(
        JSON.stringify(row.types.map((t) => internalKeyFor(t, undefined, vn))),
      ),
      `::jsonb, FALSE, FALSE,`,
      param(row.indexedAt ?? Date.now()),
      `,`,
      param(row.lastModified ?? 1_000),
      `)`,
    ]);
  }
  await syncSeededValueStore(
    dbAdapter,
    realm,
    rows.map((row) => row.url),
  );
}

// The value-store rows of rows a test wrote into boxel_index by hand: those
// of `urls`, or of every row of the realm.
export async function syncSeededValueStore(
  dbAdapter: PgAdapter,
  realm: string,
  urls?: string[],
): Promise<void> {
  let all =
    urls ??
    (
      (await query(dbAdapter, [
        'SELECT DISTINCT url FROM boxel_index WHERE realm_url =',
        param(realm),
      ])) as { url: string }[]
    ).map((row) => row.url);
  await syncValueStore(
    { dbAdapter, query: (e) => query(dbAdapter, e) },
    realm,
    all,
  );
}
