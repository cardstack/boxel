import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  listHostURLs,
  mountHostURL,
  setCanonicalHostURL,
  type HostURL,
} from '@cardstack/runtime-common/realm-operations';
import {
  buildHostURLClient,
  ensureSiteNameClaimed,
  exitWithHostURLError,
  type HostURLAuthOptions,
} from '../../lib/host-urls.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { cliLog } from '../../lib/cli-log.ts';
import { FG_CYAN, FG_GREEN, RESET } from '../../lib/colors.ts';

export interface MountOptions extends HostURLAuthOptions {
  /** Mark the host URL canonical after the mount. */
  canonical?: boolean;
}

export interface MountResult {
  hostURL: HostURL;
  /** The site name that the command claimed for the realm before the mount. */
  claimedSiteName?: string;
}

/**
 * Mount a realm at a host URL.
 *
 * When `hostURL` is at a site name that has no claim for this realm, the
 * command claims the name first, as the host app's host URL manager does.
 * When the name is claimed already, the mount checks the claim: it accepts a
 * claim for this realm, and refuses a name that another user claimed.
 */
export async function mountRealm(
  realmURL: string,
  hostURL: string,
  options: MountOptions = {},
): Promise<MountResult> {
  let normalizedRealm = ensureTrailingSlash(realmURL);
  let client = buildHostURLClient(normalizedRealm, options);

  let claim = await ensureSiteNameClaimed(client, normalizedRealm, hostURL);
  if (claim.claimed && !claim.alreadyClaimed) {
    cliLog.info(`Claimed the site name ${claim.hostname} for the realm.`);
  }

  let mounted = await mountHostURL(client, {
    realmURL: normalizedRealm,
    url: hostURL,
  });
  if (options.canonical && !mounted.isCanonical) {
    mounted = await setCanonicalHostURL(client, { id: mounted.id });
  }
  return {
    hostURL: mounted,
    ...(claim.claimed && !claim.alreadyClaimed
      ? { claimedSiteName: claim.hostname }
      : {}),
  };
}

/**
 * The Boxel Space URL that a realm can be mounted at. The server makes it from
 * the realm's name and the Space of its owner.
 */
export async function boxelSpaceURLFor(
  realmURL: string,
  options: HostURLAuthOptions = {},
): Promise<string> {
  let normalizedRealm = ensureTrailingSlash(realmURL);
  let client = buildHostURLClient(normalizedRealm, options);
  let { boxelSpaceURL } = await listHostURLs(client, {
    realmURL: normalizedRealm,
  });
  if (!boxelSpaceURL) {
    throw new Error(
      'The realm has no Boxel Space URL. The realm has no owner, or the realm server has no Boxel Space domain.',
    );
  }
  return boxelSpaceURL;
}

export interface MountCliOptions {
  space?: boolean;
  canonical?: boolean;
  json?: boolean;
  realmSecretSeed?: boolean;
  asUser?: string;
}

/**
 * The host URL to mount at, from the arguments: `<host-url>` or `--space`.
 * Returns `{ error }` when the arguments give both or neither.
 */
export function mountTarget(
  hostURL: string | undefined,
  opts: Pick<MountCliOptions, 'space'>,
): { hostURL: string } | { space: true } | { error: string } {
  if (hostURL && opts.space) {
    return { error: 'Give a <host-url> or --space, not both.' };
  }
  if (opts.space) {
    return { space: true };
  }
  if (!hostURL) {
    return {
      error: 'Give a <host-url>, or --space to mount at the Boxel Space URL.',
    };
  }
  try {
    new URL(hostURL);
  } catch {
    return { error: `${hostURL} is not a URL.` };
  }
  return { hostURL };
}

export function registerMountCommand(realm: Command): void {
  realm
    .command('mount')
    .description(
      'Mount a realm at a host URL: a Boxel Space URL, a site name or a custom domain. Claims a site name first when the realm has no claim on it',
    )
    .argument('<realm-url>', 'URL of the realm to mount')
    .argument(
      '[host-url]',
      'The host URL to mount the realm at. Omit it and give --space to use the Boxel Space URL',
    )
    .option('--space', 'Mount the realm at its Boxel Space URL')
    .option('--canonical', 'Mark the host URL canonical after the mount')
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
      async (
        realmURL: string,
        hostURLArg: string | undefined,
        opts: MountCliOptions,
      ) => {
        let json = opts.json === true;
        let target = mountTarget(hostURLArg, opts);
        if ('error' in target) {
          exitWithHostURLError(new Error(target.error), json);
        }
        try {
          let realmSecretSeed = await resolveRealmSecretSeed(
            opts.realmSecretSeed === true,
          );
          let auth: HostURLAuthOptions = {
            realmSecretSeed,
            asUser: opts.asUser,
          };
          let hostURL =
            'hostURL' in target
              ? target.hostURL
              : await boxelSpaceURLFor(realmURL, auth);
          let result = await mountRealm(realmURL, hostURL, {
            ...auth,
            canonical: opts.canonical === true,
          });
          if (json) {
            cliLog.output(JSON.stringify(result, null, 2));
          } else {
            let { url, kind, isCanonical } = result.hostURL;
            console.log(
              `${FG_GREEN}Mounted:${RESET} ${FG_CYAN}${url}${RESET} (${kind}${
                isCanonical ? ', canonical' : ''
              })`,
            );
          }
        } catch (err) {
          exitWithHostURLError(err, json);
        }
      },
    );
}
