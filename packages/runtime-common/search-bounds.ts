import type { Query } from './query.ts';
import type { SearchEntryFieldset } from './search-entry.ts';

// ---------------------------------------------------------------------------
// Hard resource bounds for search — server-enforced limits a query cannot
// override, so no single userland search can exhaust the realm-server's single
// event loop. Card code is untrusted, re-editable input; these bounds hold
// whatever a card asks for.
//
// The bounds apply to the ITEM leg only (the live serialization + `loadLinks`
// path whose per-request cost they contain): a page-size ceiling, a
// realms-per-request ceiling for federated search, and a wall-clock budget. The
// prerendered-HTML leg is the cheap precomputed path and is left unbounded, as
// is the realm-server's own during-prerender traffic. When a request trips a
// ceiling, the error steers the author toward the HTML leg
// (`@context.searchResultsComponent`), which the ceilings don't apply to.
//
// Concurrency is not enforced here: it is a client-side throttle on the card
// `@context` surface (the trusted host app must not be throttled, and the
// host/card distinction only exists on the client). This module exports the
// shared cap constant the host reuses.
//
// All four bounds are exported consts, overridable via env for ops tuning.
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SEARCH_PAGE_SIZE = 100;
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

// Max results serialized/hydrated per item-leg request. An explicit page.size
// above this is rejected; an absent page is clamped to it (mandatory
// pagination) so a non-paginating caller gets the first page, not every row.
export const MAX_SEARCH_PAGE_SIZE = parsePositiveInt(
  env.MAX_SEARCH_PAGE_SIZE,
  DEFAULT_MAX_SEARCH_PAGE_SIZE,
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
let maxRealmsPerRequest = MAX_REALMS_PER_SEARCH_REQUEST;
let timeBudgetMs = SEARCH_TIME_BUDGET_MS;

export function setSearchBoundsForTests(overrides: {
  maxPageSize?: number;
  maxRealmsPerRequest?: number;
  timeBudgetMs?: number;
}): void {
  if (overrides.maxPageSize !== undefined) {
    maxPageSize = overrides.maxPageSize;
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

// Enforce mandatory pagination on an item-leg query. An explicit page.size over
// the max is rejected (the author asked for more than allowed); an absent page
// is clamped to the max so a non-paginating caller gets the first page rather
// than every row. Returns the (possibly clamped) query without mutating input.
export function applySearchPageBound(query: Query): Query {
  let page = query.page;
  if (page == null) {
    // No page at all: apply the mandatory cap so the result set is bounded.
    return { ...query, page: { size: maxPageSize } } as Query;
  }
  let size = Number((page as { size?: unknown }).size);
  if (!Number.isFinite(size) || size < 1) {
    // A page object with a missing / non-numeric / non-positive size can't
    // bound the result set — and would compile to `LIMIT undefined` / a
    // negative limit — so treat it like an absent page and clamp to the cap
    // rather than let it through unbounded.
    return { ...query, page: { ...page, size: maxPageSize } } as Query;
  }
  if (size > maxPageSize) {
    throw new SearchBoundError(
      400,
      `page.size ${size} exceeds the maximum of ${maxPageSize}; request a smaller page, or ${HTML_LEG_HINT}`,
    );
  }
  return query;
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
