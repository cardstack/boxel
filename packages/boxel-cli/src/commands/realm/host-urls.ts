import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  listHostURLs,
  setCanonicalHostURL,
  type HostURLList,
} from '@cardstack/runtime-common/realm-operations';
import {
  buildHostURLClient,
  exitWithHostURLError,
  findHostURL,
  type HostURLAuthOptions,
} from '../../lib/host-urls.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { cliLog } from '../../lib/cli-log.ts';
import { DIM, FG_CYAN, RESET } from '../../lib/colors.ts';

export interface HostURLsOptions extends HostURLAuthOptions {
  /** A host URL of the realm to mark canonical before the list. */
  setCanonical?: string;
}

/**
 * List the host URLs of a realm. With `setCanonical`, first mark that host
 * URL canonical.
 */
export async function realmHostURLs(
  realmURL: string,
  options: HostURLsOptions = {},
): Promise<HostURLList> {
  let normalizedRealm = ensureTrailingSlash(realmURL);
  let client = buildHostURLClient(normalizedRealm, options);
  let list = await listHostURLs(client, { realmURL: normalizedRealm });
  if (options.setCanonical === undefined) {
    return list;
  }
  let match = findHostURL(list.hostURLs, options.setCanonical);
  if (!match) {
    throw new Error(`The realm is not mounted at ${options.setCanonical}`);
  }
  if (!match.isCanonical) {
    await setCanonicalHostURL(client, { id: match.id });
    list = await listHostURLs(client, { realmURL: normalizedRealm });
  }
  return list;
}

// The list as lines of text: one line for each host URL, with `*` before the
// canonical one, then the Boxel Space URL.
export function formatHostURLList(list: HostURLList): string[] {
  let lines: string[] = [];
  if (list.hostURLs.length === 0) {
    lines.push('The realm is not mounted at a host URL.');
  } else {
    let width = Math.max(...list.hostURLs.map(({ url }) => url.length));
    for (let { url, kind, isCanonical } of list.hostURLs) {
      lines.push(
        `${isCanonical ? '*' : ' '} ${FG_CYAN}${url.padEnd(width)}${RESET}  ${kind}`,
      );
    }
    lines.push(`${DIM}* canonical${RESET}`);
  }
  if (list.boxelSpaceURL) {
    lines.push(`Boxel Space URL: ${list.boxelSpaceURL}`);
  }
  return lines;
}

interface HostURLsCliOptions {
  setCanonical?: string;
  json?: boolean;
  realmSecretSeed?: boolean;
  asUser?: string;
}

export function registerHostURLsCommand(realm: Command): void {
  realm
    .command('host-urls')
    .description(
      'List the host URLs a realm is mounted at, and the Boxel Space URL it can be mounted at. Use --set-canonical to mark one canonical',
    )
    .argument('<realm-url>', 'URL of the realm')
    .option(
      '--set-canonical <host-url>',
      'Mark this host URL of the realm canonical before the list',
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
    .action(async (realmURL: string, opts: HostURLsCliOptions) => {
      let json = opts.json === true;
      try {
        let realmSecretSeed = await resolveRealmSecretSeed(
          opts.realmSecretSeed === true,
        );
        let list = await realmHostURLs(realmURL, {
          setCanonical: opts.setCanonical,
          realmSecretSeed,
          asUser: opts.asUser,
        });
        if (json) {
          cliLog.output(JSON.stringify(list, null, 2));
        } else {
          for (let line of formatHostURLList(list)) {
            console.log(line);
          }
        }
      } catch (err) {
        exitWithHostURLError(err, json);
      }
    });
}
