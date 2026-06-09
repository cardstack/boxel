import type { Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../lib/profile-manager.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { FG_RED, DIM, RESET } from '../lib/colors.ts';
import { cliLog } from '../lib/cli-log.ts';

export interface SearchResult {
  ok: boolean;
  status?: number;
  data?: Record<string, unknown>[];
  error?: string;
}

export interface SearchCommandOptions {
  profileManager?: ProfileManager;
}

/**
 * Federated search across one or more realms via the `_federated-search`
 * server endpoint.
 *
 * Sends a QUERY request with the provided query object and a `realms` array
 * merged into the request body. Uses the server JWT via
 * `ProfileManager.authedRealmServerFetch`.
 */
export async function search(
  realmUrls: string | string[],
  query: Record<string, unknown>,
  options?: SearchCommandOptions,
): Promise<SearchResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      ok: false,
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');
  let searchUrl = `${realmServerUrl}/_federated-search`;

  let realms = (Array.isArray(realmUrls) ? realmUrls : [realmUrls]).map(
    ensureTrailingSlash,
  );

  try {
    let response = await pm.authedRealmServerFetch(searchUrl, {
      method: 'QUERY',
      headers: {
        Accept: 'application/vnd.card+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ realms, ...query }),
    });

    if (!response.ok) {
      let body = await response.text();
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    let result = (await response.json()) as {
      data?: Record<string, unknown>[];
    };
    return { ok: true, status: response.status, data: result.data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface SearchCliOptions {
  realm: string[];
  query: string;
  json?: boolean;
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Federated search across realms using a JSON query')
    .requiredOption(
      '--realm <realm-url>',
      'Realm URL to search (repeatable)',
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .requiredOption('--query <json>', 'JSON query object (as a string)')
    .option('--json', 'Output raw JSON response')
    .action(async (opts: SearchCliOptions) => {
      if (opts.realm.length === 0) {
        console.error(
          `${FG_RED}Error:${RESET} At least one --realm is required`,
        );
        process.exit(1);
      }

      let query: Record<string, unknown>;
      try {
        let parsed = JSON.parse(opts.query);
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          console.error(
            `${FG_RED}Error:${RESET} --query must be a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
          );
          process.exit(1);
        }
        query = parsed as Record<string, unknown>;
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} Invalid JSON in --query: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
        return; // unreachable, but helps TS
      }

      let result: SearchResult;
      try {
        result = await search(opts.realm, query);
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
        return;
      }

      if (opts.json) {
        cliLog.output(JSON.stringify(result, null, 2));
      } else if (result.ok) {
        cliLog.output(JSON.stringify(result.data ?? [], null, 2));
      } else {
        console.error(
          `${DIM}Status:${RESET} ${result.status ?? '(no status)'}`,
        );
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
      }

      if (!result.ok) {
        process.exit(1);
      }
    });
}
