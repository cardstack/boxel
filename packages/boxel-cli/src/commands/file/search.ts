import type { Command } from 'commander';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager';
import { FG_RED, DIM, RESET } from '../../lib/colors';

export interface SearchResult {
  ok: boolean;
  status?: number;
  data?: Record<string, unknown>[];
  error?: string;
}

export interface SearchCommandOptions {
  profileManager?: ProfileManager;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Search a realm using the `_search` endpoint with a JSON query.
 *
 * Sends a QUERY request with the provided query object serialized as JSON.
 * Uses the per-realm JWT via `ProfileManager.authedRealmFetch`.
 */
export async function search(
  realmUrl: string,
  query: Record<string, unknown>,
  options?: SearchCommandOptions,
): Promise<SearchResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    throw new Error(
      'No active profile. Run `boxel profile add` to create one.',
    );
  }

  let searchUrl = `${ensureTrailingSlash(realmUrl)}_search`;

  try {
    let response = await pm.authedRealmFetch(searchUrl, {
      method: 'QUERY',
      headers: {
        Accept: 'application/vnd.card+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(query),
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
    return { ok: true, data: result.data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface SearchCliOptions {
  realm: string;
  query: string;
  json?: boolean;
}

export function registerSearchCommand(file: Command): void {
  file
    .command('search')
    .description('Search a realm using a JSON query')
    .requiredOption('--realm <realm-url>', 'The realm URL to search')
    .requiredOption('--query <json>', 'JSON query object (as a string)')
    .option('--json', 'Output raw JSON response')
    .action(async (opts: SearchCliOptions) => {
      let query: Record<string, unknown>;
      try {
        let parsed = JSON.parse(opts.query);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
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
        console.log(JSON.stringify(result, null, 2));
      } else if (result.ok) {
        console.log(JSON.stringify(result.data ?? [], null, 2));
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
