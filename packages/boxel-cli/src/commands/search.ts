import type { Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../lib/profile-manager.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { resolveRealmIdentifier } from '../lib/resolve-realm-identifier.ts';
import { resourceIdentity } from '@cardstack/runtime-common/resource-identity';
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

// `_federated-search` speaks the entry wire grammar: one query
// rooted on `entry`, where entry membership is addressed through
// `item.` (the card/file serialization). The type anchor is `item.on` and the
// field paths inside the filter operators carry the `item.` prefix. Callers
// here author ordinary card-rooted queries, so these helpers rewrite a query
// into the `item.`-addressed form the endpoint expects.
//
// This mirrors runtime-common's `searchEntryWireQueryFromQuery`, kept local
// because that module pulls the whole runtime-common index — and its
// `https://cardstack.com/base/*` imports — into boxel-cli's deliberately
// dependency-light graph.
const ITEM_PREFIX = 'item.';
const ITEM_ANCHOR = 'item.on';

// The filter operators whose value is an object keyed by field paths; their
// keys are the ones that take the `item.` prefix.
const FIELD_KEYED_OPERATORS = ['eq', 'contains', 'in', 'range'];

function toItemFilter(
  filter: Record<string, unknown>,
): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(filter)) {
    if (key === 'type' || key === 'on') {
      // both legacy spellings of the type anchor map to item.on
      out[ITEM_ANCHOR] = value;
    } else if (key === 'any' || key === 'every') {
      if (!Array.isArray(value)) {
        throw new Error(`filter.${key} must be an array`);
      }
      out[key] = value.map((node) =>
        toItemFilter(node as Record<string, unknown>),
      );
    } else if (key === 'not') {
      out.not = toItemFilter(value as Record<string, unknown>);
    } else if (FIELD_KEYED_OPERATORS.includes(key)) {
      if (typeof value !== 'object' || value == null || Array.isArray(value)) {
        throw new Error(`filter.${key} must be an object`);
      }
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(
          ([fieldPath, fieldValue]) => [
            `${ITEM_PREFIX}${fieldPath}`,
            fieldValue,
          ],
        ),
      );
    } else if (key === 'matches') {
      // full-text match over the whole document — no field path to address
      out.matches = value;
    } else {
      throw new Error(
        `cannot translate filter member "${key}" to an entry query — the type anchor is "on"/"type" and field paths live under the ${FIELD_KEYED_OPERATORS.join('/')} operators`,
      );
    }
  }
  return out;
}

function toItemSort(entry: Record<string, unknown>): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(entry)) {
    if (key === 'by') {
      if (typeof value !== 'string') {
        throw new Error('sort entry "by" must be a string');
      }
      out.by = `${ITEM_PREFIX}${value}`;
    } else if (key === 'on') {
      out[ITEM_ANCHOR] = value;
    } else if (key === 'direction') {
      out.direction = value;
    } else {
      throw new Error(`unknown sort member "${key}"`);
    }
  }
  return out;
}

interface SearchEntryRequestBody {
  realms?: string[];
  // boxel-cli never renders HTML, so it requests the data-only fieldset: each
  // entry carries only its full `item` serialization (no prerendered `html`).
  fields: { entry: ['item'] };
  filter?: Record<string, unknown>;
  sort?: Record<string, unknown>[];
  page?: unknown;
  cardUrls?: unknown;
  // Which row kinds to span: 'cards' | 'files' | 'all' (default 'all' server-
  // side). Pass 'cards' to restrict to card instances.
  scope?: unknown;
}

/**
 * Build an entry request body from a card-rooted query: the
 * `item.`-addressed filter/sort plus the data-only fieldset. Pass `realms` for
 * the federated `_federated-search`; omit it to query a single realm's own
 * `_search`.
 */
export function searchEntryRequestBody(
  query: Record<string, unknown>,
  realms?: string[],
): SearchEntryRequestBody {
  let body: SearchEntryRequestBody = {
    fields: { entry: ['item'] },
  };
  if (realms !== undefined) {
    body.realms = realms;
  }
  if (query.filter !== undefined) {
    if (
      typeof query.filter !== 'object' ||
      query.filter == null ||
      Array.isArray(query.filter)
    ) {
      throw new Error('filter must be an object');
    }
    body.filter = toItemFilter(query.filter as Record<string, unknown>);
  }
  if (query.sort !== undefined) {
    if (!Array.isArray(query.sort)) {
      throw new Error('sort must be an array');
    }
    body.sort = query.sort.map((entry) =>
      toItemSort(entry as Record<string, unknown>),
    );
  }
  if (query.page !== undefined) {
    body.page = query.page;
  }
  if (query.cardUrls !== undefined) {
    body.cardUrls = query.cardUrls;
  }
  if (query.scope !== undefined) {
    body.scope = query.scope;
  }
  return body;
}

// A data-only entry document, narrowed to the shape this client reads:
// each entry links its serialization through `item`, and the `card`/`file-meta`
// resource itself travels in `included`. A structural local type rather than
// runtime-common's `EntryCollectionDocument` — that one transitively
// pulls the index's `https://cardstack.com/base/*` imports, which don't resolve
// in a plain Node CLI (the same boundary the query helpers above note).
interface SearchEntryDoc {
  data?: {
    relationships?: {
      item?: { data?: { type: string; id: string } };
    };
  }[];
  included?: { type: string; id: string }[];
}

/**
 * Flatten a data-only entry document into the `item` serializations, in
 * result order — the same `card`/`file-meta` resources the legacy endpoint
 * returned as its top-level `data`. Each entry points at its serialization in
 * `included`; resolve and collect them.
 */
export function itemsFromSearchEntryDoc(
  doc: SearchEntryDoc,
): Record<string, unknown>[] {
  let byIdentity = new Map<string, Record<string, unknown>>();
  for (let resource of doc.included ?? []) {
    if (resource.type === 'card' || resource.type === 'file-meta') {
      byIdentity.set(
        resourceIdentity(resource.type, resource.id),
        resource as Record<string, unknown>,
      );
    }
  }
  let items: Record<string, unknown>[] = [];
  for (let entry of doc.data ?? []) {
    let ref = entry.relationships?.item?.data;
    if (!ref) {
      continue;
    }
    let item = byIdentity.get(resourceIdentity(ref.type, ref.id));
    if (item) {
      items.push(item);
    }
  }
  return items;
}

/**
 * Federated search across one or more realms via the `_federated-search`
 * server endpoint.
 *
 * Sends the entry-rooted query as a QUERY request requesting the
 * data-only fieldset (`fields[entry]=item`), and returns the `item`
 * serializations the endpoint links in `included` — the `card`/`file-meta`
 * resources callers consume. Uses the server JWT via
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

  let realms: string[] = [];
  for (let realm of Array.isArray(realmUrls) ? realmUrls : [realmUrls]) {
    let resolved = resolveRealmIdentifier(realm, { profileManager: pm });
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
    realms.push(ensureTrailingSlash(resolved.url));
  }

  let body: SearchEntryRequestBody;
  try {
    body = searchEntryRequestBody(query, realms);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    let response = await pm.authedRealmServerFetch(searchUrl, {
      method: 'QUERY',
      headers: {
        Accept: 'application/vnd.card+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let responseBody = await response.text();
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}: ${responseBody.slice(0, 300)}`,
      };
    }

    let result = (await response.json()) as SearchEntryDoc;
    return {
      ok: true,
      status: response.status,
      data: itemsFromSearchEntryDoc(result),
    };
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
      }

      if (!result.ok) {
        process.exit(1);
      }
    });
}
