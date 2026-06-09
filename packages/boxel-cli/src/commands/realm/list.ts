import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { BOLD, DIM, FG_CYAN, FG_RED, RESET } from '../../lib/colors.ts';

const MUTUALLY_EXCLUSIVE_FLAGS_ERROR =
  '--all-accessible and --hidden are mutually exclusive';

export interface RealmSummary {
  url: string;
  hidden: boolean;
}

export interface ListRealmsResult {
  realms: RealmSummary[];
  error?: string;
}

export interface ListRealmsOptions {
  allAccessible?: boolean;
  hidden?: boolean;
  profileManager?: ProfileManager;
}

interface ListCliOptions {
  json?: boolean;
  allAccessible?: boolean;
  hidden?: boolean;
}

/**
 * List realms accessible to the active profile.
 *
 * Calls `_realm-auth` to discover all realms the user can access, then
 * marks each as `hidden` based on whether it appears in the user's
 * `app.boxel.realms` Matrix account data (the UI realm list).
 *
 * Default mode shows only non-hidden realms; `--all-accessible` shows
 * everything; `--hidden` shows only hidden ones.
 */
export async function listRealms(
  options: ListRealmsOptions = {},
): Promise<ListRealmsResult> {
  if (options.allAccessible && options.hidden) {
    return { realms: [], error: MUTUALLY_EXCLUSIVE_FLAGS_ERROR };
  }

  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return { realms: [], error: NO_ACTIVE_PROFILE_ERROR };
  }

  let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');
  let response = await pm.authedRealmServerFetch(
    `${realmServerUrl}/_realm-auth`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    },
  );
  if (!response.ok) {
    let text = await response.text();
    return {
      realms: [],
      error: `Realm auth lookup failed: ${response.status} ${text}`,
    };
  }
  let tokens = (await response.json()) as Record<string, string>;
  let accessibleUrls = Object.keys(tokens).map(ensureTrailingSlash);

  let userRealms: string[];
  try {
    userRealms = await pm.getUserRealms();
  } catch (err) {
    return {
      realms: [],
      error: `Failed to load UI realm list: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  let userRealmsSet = new Set(userRealms.map(ensureTrailingSlash));

  let summaries: RealmSummary[] = accessibleUrls.map((url) => ({
    url,
    hidden: !userRealmsSet.has(url),
  }));

  if (options.allAccessible) {
    // no filter
  } else if (options.hidden) {
    summaries = summaries.filter((r) => r.hidden);
  } else {
    summaries = summaries.filter((r) => !r.hidden);
  }

  summaries.sort((a, b) => a.url.localeCompare(b.url));
  return { realms: summaries };
}

export function registerListCommand(realm: Command): void {
  realm
    .command('list')
    .alias('ls')
    .description('List realms accessible to the active profile')
    .option('--json', 'Output JSON')
    .option(
      '--all-accessible',
      'Show all accessible realms, including hidden ones',
    )
    .option('--hidden', "Show only realms not in the user's UI realm list")
    .action(async (opts: ListCliOptions) => {
      let result: ListRealmsResult;
      try {
        result = await listRealms({
          allAccessible: opts.allAccessible,
          hidden: opts.hidden,
        });
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        if (result.error) process.exit(1);
        return;
      }

      if (result.error) {
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
        process.exit(1);
      }

      if (result.realms.length === 0) {
        console.log(`${DIM}No realms found.${RESET}`);
        return;
      }

      console.log(`${BOLD}${result.realms.length} realm(s):${RESET}`);
      for (let r of result.realms) {
        let tag = r.hidden ? ` ${DIM}(hidden)${RESET}` : '';
        console.log(`  ${FG_CYAN}${r.url}${RESET}${tag}`);
      }
    });
}
