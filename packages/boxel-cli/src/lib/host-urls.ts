import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import type { RealmClient } from '@cardstack/runtime-common/realm-client';
import {
  checkDomainAvailability,
  claimSiteName,
  fetchClaimedSiteName,
  RealmOperationError,
  type HostURL,
} from '@cardstack/runtime-common/realm-operations';
import { buildCliRealmClient } from './realm-client.ts';
import { getProfileManager, type ProfileManager } from './profile-manager.ts';
import {
  deriveOwnerUserId,
  deriveRealmServerUrl,
  resolveMatrixServerName,
} from './seed-auth.ts';
import { describeFetchError } from './describe-fetch-error.ts';
import { cliLog } from './cli-log.ts';
import { FG_RED, RESET } from './colors.ts';

// Shared parts of the commands that manage the host URLs of a realm:
// `realm mount`, `realm unmount` and `realm host-urls`.

export interface HostURLAuthOptions {
  profileManager?: ProfileManager;
  /** Seed-mode admin auth. Mints a realm-server token for `asUser`. */
  realmSecretSeed?: string;
  /**
   * The Matrix id for the seed-minted server token. This user must administer
   * the realm. The default is the user that the path of the realm URL names,
   * on the paired Matrix server.
   */
  asUser?: string;
  /**
   * The name of the Matrix server paired with the realm server, for seed
   * mode. Read from `MATRIX_SERVER_NAME` when absent.
   */
  matrixServerName?: string;
}

// The client for the host URL endpoints. Seed mode mints a token for the
// realm's server. Otherwise the active profile signs the requests.
export function buildHostURLClient(
  realmURL: string,
  options: HostURLAuthOptions = {},
): RealmClient {
  if (options.realmSecretSeed) {
    let asUser =
      options.asUser ??
      deriveOwnerUserId(
        realmURL,
        resolveMatrixServerName(options.matrixServerName),
      );
    return buildCliRealmClient({
      realmSecretSeed: options.realmSecretSeed,
      realmServerURL: deriveRealmServerUrl(realmURL),
      asUser,
      matrixServerName: options.matrixServerName,
    });
  }
  return buildCliRealmClient(options.profileManager ?? getProfileManager());
}

// The host and path of a URL, in the form that the realm server compares
// them: a lowercase host, no default port, and a path with a trailing slash.
// The protocol is not part of it. The server lists host URLs with its own
// protocol, so `https://` and `http://` give the same address.
export function hostURLAddress(url: string): string {
  let parsed = new URL(url);
  let host = parsed.host.toLowerCase().replace(/\.(?=:|$)/, '');
  return `${host}${ensureTrailingSlash(parsed.pathname)}`;
}

// The host URL in `hostURLs` at the same address as `url`.
export function findHostURL(
  hostURLs: HostURL[],
  url: string,
): HostURL | undefined {
  let address = hostURLAddress(url);
  return hostURLs.find((hostURL) => hostURLAddress(hostURL.url) === address);
}

// The hostname of the site name that `url` is at, in the form the server
// stores claims in. Undefined when `url` is not at a site name.
//
// A site name is at the root of a one-label subdomain of the site domain. The
// CLI does not know the site domain, so it asks the server for the hostname
// that the first label of `url` gives on that domain. When that hostname is
// the host of `url`, `url` is at a site name.
export async function siteNameHostname(
  client: RealmClient,
  url: string,
): Promise<string | undefined> {
  let parsed = new URL(url);
  if (parsed.pathname !== '/') {
    return undefined;
  }
  let hostname = parsed.hostname.toLowerCase();
  let host = parsed.host.toLowerCase();
  let [subdomain, ...rest] = hostname.split('.');
  if (!subdomain || rest.length === 0) {
    return undefined;
  }
  let availability;
  try {
    availability = await checkDomainAvailability(client, { subdomain });
  } catch (error) {
    // A server without a site domain refuses the check. Then no URL is at a
    // site name, so the mount continues without a claim.
    if (error instanceof RealmOperationError) {
      return undefined;
    }
    throw error;
  }
  let siteHostname = availability.hostname?.toLowerCase();
  if (siteHostname === host || siteHostname === hostname) {
    return availability.hostname;
  }
  return undefined;
}

export type SiteNameClaim =
  | { claimed: false }
  | { claimed: true; hostname: string; alreadyClaimed: boolean };

// Makes sure the site name that `url` is at is claimed for the realm, before a
// mount there. Claims the name when the caller has no claim on it for the
// realm. When the name is claimed already, the mount decides whether the realm
// may use it. Returns `{ claimed: false }` when `url` is not at a site name.
export async function ensureSiteNameClaimed(
  client: RealmClient,
  realmURL: string,
  url: string,
): Promise<SiteNameClaim> {
  let hostname = await siteNameHostname(client, url);
  if (!hostname) {
    return { claimed: false };
  }
  let existing = await fetchClaimedSiteName(client, { realmURL });
  if (existing?.hostname.toLowerCase() === hostname.toLowerCase()) {
    return { claimed: true, hostname, alreadyClaimed: true };
  }
  try {
    let claim = await claimSiteName(client, { realmURL, hostname });
    return { claimed: true, hostname: claim.hostname, alreadyClaimed: false };
  } catch (error) {
    // The claim lookup above finds only the caller's own claims. A name that
    // another administrator claimed for this realm is refused here, but the
    // mount accepts it. So a claim refused because the name is claimed
    // doesn't stop the mount: the mount checks the claim, and refuses a name
    // that another user claimed. Any other refusal, such as a name that isn't
    // valid, stops here with its own reason.
    if (isAlreadyClaimedRefusal(error)) {
      return { claimed: true, hostname, alreadyClaimed: true };
    }
    throw error;
  }
}

const ALREADY_CLAIMED = 'Hostname is already claimed';

function isAlreadyClaimedRefusal(error: unknown): boolean {
  return (
    error instanceof RealmOperationError &&
    error.status === 422 &&
    error.message.includes(ALREADY_CLAIMED)
  );
}

export interface HostURLErrorReport {
  error: string;
  status?: number;
  retryAfter?: string;
}

// What a failed host URL command reports: the reason the server gives, its
// status, and its `Retry-After`, when it sent one.
export function describeHostURLError(error: unknown): HostURLErrorReport {
  if (error instanceof RealmOperationError) {
    return {
      error: error.message,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.retryAfter !== undefined
        ? { retryAfter: error.retryAfter }
        : {}),
    };
  }
  if (error instanceof TypeError) {
    return {
      error: `Failed to reach realm server: ${describeFetchError(error)}`,
    };
  }
  return { error: error instanceof Error ? error.message : String(error) };
}

// Prints a failed host URL command's error and exits with status 1. With
// `--json`, prints `{ error, status, retryAfter }` on stdout.
export function exitWithHostURLError(error: unknown, json: boolean): never {
  let report = describeHostURLError(error);
  if (json) {
    cliLog.output(JSON.stringify(report, null, 2));
  } else {
    console.error(`${FG_RED}Error:${RESET} ${report.error}`);
    if (report.retryAfter !== undefined) {
      console.error(`Try again after ${report.retryAfter} seconds.`);
    }
  }
  process.exit(1);
}
