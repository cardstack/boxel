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
//   - Page size — a client cap plus two server thresholds, because a request
//     that says nothing about paging and one that deliberately asks for a large
//     page are different acts. The card `@context` cap (MAX_SEARCH_PAGE_SIZE) is
//     enforced client-side, so a card gets a small page while the host can page
//     larger. Server-side, SERVER_MAX_SEARCH_PAGE_SIZE is the default a request
//     with no page is clamped to (mandatory pagination — a non-paginating caller
//     gets the first page, not every row), and SERVER_ABSOLUTE_MAX_PAGE_SIZE is
//     the ceiling an explicit page is rejected above. A caller between the two
//     has opted in: it named a size, so it is asking for that cost knowingly,
//     and the result set is still bounded. The true match count rides
//     `meta.page.total` either way, so a caller can paginate instead.
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
const DEFAULT_SERVER_ABSOLUTE_MAX_PAGE_SIZE = 2_000;
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

// The default page a server-side item-leg request gets when it asks for no
// particular one, enforced regardless of caller (the trusted host and any card
// that skips the client cap included). Higher than the card `@context` cap — the
// host may legitimately page larger — and the reason a non-paginating caller
// gets a first page rather than every row. It is not the rejection threshold:
// a caller that names a larger size has opted into that cost, and is held to
// SERVER_ABSOLUTE_MAX_PAGE_SIZE instead.
export const SERVER_MAX_SEARCH_PAGE_SIZE = parsePositiveInt(
  env.SERVER_MAX_SEARCH_PAGE_SIZE,
  DEFAULT_SERVER_MAX_SEARCH_PAGE_SIZE,
  MIN_PAGE_SIZE,
);

// The size no item-leg request may exceed, however deliberately it asks. This
// is the bound that keeps the server from assembling and serializing an
// unbounded page; everything between it and the default above is opt-in
// territory, reachable only by naming a size. Kept at or above the default, so
// an env override that inverts the two cannot make the default itself
// rejectable.
export const SERVER_ABSOLUTE_MAX_PAGE_SIZE = Math.max(
  SERVER_MAX_SEARCH_PAGE_SIZE,
  parsePositiveInt(
    env.SERVER_ABSOLUTE_MAX_PAGE_SIZE,
    DEFAULT_SERVER_ABSOLUTE_MAX_PAGE_SIZE,
    MIN_PAGE_SIZE,
  ),
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
let serverAbsoluteMaxPageSize = SERVER_ABSOLUTE_MAX_PAGE_SIZE;
let maxRealmsPerRequest = MAX_REALMS_PER_SEARCH_REQUEST;
let timeBudgetMs = SEARCH_TIME_BUDGET_MS;

export function setSearchBoundsForTests(overrides: {
  maxPageSize?: number;
  serverMaxPageSize?: number;
  serverAbsoluteMaxPageSize?: number;
  maxRealmsPerRequest?: number;
  timeBudgetMs?: number;
}): void {
  if (overrides.maxPageSize !== undefined) {
    maxPageSize = overrides.maxPageSize;
  }
  if (overrides.serverMaxPageSize !== undefined) {
    serverMaxPageSize = overrides.serverMaxPageSize;
  }
  if (overrides.serverAbsoluteMaxPageSize !== undefined) {
    serverAbsoluteMaxPageSize = overrides.serverAbsoluteMaxPageSize;
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
  serverAbsoluteMaxPageSize = SERVER_ABSOLUTE_MAX_PAGE_SIZE;
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

// Enforce mandatory pagination on an item-leg query. `dflt` is the size a
// query that names none is clamped to, so a non-paginating caller gets the
// first page rather than every row. `max` is the size an explicit page is
// rejected above; between the two, a caller that named a size gets it, having
// asked for that cost knowingly. Passing the same number for both collapses to
// one threshold, which is what the card `@context` cap wants. Returns the
// (possibly clamped) query without mutating input.
function boundPageSize(query: Query, dflt: number, max: number): Query {
  let page = query.page;
  if (page == null) {
    // No page at all: apply the mandatory default so the result set is bounded.
    return { ...query, page: { size: dflt } } as Query;
  }
  let size = Number((page as { size?: unknown }).size);
  if (!Number.isFinite(size) || size < 1) {
    // A page object with a missing / non-numeric / non-positive size can't
    // bound the result set — and would compile to `LIMIT undefined` / a
    // negative limit — so treat it like an absent page and clamp to the
    // default rather than let it through unbounded.
    return { ...query, page: { ...page, size: dflt } } as Query;
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
// item-leg searches (see host StoreService). One threshold, not two: untrusted
// card code doesn't get to opt into a larger page by asking for one.
export function applySearchPageBound(query: Query): Query {
  return boundPageSize(query, maxPageSize, maxPageSize);
}

// The server-side page bounds, enforced on every item-leg request the server
// handles regardless of caller. A request naming no page is clamped to the
// default (higher than the card `@context` cap — the host may legitimately page
// larger); one naming a size is honored up to the absolute maximum and rejected
// above it. The pair is what lets a caller with a reason — a query-backed field
// declaring the page it needs — ask for more than the default while still
// leaving the server's own work bounded.
export function applyServerSearchPageBound(query: Query): Query {
  return boundPageSize(query, serverMaxPageSize, serverAbsoluteMaxPageSize);
}

// The bounds for a query-backed relationship's own expansion pass, which the
// indexer runs in-process rather than over HTTP. Neither endpoint bound reaches
// that pass, so it applies the same pair here and the field is bounded the same
// way wherever it resolves — in the indexer, through a peer realm's `_search`,
// or on the client's live refresh.
//
// A field that declares no page gets the default, which is the ceiling the
// author is told about and the one `isPartial` reports against. A field that
// declares one has opted into that size: it is honored, which is what makes the
// declared page a real lever rather than a suggestion the ceiling overrules.
//
// Where the endpoint rejects an over-maximum page, this clamps. A field's
// `page.size` is authored once and read on every index of every instance of
// that card, so rejecting it would make the card unindexable rather than fail
// the one request that asked for too much. Clamping is safe because the
// shortfall is reported: the true match count rides `meta.total` on the
// relationship, and `getRelationshipMembershipState` reads it back as
// `isPartial`.
export function applyQueryFieldPageBound(query: Query): Query {
  let page = query.page;
  let size = Number((page as { size?: unknown } | undefined)?.size);
  if (!Number.isFinite(size) || size < 1) {
    return { ...query, page: { ...(page ?? {}), size: serverMaxPageSize } };
  }
  if (size > serverAbsoluteMaxPageSize) {
    return {
      ...query,
      page: { ...(page ?? {}), size: serverAbsoluteMaxPageSize },
    };
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
