import { query, param, type DBAdapter, type Expression } from './index';

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

export async function getContentHash(
  db: DBAdapter,
  realmURL: string,
  localPath: string,
): Promise<string | undefined> {
  let rows = await query(db, [
    'SELECT content_hash FROM realm_file_meta WHERE realm_url =',
    param(realmURL),
    'AND file_path =',
    param(localPath),
    'LIMIT 1',
  ]);
  if (!rows || rows.length === 0) return undefined;
  let contentHash = rows[0]['content_hash'];
  if (contentHash == null) return undefined;
  return String(contentHash);
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
  rows: { path: string; contentHash?: string }[],
): Promise<Map<string, { createdAt: number; contentHash?: string }>> {
  let createdMap = new Map<
    string,
    { createdAt: number; contentHash?: string }
  >();
  if (!db || rows.length === 0) return createdMap;

  // Insert rows for all paths; do not overwrite existing ones
  let expr: Expression = [
    'INSERT INTO realm_file_meta (realm_url, file_path, created_at, content_hash) VALUES',
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
      ')',
    );
  });
  // The ON CONFLICT clause uses COALESCE to preserve existing content_hash values when the new value is null.
  // This is correct behavior for the case where file content hasn't changed.
  expr.push(
    'ON CONFLICT (realm_url, file_path) DO UPDATE SET content_hash =',
    'COALESCE(EXCLUDED.content_hash, realm_file_meta.content_hash)',
  );
  await query(db, expr);

  // Fetch created_at for all affected paths (both pre-existing and new)
  let uniquePaths = Array.from(new Set(rows.map((row) => row.path)));
  if (uniquePaths.length > 0) {
    let selectExpr: Expression = [
      'SELECT file_path, created_at, content_hash FROM realm_file_meta WHERE realm_url =',
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
      createdMap.set(path, {
        createdAt:
          typeof created === 'string' ? parseInt(created) : Number(created),
        contentHash: contentHash == null ? undefined : String(contentHash),
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
