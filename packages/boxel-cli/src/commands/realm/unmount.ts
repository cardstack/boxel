import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  listHostURLs,
  unmountHostURL,
} from '@cardstack/runtime-common/realm-operations';
import {
  buildHostURLClient,
  exitWithHostURLError,
  findHostURL,
  type HostURLAuthOptions,
} from '../../lib/host-urls.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { cliLog } from '../../lib/cli-log.ts';
import { FG_CYAN, FG_GREEN, RESET } from '../../lib/colors.ts';

export interface UnmountOptions extends HostURLAuthOptions {
  /** Succeed when the realm is not mounted at the host URL. */
  tolerateMissing?: boolean;
}

export interface UnmountResult {
  realmURL: string;
  url: string;
  unmounted: boolean;
  notFound?: boolean;
}

/**
 * Unmount a realm from a host URL. The server removes a host URL by its id,
 * so the command lists the realm's host URLs to find the id for `hostURL`.
 */
export async function unmountRealm(
  realmURL: string,
  hostURL: string,
  options: UnmountOptions = {},
): Promise<UnmountResult> {
  let normalizedRealm = ensureTrailingSlash(realmURL);
  let client = buildHostURLClient(normalizedRealm, options);
  let { hostURLs } = await listHostURLs(client, { realmURL: normalizedRealm });
  let match = findHostURL(hostURLs, hostURL);
  if (!match) {
    if (options.tolerateMissing) {
      return {
        realmURL: normalizedRealm,
        url: hostURL,
        unmounted: false,
        notFound: true,
      };
    }
    throw new Error(`The realm is not mounted at ${hostURL}`);
  }
  await unmountHostURL(client, { id: match.id });
  return { realmURL: normalizedRealm, url: match.url, unmounted: true };
}

interface UnmountCliOptions {
  tolerateMissing?: boolean;
  json?: boolean;
  realmSecretSeed?: boolean;
  asUser?: string;
}

export function registerUnmountCommand(realm: Command): void {
  realm
    .command('unmount')
    .description(
      'Unmount a realm from a host URL. Mark another host URL canonical before you unmount the canonical one',
    )
    .argument('<realm-url>', 'URL of the realm')
    .argument('<host-url>', 'The host URL to unmount the realm from')
    .option(
      '--tolerate-missing',
      'Exit successfully when the realm is not mounted at the host URL',
    )
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT for --as-user locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED; names the paired Matrix server from MATRIX_SERVER_NAME)',
    )
    .option(
      '--as-user <matrix-id>',
      'Matrix id of a realm administrator to authorize as in seed mode (defaults to the user derived from the realm URL)',
    )
    .option('--json', 'Output the result as JSON')
    .action(
      async (realmURL: string, hostURL: string, opts: UnmountCliOptions) => {
        let json = opts.json === true;
        try {
          let realmSecretSeed = await resolveRealmSecretSeed(
            opts.realmSecretSeed === true,
          );
          let result = await unmountRealm(realmURL, hostURL, {
            tolerateMissing: opts.tolerateMissing === true,
            realmSecretSeed,
            asUser: opts.asUser,
          });
          if (json) {
            cliLog.output(JSON.stringify(result, null, 2));
          } else if (result.notFound) {
            console.log(`Not mounted: ${FG_CYAN}${result.url}${RESET}`);
          } else {
            console.log(
              `${FG_GREEN}Unmounted:${RESET} ${FG_CYAN}${result.url}${RESET}`,
            );
          }
        } catch (err) {
          exitWithHostURLError(err, json);
        }
      },
    );
}
