import { query, param, type DBAdapter, type Expression } from './index.ts';

// Returns created_at (epoch seconds) or undefined if not found
export async function getCreatedTime(
  db: DBAdapter,
  realmURL: string,
  localPath: string,
): Promise<number | undefined> {
  let rows = await query(db, [
    'SELECT created_at FROM realm_file_meta WHERE realm_url =',
    param(realmURL),
    'AND file_path =',
    param(localPath),
    'LIMIT 1',
  ]);
  if (!rows || rows.length === 0) return undefined;
  let created = rows[0]['created_at'];
  if (created == null) return undefined;
  return typeof created === 'string' ? parseInt(created) : Number(created);
}

// Reads the content hash and size the realm persisted at write time in a
// single row lookup.
export async function getContentMeta(
  db: DBAdapter,
  realmURL: string,
  localPath: string,
): Promise<{
  contentHash: string | undefined;
  contentSize: number | undefined;
}> {
  let rows = await query(db, [
    'SELECT content_hash, content_size FROM realm_file_meta WHERE realm_url =',
    param(realmURL),
    'AND file_path =',
    param(localPath),
    'LIMIT 1',
  ]);
  if (!rows || rows.length === 0) {
    return { contentHash: undefined, contentSize: undefined };
  }
  let contentHash = rows[0]['content_hash'];
  let contentSize = rows[0]['content_size'];
  return {
    contentHash: contentHash == null ? undefined : String(contentHash),
    contentSize:
      contentSize == null
        ? undefined
        : typeof contentSize === 'string'
          ? parseInt(contentSize)
          : Number(contentSize),
  };
}

// Reads created_at + content hash/size for many paths in a single query. Only
// paths with a persisted row are returned; a caller treats an absent path as
// "no persisted meta for this file" and falls back to its own per-path read.
// The indexer uses this to prefetch a whole visit set up front so its per-visit
// created_at / content-meta lookups are served from memory instead of a DB
// round-trip each.
export async function getFileMetaForPaths(
  db: DBAdapter,
  realmURL: string,
  localPaths: string[],
): Promise<
  Map<
    string,
    {
      createdAt: number;
      contentHash: string | undefined;
      contentSize: number | undefined;
    }
  >
> {
  let result = new Map<
    string,
    {
      createdAt: number;
      contentHash: string | undefined;
      contentSize: number | undefined;
    }
  >();
  let uniquePaths = Array.from(new Set(localPaths));
  if (!db || uniquePaths.length === 0) return result;

  // Chunk the IN-list so a large visit set (a from-scratch over a big realm)
  // stays under the adapter's bind-parameter ceiling — SQLite's is the tight
  // one — rather than failing the whole pass with a parameter-limit error. Each
  // chunk is one round-trip; a set within a single chunk is a single query.
  let CHUNK_SIZE = 500;
  for (let start = 0; start < uniquePaths.length; start += CHUNK_SIZE) {
    let chunk = uniquePaths.slice(start, start + CHUNK_SIZE);
    let expr: Expression = [
      'SELECT file_path, created_at, content_hash, content_size FROM realm_file_meta WHERE realm_url =',
      param(realmURL),
      'AND file_path IN',
      '(',
    ];
    chunk.forEach((p, idx) => {
      if (idx > 0) expr.push(',');
      expr.push(param(p));
    });
    expr.push(')');
    let rows = await query(db, expr);
    for (let row of rows) {
      let path = String(row['file_path']);
      let created = row['created_at'];
      let contentHash = row['content_hash'];
      let contentSize = row['content_size'];
      result.set(path, {
        createdAt:
          typeof created === 'string' ? parseInt(created) : Number(created),
        contentHash: contentHash == null ? undefined : String(contentHash),
        contentSize:
          contentSize == null
            ? undefined
            : typeof contentSize === 'string'
              ? parseInt(contentSize)
              : Number(contentSize),
      });
    }
  }
  return result;
}

// Ensures a created_at row exists for the given path; returns epoch seconds
export async function ensureFileCreatedAt(
  db: DBAdapter,
  realmURL: string,
  localPath: string,
): Promise<number> {
  // Try existing first
  let existing = await getCreatedTime(db, realmURL, localPath);
  if (existing !== undefined) return existing;

  // Insert and re-read
  let now = Math.floor(Date.now() / 1000);
  await query(db, [
    'INSERT INTO realm_file_meta (realm_url, file_path, created_at) VALUES',
    '(',
    param(realmURL),
    ',',
    param(localPath),
    ',',
    param(now),
    ')',
    'ON CONFLICT (realm_url, file_path) DO NOTHING',
  ]);

  let created = await getCreatedTime(db, realmURL, localPath);
  return created ?? now;
}

// Bulk persist created_at for many paths (idempotent) and return a map
export async function persistFileMeta(
  db: DBAdapter,
  realmURL: string,
  rows: { path: string; contentHash?: string; contentSize?: number }[],
): Promise<
  Map<string, { createdAt: number; contentHash?: string; contentSize?: number }>
> {
  let createdMap = new Map<
    string,
    { createdAt: number; contentHash?: string; contentSize?: number }
  >();
  if (!db || rows.length === 0) return createdMap;

  // Insert rows for all paths; do not overwrite existing ones
  let expr: Expression = [
    'INSERT INTO realm_file_meta (realm_url, file_path, created_at, content_hash, content_size) VALUES',
  ];
  let now = Math.floor(Date.now() / 1000);
  rows.forEach((row, idx) => {
    if (idx > 0) expr.push(',');
    expr.push(
      '(',
      param(realmURL),
      ',',
      param(row.path),
      ',',
      param(now),
      ',',
      param(row.contentHash ?? null),
      ',',
      param(row.contentSize ?? null),
      ')',
    );
  });
  // The ON CONFLICT clause uses COALESCE to preserve existing values when the new value is null.
  // This is correct behavior for the case where file content hasn't changed.
  expr.push(
    'ON CONFLICT (realm_url, file_path) DO UPDATE SET content_hash =',
    'COALESCE(EXCLUDED.content_hash, realm_file_meta.content_hash)',
    ', content_size =',
    'COALESCE(EXCLUDED.content_size, realm_file_meta.content_size)',
  );
  await query(db, expr);

  // Fetch created_at for all affected paths (both pre-existing and new)
  let uniquePaths = Array.from(new Set(rows.map((row) => row.path)));
  if (uniquePaths.length > 0) {
    let selectExpr: Expression = [
      'SELECT file_path, created_at, content_hash, content_size FROM realm_file_meta WHERE realm_url =',
      param(realmURL),
      'AND file_path IN',
      '(',
    ];
    uniquePaths.forEach((p, idx) => {
      if (idx > 0) selectExpr.push(',');
      selectExpr.push(param(p));
    });
    selectExpr.push(')');
    let rowsResult = await query(db, selectExpr);
    for (let row of rowsResult) {
      let path = String(row['file_path']);
      let created = row['created_at'];
      let contentHash = row['content_hash'];
      let contentSize = row['content_size'];
      createdMap.set(path, {
        createdAt:
          typeof created === 'string' ? parseInt(created) : Number(created),
        contentHash: contentHash == null ? undefined : String(contentHash),
        contentSize:
          contentSize == null
            ? undefined
            : typeof contentSize === 'string'
              ? parseInt(contentSize)
              : Number(contentSize),
      });
    }
  }
  return createdMap;
}

export async function removeFileMeta(
  db: DBAdapter,
  realmURL: string,
  paths: string[],
): Promise<void> {
  if (!db || paths.length === 0) return;
  let expr: Expression = [
    'DELETE FROM realm_file_meta WHERE realm_url =',
    param(realmURL),
    'AND file_path IN',
    '(',
  ];
  paths.forEach((p, idx) => {
    if (idx > 0) expr.push(',');
    expr.push(param(p));
  });
  expr.push(')');
  await query(db, expr);
}
