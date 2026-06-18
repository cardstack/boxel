import { query, param, type DBAdapter } from '@cardstack/runtime-common';

// Read/write helpers for `unlisted_realm_paths` — the server-issued random path
// segment for a source realm's "unlisted link" publish target. The slug is
// generated server-side (never supplied by the client) so the unguessable
// string can't be hand-picked through direct API calls, and the publish handler
// consults it to reject subdirectory publishes to any other path.

export async function getUnlistedSlug(
  dbAdapter: DBAdapter,
  sourceRealmURL: string,
): Promise<string | null> {
  let rows = (await query(dbAdapter, [
    `SELECT slug FROM unlisted_realm_paths WHERE source_realm_url =`,
    param(sourceRealmURL),
  ])) as { slug: string }[];
  return rows[0]?.slug ?? null;
}

export async function upsertUnlistedSlug(
  dbAdapter: DBAdapter,
  args: { sourceRealmURL: string; slug: string; ownerUserId: string },
): Promise<void> {
  await query(dbAdapter, [
    `INSERT INTO unlisted_realm_paths (source_realm_url, slug, owner_user_id) VALUES (`,
    param(args.sourceRealmURL),
    `,`,
    param(args.slug),
    `,`,
    param(args.ownerUserId),
    `) ON CONFLICT (source_realm_url) DO UPDATE SET slug = EXCLUDED.slug, owner_user_id = EXCLUDED.owner_user_id, updated_at = now()`,
  ]);
}
