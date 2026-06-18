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
  query?: string;
  json?: boolean;
}

/**
 * Normalize the raw `--query` string into a query object.
 *
 * - Omitted/empty → `{}`, which the `_federated-search` endpoint treats as
 *   "every card in the realm(s)". This is the discovery / list-all path.
 * - An explicit empty `filter` (`{"filter":{}}`) is the same intent but the
 *   server rejects it with "cannot determine the type of filter", so we strip
 *   the empty filter and treat it as list-all too.
 *
 * Throws on invalid JSON or a non-object (so callers can surface a clear
 * message). Exported for unit testing.
 */
export function parseSearchQuery(
  raw: string | undefined,
): Record<string, unknown> {
  if (raw == null || raw.trim() === '') {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid JSON in --query: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `--query must be a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
    );
  }

  let query = parsed as Record<string, unknown>;
  let filter = query.filter;
  let emptyFilter =
    filter != null &&
    typeof filter === 'object' &&
    !Array.isArray(filter) &&
    Object.keys(filter as object).length === 0;
  if (emptyFilter) {
    let { filter: _omit, ...rest } = query;
    return rest;
  }

  return query;
}

// The realm's query parser rejects a filter it can't classify with this
// message. It doesn't say what a valid filter looks like, so we append a hint.
const UNCLASSIFIABLE_FILTER_MARKER = 'cannot determine the type of filter';

/**
 * Build an actionable hint for a failed search, or undefined if none applies.
 * Exported for unit testing.
 */
export function searchErrorHint(
  status: number | undefined,
  error: string | undefined,
): string | undefined {
  if (status === 400 && error && error.includes(UNCLASSIFIABLE_FILTER_MARKER)) {
    return [
      'The filter could not be classified. Valid shapes:',
      '  • all cards in the realm: omit --query (or pass {})',
      '  • by type:   {"filter":{"type":{"module":"<https card module url>","name":"<CardName>"}}}',
      '  • by field:  {"filter":{"on":{"module":"<url>","name":"<CardName>"},"eq":{"<field>":"<value>"}}}',
      '  • combine:   "any" (OR) / "every" (AND); also "contains", "range", "not"',
      'Field filters (eq/contains/range) require an "on" type scope, and "module" must be the full HTTPS URL of the card definition (no relative paths).',
    ].join('\n');
  }
  return undefined;
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
    .option(
      '--query <json>',
      'JSON query object (as a string). Omit to list every card in the realm(s).',
    )
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
        query = parseSearchQuery(opts.query);
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
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
        let hint = searchErrorHint(result.status, result.error);
        if (hint) {
          console.error(`${DIM}${hint}${RESET}`);
        }
      }

      if (!result.ok) {
        process.exit(1);
      }
    });
}
