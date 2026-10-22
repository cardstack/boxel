import type { Command } from 'commander';
import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import { cutDeckRealmVersion } from '../../lib/deck-realm-version.ts';
import { loadDeckWorkspaceState } from '../../lib/deck-workspace-state.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { detectRealmSyncMode } from '../../lib/realm-sync-mode.ts';
import { BOLD, DIM, FG_GREEN, FG_RED, RESET } from '../../lib/colors.ts';

interface VersionCliOptions {
  package?: string;
  semver?: string;
  branch?: string;
  json?: boolean;
  realmSecretSeed?: boolean;
}

function bailout(message: string): never {
  console.error(`${FG_RED}Error:${RESET} ${message}`);
  process.exit(1);
}

export function registerVersionCommand(realm: Command): void {
  realm
    .command('version')
    .description(
      'Cut an exact Version of a Deck package from its branch head, as its package.json declares',
    )
    .argument(
      '<workspace-or-realm-url>',
      'A clean local workspace made by realm pull, or a Deck-enabled realm URL',
    )
    .option(
      '-p, --package <rri>',
      "Package to cut, such as @acme/button (default: the realm's own package)",
    )
    .option(
      '--semver <version>',
      "Version to cut; must match the package's package.json (default: that version)",
    )
    .option(
      '-b, --branch <name>',
      'Deck branch (default: workspace branch or main)',
    )
    .option('--json', 'Print the cut as JSON')
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile',
    )
    .action(async (target: string, opts: VersionCliOptions) => {
      try {
        let workspace = await loadDeckWorkspaceState(target).catch(
          () => undefined,
        );
        let realmURL = workspace?.realmURL;
        if (!realmURL && URL.canParse(target)) {
          realmURL = new URL(target).href.replace(/\/+$/, '') + '/';
        }
        if (!realmURL) {
          bailout(
            `${target} is neither a Deck workspace nor a realm URL; run realm pull first`,
          );
        }
        if (workspace && opts.branch && opts.branch !== workspace.branchName) {
          bailout(
            `Workspace tracks branch ${workspace.branchName}, not ${opts.branch}`,
          );
        }
        let resolution = resolveRealmAuthenticator({
          realmUrl: realmURL,
          realmSecretSeed: await resolveRealmSecretSeed(
            opts.realmSecretSeed === true,
          ),
        });
        if (!resolution.ok) {
          bailout(resolution.error);
        }
        let mode = await detectRealmSyncMode(
          realmURL,
          resolution.authenticator,
        );
        if (mode.mode !== 'deck') {
          bailout(`${realmURL} does not advertise Deck; it has no Versions`);
        }
        let cut = await cutDeckRealmVersion({
          realmURL,
          branchName: opts.branch ?? workspace?.branchName ?? 'main',
          authenticator: resolution.authenticator,
          ...(opts.package ? { packageRRI: opts.package } : {}),
          ...(opts.semver ? { version: opts.semver } : {}),
          ...(workspace ? { localDir: target } : {}),
        });
        if (opts.json) {
          console.log(JSON.stringify(cut, null, 2));
          return;
        }
        console.log(`${FG_GREEN}Cut${RESET} ${BOLD}${cut.versionRRI}${RESET}`);
        console.log(`${DIM}tree        ${cut.treeHash}${RESET}`);
        console.log(`${DIM}Checkpoint  ${cut.checkpointHash}${RESET}`);
      } catch (error) {
        bailout(error instanceof Error ? error.message : String(error));
      }
    });
}
