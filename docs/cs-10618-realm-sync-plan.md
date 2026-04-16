# CS-10618: Reimplement `boxel realm sync`

## Goal
Bidirectional sync between local and remote realm with conflict resolution.

## Files
- **CREATE** `packages/boxel-cli/src/commands/realm/sync.ts`
- **CREATE** `packages/boxel-cli/src/lib/sync-manifest.ts`
- **CREATE** `packages/boxel-cli/tests/integration/realm-sync.test.ts`
- **MODIFY** `packages/boxel-cli/src/commands/realm/index.ts`
- **MODIFY** `packages/boxel-cli/src/commands/realm/push.ts`

## Design
- `RealmSyncer extends RealmSyncBase`
- Extract shared manifest utils from push.ts into sync-manifest.ts
- 7-phase algorithm: gather state, classify files, determine actions, resolve conflicts, execute, update manifest, checkpoint
- Conflict strategies: `--prefer-local`, `--prefer-remote`, `--prefer-newest`

## Test Plan
Integration tests using same infra as realm-push.test.ts, covering all conflict matrix scenarios.
