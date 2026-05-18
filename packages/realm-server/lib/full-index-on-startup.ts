import type { RealmRegistryRow } from './realm-registry-reconciler';

// Resolves whether a realm should run a from-scratch index when its process
// boots, given the registry row's `kind` and the value of
// REALM_SERVER_FULL_INDEX_ON_STARTUP.
//
// Three-state override:
//   'true'         → every kind full-indexes on startup (legacy behavior).
//   'false'        → no kind full-indexes on startup (cached-index dev flow).
//   undefined      → only kind='bootstrap' realms (the CLI --path realms,
//                    e.g. base / catalog / skills) full-index on startup.
//                    kind='source' and kind='published' skip the boot
//                    reindex; a brand-new index still builds lazily via the
//                    `isNewIndex` branch in Realm.start().
//
// Note: the deploy-time platform-code reindex flows through a separate path
// (handle-post-deployment.ts + boxel-ui checksum), so this resolution does
// not affect post-deploy reindex storms.
export function resolveFullIndexOnStartup(
  kind: RealmRegistryRow['kind'],
  envOverride: string | undefined,
): boolean {
  if (envOverride === 'true') {
    return true;
  }
  if (envOverride === 'false') {
    return false;
  }
  return kind === 'bootstrap';
}
