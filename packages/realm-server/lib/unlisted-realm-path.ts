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

// Allocates the realm's unlisted slug without clobbering an existing one. In the
// steady state (a slug is already stored) this is a pure read, so the
// once-per-modal-open call doesn't churn a new row version each time. Only the
// genuine first allocation writes — and there it inserts `candidateSlug`, or, if
// a row appeared since the read (concurrent first-time allocation), converges on
// the stored slug. `DO UPDATE` rather than `DO NOTHING` is deliberate: it makes
// `RETURNING` yield the conflicting row even when another transaction inserted it
// first, so racing allocations both return the same slug instead of one getting
// an empty result. That keeps a slug shown in one tab from being silently
// replaced by a concurrent allocation in another — which would otherwise make
// `handle-publish-realm` reject the first link.
export async function allocateUnlistedSlug(
  dbAdapter: DBAdapter,
  args: { sourceRealmURL: string; candidateSlug: string; ownerUserId: string },
): Promise<string> {
  let existing = await getUnlistedSlug(dbAdapter, args.sourceRealmURL);
  if (existing != null) {
    return existing;
  }
  let rows = (await query(dbAdapter, [
    `INSERT INTO unlisted_realm_paths (source_realm_url, slug, owner_user_id) VALUES (`,
    param(args.sourceRealmURL),
    `,`,
    param(args.candidateSlug),
    `,`,
    param(args.ownerUserId),
    `) ON CONFLICT (source_realm_url) DO UPDATE SET source_realm_url = EXCLUDED.source_realm_url RETURNING slug`,
  ])) as { slug: string }[];
  return rows[0].slug;
}

// Overwrites the realm's unlisted slug. Used only for an explicit "New link"
// regeneration — never for first-time allocation, which must not clobber a slug
// a concurrent request may already be displaying (see allocateUnlistedSlug).
export async function regenerateUnlistedSlug(
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
