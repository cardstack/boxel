import { reconcileDeckBranch } from './deck-realm-sync.ts';
import type { RealmAuthenticator } from './realm-authenticator.ts';

export { DECK_BRANCH_UPDATE_SPEC } from './deck-realm-sync.ts';

export interface DeckPushResult {
  files: string[];
  deleted: string[];
  conflicts?: string[];
  error?: string;
}

// The push half of sync: local changes go to the realm file by file, each
// based on the content it was made against. A file the realm also changed is
// not pushed; it is reported, and `realm sync` (with --prefer-local or
// --prefer-remote) resolves it.
export async function pushDeckBranch(options: {
  realmURL: string;
  localDir: string;
  authenticator: RealmAuthenticator;
  dryRun?: boolean;
}): Promise<DeckPushResult> {
  let result = await reconcileDeckBranch({
    ...options,
    branchName: 'main',
    direction: 'push',
  });
  let conflictError =
    result.conflicts.length > 0
      ? `${result.conflicts.length} file(s) changed on the realm too and were not pushed: ${result.conflicts.join(', ')}. Run 'boxel realm sync' with --prefer-local or --prefer-remote to resolve.`
      : undefined;
  return {
    files: result.pushed,
    deleted: result.remoteDeleted,
    conflicts: result.conflicts,
    ...(result.error || conflictError
      ? { error: result.error ?? conflictError }
      : {}),
  };
}
