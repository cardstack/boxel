import type { Command } from 'commander';

import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import { createDeckWorkspaceCheckpoint } from '../../lib/deck-realm-checkpoints.ts';
import { loadDeckWorkspaceState } from '../../lib/deck-workspace-state.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { detectRealmSyncMode } from '../../lib/realm-sync-mode.ts';

export function registerCheckpointCommand(realm: Command): void {
  realm
    .command('checkpoint')
    .description('Freeze the exact Deck branch state in a local workspace')
    .argument('<local-dir>', 'Existing Deck workspace')
    .requiredOption('-m, --message <message>', 'Checkpoint description')
    .option('--json', 'Print structured JSON')
    .option('--realm-secret-seed', 'Authenticate with the Realm secret seed')
    .action(
      async (
        localDir: string,
        options: {
          message: string;
          json?: boolean;
          realmSecretSeed?: boolean;
        },
      ) => {
        let workspace = await loadDeckWorkspaceState(localDir);
        if (!workspace) {
          throw new Error(
            'Deck Checkpoint requires an existing .boxel-sync.json workspace',
          );
        }
        let resolution = resolveRealmAuthenticator({
          realmUrl: workspace.realmURL,
          realmSecretSeed: await resolveRealmSecretSeed(
            options.realmSecretSeed === true,
          ),
        });
        if (!resolution.ok) throw new Error(resolution.error);
        let mode = await detectRealmSyncMode(
          workspace.realmURL,
          resolution.authenticator,
        );
        if (mode.mode !== 'deck') {
          throw new Error(
            'This Realm uses legacy mtime sync and has no Deck Checkpoints',
          );
        }
        let result = await createDeckWorkspaceCheckpoint({
          localDir,
          message: options.message,
          authenticator: resolution.authenticator,
        });
        console.log(
          options.json
            ? JSON.stringify(result, null, 2)
            : `Checkpointed ${result.branchName} at ${result.checkpointHash}`,
        );
      },
    );
}
