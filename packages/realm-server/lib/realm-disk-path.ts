import { join, relative, resolve, sep, isAbsolute } from 'path';
import { PUBLISHED_DIRECTORY_NAME } from '@cardstack/runtime-common';
import type { RealmRegistryRow } from './realm-registry-reconciler.ts';

// The directory a realm's files live in, from its registry row alone, so a
// caller can reach them without mounting the realm. The mount takes its
// directory from here too, which is what makes the files read that way the
// files the mounted realm reads. A row this refuses cannot be mounted.
//
// `disk_id` is kind-specific (see the realm_registry migration column
// comment): for `bootstrap` it's an absolute path; for `source` it's a
// directory under `realmsRootPath`; for `published` it's a directory
// under `realmsRootPath/PUBLISHED_DIRECTORY_NAME`.
//
// `source`/`published` rows go through `safeJoinUnderRoot` rather than
// a bare `path.join`. Both write paths today validate inputs
// (`create-realm.ts` rejects endpoints that don't match
// /^[a-z0-9-]+$/, etc.), but `disk_id` is just a string column and a
// future write path (or a backfill rebuilt from disk by an operator
// with shell access) could write an absolute path or `..` segments
// that would let `path.join` escape `realmsRootPath`. Anchoring with
// `path.resolve` + a prefix check keeps the caller's blast radius
// pinned to the realm root regardless of how the row was written.
export function realmDiskPath(
  row: Pick<RealmRegistryRow, 'kind' | 'disk_id'>,
  realmsRootPath: string,
): string | null {
  switch (row.kind) {
    case 'bootstrap':
      return row.disk_id;
    case 'source':
      return safeJoinUnderRoot(realmsRootPath, row.disk_id);
    case 'published':
      return safeJoinUnderRoot(
        join(realmsRootPath, PUBLISHED_DIRECTORY_NAME),
        row.disk_id,
      );
    default:
      return null;
  }
}

function safeJoinUnderRoot(root: string, segment: string): string | null {
  if (isAbsolute(segment)) {
    return null;
  }
  let absoluteRoot = resolve(root);
  let candidate = resolve(absoluteRoot, segment);
  if (candidate !== absoluteRoot && !candidate.startsWith(absoluteRoot + sep)) {
    return null;
  }
  // Belt and suspenders — `path.relative` should agree, and surfaces any
  // edge case path.resolve might smooth over.
  let rel = relative(absoluteRoot, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return null;
  }
  return candidate;
}
