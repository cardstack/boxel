import type { Query } from './query.ts';
import type { SearchEntryFieldset } from './search-entry.ts';

// ---------------------------------------------------------------------------
// Hard resource bounds for search, so no single search can exhaust the
// realm-server's single event loop. They apply to the ITEM leg only — the live
// serialization + `loadLinks` path whose per-request cost they contain. The
// prerendered-HTML leg is the cheap precomputed path and is left unbounded, as
// is the realm-server's own during-prerender traffic. When a request trips a
// ceiling, the error steers the author toward the HTML leg
// (`@context.searchResultsComponent`), which the ceilings don't apply to.
//
// Where each bound lives follows one rule: the server can't tell a trusted-host
// request from untrusted card code, so a bound the host must be free to exceed
// is enforced client-side on the card `@context` surface, and a bound that must
// hold for every caller is enforced server-side.
//
//   - Page size — two ceilings. The card `@context` cap (MAX_SEARCH_PAGE_SIZE)
//     is enforced client-side, so a card gets a small page while the host can
//     page larger. The server ceiling (SERVER_MAX_SEARCH_PAGE_SIZE, higher) is
//     enforced server-side on every item-leg request — the host, and any card
//     that skips the client cap, included — so the result set the server
//     assembles and serializes is always bounded. The true match count still
//     rides `meta.page.total`, so a caller can paginate.
//   - Realms fan-out (MAX_REALMS_PER_SEARCH_REQUEST) and concurrency
//     (SEARCH_CONCURRENCY_CAP) — client-side only, on the card `@context`
//     surface: the host federates widely and runs its own searches freely.
//   - Time budget (SEARCH_TIME_BUDGET_MS) — server-side only: a wall-clock
//     cutoff of the server's own work can't live anywhere else.
//
// All bounds are exported consts, overridable via env for ops tuning.
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SEARCH_PAGE_SIZE = 100;
const DEFAULT_SERVER_MAX_SEARCH_PAGE_SIZE = 500;
const DEFAULT_MAX_REALMS_PER_SEARCH_REQUEST = 2;
const DEFAULT_SEARCH_TIME_BUDGET_MS = 30_000;
const DEFAULT_SEARCH_CONCURRENCY_CAP = 2;

const MIN_PAGE_SIZE = 1;
const MIN_REALMS = 1;
const MIN_TIME_BUDGET_MS = 1_000;
const MIN_CONCURRENCY = 1;

// Clamp an env override to a positive integer, falling back (also clamped) when
// the value is missing or non-numeric so a bad env var can't disable a bound.
function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
): number {
  let parsed = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) {
    return Math.max(min, fallback);
  }
  return Math.max(min, Math.floor(parsed));
}

let env: Record<string, string | undefined> =
  typeof process !== 'undefined' ? (process.env ?? {}) : {};

// The card `@context` page cap: max results a card-initiated item-leg search
// requests. Enforced client-side (see host StoreService). An explicit page.size
// above this is rejected; an absent page is clamped to it (mandatory
// pagination) so a non-paginating card gets the first page, not every row.
export const MAX_SEARCH_PAGE_SIZE = parsePositiveInt(
  env.MAX_SEARCH_PAGE_SIZE,
  DEFAULT_MAX_SEARCH_PAGE_SIZE,
  MIN_PAGE_SIZE,
);

// The server-side hard page ceiling, enforced on every item-leg request
// regardless of caller (the trusted host and any card that skips the client cap
// included). Higher than the card `@context` cap — the host may legitimately
// page larger — but no request may make the server assemble/serialize an
// unbounded page. Same shape as the card cap: an explicit page above it is
// rejected; an absent page is clamped to it (the true total rides
// `meta.page.total`, so a caller can still paginate).
export const SERVER_MAX_SEARCH_PAGE_SIZE = parsePositiveInt(
  env.SERVER_MAX_SEARCH_PAGE_SIZE,
  DEFAULT_SERVER_MAX_SEARCH_PAGE_SIZE,
  MIN_PAGE_SIZE,
);

// Max realms a single federated item-leg request may fan out to.
export const MAX_REALMS_PER_SEARCH_REQUEST = parsePositiveInt(
  env.MAX_REALMS_PER_SEARCH_REQUEST,
  DEFAULT_MAX_REALMS_PER_SEARCH_REQUEST,
  MIN_REALMS,
);

// Wall-clock budget for a single item-leg search. Over-budget searches are cut
// off rather than run to completion.
export const SEARCH_TIME_BUDGET_MS = parsePositiveInt(
  env.SEARCH_TIME_BUDGET_MS,
  DEFAULT_SEARCH_TIME_BUDGET_MS,
  MIN_TIME_BUDGET_MS,
);

// Max concurrent card-initiated item-leg searches. Enforced client-side on the
// `@context` surface (see host StoreService); exported here so the client and
// the shared contract agree on one number.
export const SEARCH_CONCURRENCY_CAP = parsePositiveInt(
  env.SEARCH_CONCURRENCY_CAP,
  DEFAULT_SEARCH_CONCURRENCY_CAP,
  MIN_CONCURRENCY,
);

// The effective values the enforcement functions read. They default to the
// exported consts (the ops-facing knobs); a test overrides them via
// `setSearchBoundsForTests` to exercise a bound without adding realms or
// waiting out the real time budget. Mirrors `setSearchTimingSinkForTests`.
let maxPageSize = MAX_SEARCH_PAGE_SIZE;
let serverMaxPageSize = SERVER_MAX_SEARCH_PAGE_SIZE;
let maxRealmsPerRequest = MAX_REALMS_PER_SEARCH_REQUEST;
let timeBudgetMs = SEARCH_TIME_BUDGET_MS;

export function setSearchBoundsForTests(overrides: {
  maxPageSize?: number;
  serverMaxPageSize?: number;
  maxRealmsPerRequest?: number;
  timeBudgetMs?: number;
}): void {
  if (overrides.maxPageSize !== undefined) {
    maxPageSize = overrides.maxPageSize;
  }
  if (overrides.serverMaxPageSize !== undefined) {
    serverMaxPageSize = overrides.serverMaxPageSize;
  }
  if (overrides.maxRealmsPerRequest !== undefined) {
    maxRealmsPerRequest = overrides.maxRealmsPerRequest;
  }
  if (overrides.timeBudgetMs !== undefined) {
    timeBudgetMs = overrides.timeBudgetMs;
  }
}

export function resetSearchBoundsForTests(): void {
  maxPageSize = MAX_SEARCH_PAGE_SIZE;
  serverMaxPageSize = SERVER_MAX_SEARCH_PAGE_SIZE;
  maxRealmsPerRequest = MAX_REALMS_PER_SEARCH_REQUEST;
  timeBudgetMs = SEARCH_TIME_BUDGET_MS;
}

// The item leg (`fields[entry]` includes "item" / "item.<field>") is the live
// serialization + `loadLinks` path — the one whose cost the bounds contain. The
// default/prerendered fieldset resolves to `kind: 'none'` (html-preferred, item
// only as a per-row fallback) and is exempt.
export function isItemLegSearch(fieldset: SearchEntryFieldset): boolean {
  return fieldset.item.kind !== 'none';
}

// The HTTP statuses a bound violation maps to. 408 for the time budget so a
// client reads it as "took too long — narrow the query / retry".
export type SearchBoundStatus = 400 | 408;

export class SearchBoundError extends Error {
  status: SearchBoundStatus;
  constructor(status: SearchBoundStatus, message: string) {
    super(message);
    this.status = status;
    this.name = 'SearchBoundError';
  }
}

// The bounds cap the item leg only, so a genuinely large or wide result set
// belongs on the prerendered-HTML leg (rendered lazily, never live-serialized).
// Every bound error points there so an author can switch rather than fight the
// cap.
const HTML_LEG_HINT =
  'for large or wide result sets, use prerendered HTML search results (@context.searchResultsComponent), which this cap does not apply to';

// Reject a federated item-leg request that fans out to more realms than the
// cap. It can't be clamped (we can't choose which realms to drop), so the
// author must narrow the `realms` list.
export function assertRealmsBound(realms: string[]): void {
  if (realms.length > maxRealmsPerRequest) {
    throw new SearchBoundError(
      400,
      `search spans ${realms.length} realms, exceeding the per-request limit of ${maxRealmsPerRequest}; narrow the "realms" list, or ${HTML_LEG_HINT}`,
    );
  }
}

// Enforce mandatory pagination on an item-leg query against `max`. An explicit
// page.size over `max` is rejected (the caller asked for more than allowed); an
// absent page is clamped to `max` so a non-paginating caller gets the first
// page rather than every row. Returns the (possibly clamped) query without
// mutating input.
function boundPageSize(query: Query, max: number): Query {
  let page = query.page;
  if (page == null) {
    // No page at all: apply the mandatory cap so the result set is bounded.
    return { ...query, page: { size: max } } as Query;
  }
  let size = Number((page as { size?: unknown }).size);
  if (!Number.isFinite(size) || size < 1) {
    // A page object with a missing / non-numeric / non-positive size can't
    // bound the result set — and would compile to `LIMIT undefined` / a
    // negative limit — so treat it like an absent page and clamp to the cap
    // rather than let it through unbounded.
    return { ...query, page: { ...page, size: max } } as Query;
  }
  if (size > max) {
    throw new SearchBoundError(
      400,
      `page.size ${size} exceeds the maximum of ${max}; request a smaller page, or ${HTML_LEG_HINT}`,
    );
  }
  return query;
}

// The card `@context` page cap, enforced client-side on card-initiated
// item-leg searches (see host StoreService).
export function applySearchPageBound(query: Query): Query {
  return boundPageSize(query, maxPageSize);
}

// The server-side hard page ceiling, enforced on every item-leg request the
// server handles regardless of caller. Higher than the card `@context` cap; the
// backstop that bounds what the server assembles/serializes even when the
// client cap was skipped.
export function applyServerSearchPageBound(query: Query): Query {
  return boundPageSize(query, serverMaxPageSize);
}

// Run an item-leg search under the wall-clock budget. The runner receives an
// AbortSignal it threads into `loadLinks` so the expensive async work stops
// promptly on timeout; the Promise.race guarantees the 408 return even though
// the federated fan-out swallows the abort (it treats an aborted realm as a
// failed realm). The abandoned runner promise gets a no-op catch so its late
// abort rejection isn't an unhandled rejection.
export async function runWithSearchTimeBudget<T>(
  run: (signal: AbortSignal) => Promise<T>,
  budgetMs: number = timeBudgetMs,
): Promise<T> {
  let controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new SearchBoundError(
          408,
          `search exceeded the ${Math.round(
            budgetMs / 1000,
          )}s request time limit and was cancelled; narrow the query, request a smaller page, or ${HTML_LEG_HINT}`,
        ),
      );
    }, budgetMs);
  });
  let running = run(controller.signal);
  running.catch(() => {});
  try {
    return await Promise.race([running, timedOut]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
