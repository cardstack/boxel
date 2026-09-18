import { logger } from './log.ts';
import type { Query } from './query.ts';
import type { SearchEntryFieldset } from './search-entry.ts';

const log = logger('search-bounds');

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
//     the ceiling an explicit page is clamped to above. A caller between the two
//     has opted in: it named a size, so it is asking for that cost knowingly,
//     and the result set is still bounded. The card cap rejects instead of
//     clamping, because there the author who wrote the number is the one who
//     sees the error. The true match count rides `meta.page.total` either way,
//     so a caller can paginate — and can see that it got a short page.
//   - Realms fan-out (MAX_REALMS_PER_SEARCH_REQUEST) — client-side only, on the
//     card `@context` surface: the host federates widely.
//   - Concurrency (SEARCH_CONCURRENCY_CAP) — client-side only, and a ceiling on
//     a store service rather than on a caller: the card `@context` surface and
//     query-field resolution share one, so a page's whole search fan-out is
//     bounded however it is spread across cards. Each store service holds its
//     own, so this is not a single number across a tab. The host runs its own
//     searches freely.
//   - Time budget (SEARCH_TIME_BUDGET_MS) — server-side only: a wall-clock
//     cutoff of the server's own work can't live anywhere else.
//   - In-flight ceiling (SERVER_MAX_IN_FLIGHT_SEARCHES, with
//     SEARCH_ADMISSION_WAIT_MS) — server-side only, and unlike the others a
//     bound on the process rather than on a request: how many searches it runs
//     at once, across every caller. Each in-flight search holds tens of MB of
//     heap while its result set is assembled, so this is the number that
//     decides whether a burst exhausts the heap. Enforced at admission in the
//     realm-server's request middleware; arrivals above the ceiling wait
//     briefly for a slot and are then shed with 429 + Retry-After.
//   - Assembled link resources (SERVER_MAX_ASSEMBLED_LINK_RESOURCES) —
//     server-side only, and the one bound whose polarity is inverted: every
//     `loadLinks` assembly is held to it unless a caller opts out, because a
//     closure is assembled by more routes than search, and a bound that must be
//     remembered per route is a bound a new route forgets. Counted in resources
//     rather than in bytes because the resource is what the walk schedules, so
//     the count bounds the batched reads as well as the assembly; and the cost
//     it stands in for is the event-loop CPU of cloning, rewriting and
//     serializing each one, which scales with the count. Counted in resources
//     rather than in hops because distance does not track expense: a card
//     carrying dozens of relationships is dozens of resources one hop out.
//
// All bounds are exported consts, overridable via env for ops tuning.
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SEARCH_PAGE_SIZE = 100;
const DEFAULT_SERVER_MAX_SEARCH_PAGE_SIZE = 500;
const DEFAULT_SERVER_ABSOLUTE_MAX_PAGE_SIZE = 2_000;
const DEFAULT_MAX_REALMS_PER_SEARCH_REQUEST = 2;
const DEFAULT_SEARCH_TIME_BUDGET_MS = 30_000;
const DEFAULT_SEARCH_CONCURRENCY_CAP = 2;
const DEFAULT_SERVER_MAX_IN_FLIGHT_SEARCHES = 30;
const DEFAULT_SEARCH_ADMISSION_WAIT_MS = 1_000;
const DEFAULT_SERVER_MAX_ASSEMBLED_LINK_RESOURCES = 1_000;

const MIN_PAGE_SIZE = 1;
const MIN_REALMS = 1;
const MIN_TIME_BUDGET_MS = 1_000;
const MIN_CONCURRENCY = 1;
const MIN_ASSEMBLED_LINK_RESOURCES = 1;

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
const REQUESTED_SERVER_ABSOLUTE_MAX_PAGE_SIZE = parsePositiveInt(
  env.SERVER_ABSOLUTE_MAX_PAGE_SIZE,
  DEFAULT_SERVER_ABSOLUTE_MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
);
export const SERVER_ABSOLUTE_MAX_PAGE_SIZE = Math.max(
  SERVER_MAX_SEARCH_PAGE_SIZE,
  REQUESTED_SERVER_ABSOLUTE_MAX_PAGE_SIZE,
);
// Say so when the floor discarded the operator's number. Tightening the maximum
// below the default is a reasonable thing to reach for during an incident, and
// it does nothing on its own — SERVER_MAX_SEARCH_PAGE_SIZE has to come down too
// — so the one configuration where this knob appears not to work is the one
// where it is most likely to be used.
if (REQUESTED_SERVER_ABSOLUTE_MAX_PAGE_SIZE < SERVER_MAX_SEARCH_PAGE_SIZE) {
  log.warn(
    `SERVER_ABSOLUTE_MAX_PAGE_SIZE=${REQUESTED_SERVER_ABSOLUTE_MAX_PAGE_SIZE} is below SERVER_MAX_SEARCH_PAGE_SIZE=${SERVER_MAX_SEARCH_PAGE_SIZE}, so it was raised to ${SERVER_MAX_SEARCH_PAGE_SIZE}; lower SERVER_MAX_SEARCH_PAGE_SIZE as well to tighten the ceiling below the default page.`,
  );
}

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

// Max item-leg searches one store service may have in flight at once, across
// the card `@context` surface and query-field resolution together. Enforced client-side
// (see host StoreService); exported here so the client and the shared contract
// agree on one number. Excess searches queue rather than fail, so this bounds
// the concurrency and never the count.
export const SEARCH_CONCURRENCY_CAP = parsePositiveInt(
  env.SEARCH_CONCURRENCY_CAP,
  DEFAULT_SEARCH_CONCURRENCY_CAP,
  MIN_CONCURRENCY,
);

// Max search admission slots the realm-server process hands out at once,
// across every caller. Enforced server-side at admission (see the realm-server's
// `search-inflight.ts`), before the request body is read. A request that the
// live-search cache serves from another request's computation hands its slot
// back as soon as the cache says so, so the slots are held by searches
// assembling their own result document — the ones that hold heap — plus the
// requests briefly between admission and the cache lookup. Sized so that a
// full gate of distinct computations fits a 2 GB heap: each holds tens of MB
// while it assembles, and a few dozen exhaust that heap. Raise it per
// environment where the heap allows. Indexing traffic is admitted regardless
// of this ceiling (it is bounded upstream by the prerender pool), so the
// effective room for interactive searches is whatever indexing isn't using.
export const SERVER_MAX_IN_FLIGHT_SEARCHES = parsePositiveInt(
  env.SERVER_MAX_IN_FLIGHT_SEARCHES,
  DEFAULT_SERVER_MAX_IN_FLIGHT_SEARCHES,
  MIN_CONCURRENCY,
);

// How long a search arriving above SERVER_MAX_IN_FLIGHT_SEARCHES waits for a
// slot before it is shed. Long enough that a burst which clears in well under
// a second is served rather than rejected; short enough that a saturated
// process answers quickly instead of parking connections. 0 sheds at once.
export const SEARCH_ADMISSION_WAIT_MS = parsePositiveInt(
  env.SEARCH_ADMISSION_WAIT_MS,
  DEFAULT_SEARCH_ADMISSION_WAIT_MS,
  0,
);

// The most link targets one `loadLinks` assembly may take on, and the whole
// bound on how far a card's transitive link closure is walked.
//
// Counted where a target is classified rather than where it lands, which is
// what lets the ceiling bound the batched reads and not just the assembly. The
// two totals differ by the targets that turn out to have nothing behind them: a
// link whose row is missing or errored, and a cross-realm fetch that fails,
// each spend from the ceiling and add nothing to `included[]`. So a card with
// many broken links can report its closure clipped while carrying fewer
// resources than the ceiling allows — the bound is on work undertaken, which is
// the quantity that costs, and it errs toward doing less of it.
//
// Sized as a safety ceiling rather than as a tuning knob. On realms in use the
// widest card's closure runs to the low hundreds of resources, and a
// hundred-row page of the most connected type unions to about the same, so the
// ceiling sits several times above that. It also lands near the point where one
// assembly would hold the tens of MB of heap SERVER_MAX_IN_FLIGHT_SEARCHES
// assumes per in-flight search, a serialized resource running a little over
// 2 KB. So it is not expected to engage; it exists so that no single card graph
// — authored by a person or by a model, and re-editable at any time — can make
// one request assemble an unbounded document.
//
// Changing this value changes which responses are truncated and what a
// truncated one contains, while none of the other validator inputs move, so it
// is folded into the card+json ETag variant (see `cardJsonEtagVariant` in
// realm.ts). A client holding a validator would otherwise be told the shape it
// cached is still fresh across a retune.
export const SERVER_MAX_ASSEMBLED_LINK_RESOURCES = parsePositiveInt(
  env.SERVER_MAX_ASSEMBLED_LINK_RESOURCES,
  DEFAULT_SERVER_MAX_ASSEMBLED_LINK_RESOURCES,
  MIN_ASSEMBLED_LINK_RESOURCES,
);

// ---------------------------------------------------------------------------
// The link-shape policy's tuning (see runtime-common/link-shape-policy.ts).
//
// These bound the rung below admission control: how much of a result's link
// graph a live read carries, chosen from prevailing load. Admission control
// answers a saturated process by refusing work; this answers it one step
// earlier by serving a cheaper representation, which costs the caller a
// follow-up fetch rather than the whole request.
//
// Every number below was derived from the production realm-server's own
// `inFlightSearch` record rather than chosen up front. The 7-day distribution
// (37,644 health samples) is bimodal: 51.5% of samples sit at 0-1 in-flight
// and 77% at or below 5, while 2.4% pile up at exactly the admission cap —
// the shedding regime. Between those lies the band this policy acts in.
//
// The thresholds are absolute in-flight counts, not fractions of the cap,
// because that is the unit they were measured in. They were derived against
// the default cap of 30 and want re-deriving if the cap moves materially;
// `normalizeThresholds` in the policy keeps them under whatever cap is in
// force so a policy can never be configured to engage only after shedding has
// already started.
// ---------------------------------------------------------------------------

// Half-life of the time-weighted mean of in-flight searches the policy decides
// on. The measured episodes are hour-long plateaus, so the reading is
// insensitive to this within the range tried (30s-300s moved its p90 by under
// 12% on the saturation window). Chosen for stability rather than fit: two
// minutes puts the reading ~90% of the way to a sustained change after about
// seven, which is the "changes over minutes" the sticky decision needs, and it
// flattens the bursts that reach the cap instantaneously without ever being
// sustained — on a control window whose raw samples peaked at the cap of 30,
// the smoothed reading peaked at 17.
const DEFAULT_LINK_SHAPE_LOAD_HALF_LIFE_MS = 120_000;

// The floor on how long a realm holds a level before it may leave it. The
// hysteresis band below is what actually keeps production steady — this
// changed nothing on either measured window, at either 60s or 120s. It earns
// its place by bounding the adversarial case the band cannot: a reading driven
// to swing the full band repeatedly can still only move a realm once per
// interval, so the flap rate is bounded by construction rather than by how the
// signal happens to behave.
const DEFAULT_LINK_SHAPE_MIN_DWELL_MS = 60_000;

// Engage/release pairs for the two rungs.
//
// Each value is a **threshold on the load reading** — the time-weighted mean
// of in-flight searches this process is serving, per replica — and not a
// setting that selects a link shape. Crossing one moves a realm's rung; which
// shape a rung then serves is fixed by the ladder, not by these. Hence the
// `_THRESHOLD` suffix: a bare `…_ENGAGE` reads as a switch that turns a shape
// on, which is the one thing these do not do.
//
// The lower rung degrades only reads that may return more than one row; the
// upper one degrades every live read. The gap between each engage and its
// release is the hysteresis band.
//
// # Each value is per replica, and the fleet size is part of the number
//
// The reading is fed only by the admissions one process served, and the ladder
// is a `Map` in that process's memory with no shared store. So the fleet-wide
// load a rung corresponds to is the threshold multiplied by the number of
// tasks. These are fitted against a **two-task** realm-server fleet, which is
// what production ran across every window below. Doubling the fleet halves
// each replica's share of the same traffic, so it does not make the rungs more
// sensitive — it makes them take twice the fleet-wide load to reach. A
// threshold carried to a fleet of a different size is a different policy, and
// the count to read is distinct containers *concurrently*, not distinct
// container ids seen over a window, which a deployment inflates.
//
// # Where the lower rung sits, and why
//
// Event-loop lag is the mechanism by which searches on one realm slow requests
// on every other one, so it is the signal the rung is placed against. Pairing
// each health sample's lag with the sustained reading from that same sample on
// that same process, lag p99 climbs off the 20 ms histogram floor as the
// reading leaves idle, reaches roughly 55-80 ms by a reading of about 3, and
// then stops climbing: it is flat from there through 4, 5, 8, 12 and beyond
// 20. So the rung is placed where the loop's cost *begins*, which is where the
// association exists, rather than where it is worst, which this says nothing
// about.
//
// Two things that observation does not establish, both worth holding onto
// before it gets quoted for more than it says. Lag and the reading are both
// downstream of the traffic, so a rung moving does not follow as a way to
// reduce lag — only as a way to act before the loop has finished slowing.
// And a curve that is flat from 3 through 20 means the reading barely
// discriminates across the whole range both rungs live in, so it is a weak
// control signal exactly where the ladder leans on it. That is the same
// conclusion the count-versus-cost point below reaches by another route, and
// the reason a cost-aware signal would beat retuning this one again.
//
// 4 rather than 3 is bought by the quiet side. Replaying the production
// reading through this ladder over 71 covered replica-hours of ordinary
// traffic, the sustained reading peaks at 2.06 — so 4 leaves about a factor of
// two of headroom over the busiest quiet window, where 3 would leave under
// one, and 3 buys only another 1-2 points of degraded time on the busy
// windows.
//
// The cost of coming down is nil where it was feared. Degraded time on quiet
// production traffic is 0.0% at 3, 4, 5 and 8 alike: the reading never reaches
// any of them. Flapping does not increase either — across the candidates the
// level-change rate *peaks* around 6-7 (2-3 per replica-hour) and falls away
// on both sides, because a rung below where the reading dwells during a busy
// stretch engages once and stays rather than oscillating across it. Inside the
// busy windows 4 is the steadiest of the candidates; over all replayed time it
// runs at 0.28 level changes per replica-hour against 0.19 at 8, both far
// below the one-per-hour the dwell floor would permit.
//
// What this rung is not is a defence against the cost of any one search. The
// reading counts admitted searches and says nothing about what each is doing,
// so the same number covers very different amounts of work — an expensive
// derived workload reaches a given reading with far fewer requests than
// ordinary traffic does. Two readings are comparable only within a similar
// mix.
const DEFAULT_LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD = 4;
const DEFAULT_LINK_SHAPE_MULTI_ROW_RELEASE_THRESHOLD = 2;

// The upper rung sheds the closure from single-row reads too, which is the
// last thing a live read has left to give up, so it is placed against the
// process falling over rather than against the loop slowing down. It stays
// well clear of the lower rung and below the admission cap: a reading of 12
// against a cap of 30 leaves the ladder a band to act in before shedding
// starts, which is the ordering the policy exists to create. Lowering it to 8
// degrades a fleet whose half-hour means never leave single digits — measured
// at the time it was set, that cost a quiet window 3.8% of its time degraded
// against 0.3% — so it is held above the range ordinary busy traffic reaches.
const DEFAULT_LINK_SHAPE_ALL_ENGAGE_THRESHOLD = 12;
const DEFAULT_LINK_SHAPE_ALL_RELEASE_THRESHOLD = 6;

// How often a process that is serving live reads records the decision it is
// making, even when that decision is "no change". Without it, a policy that
// never engages is indistinguishable from one that is not running.
const DEFAULT_LINK_SHAPE_HEARTBEAT_MS = 60_000;

export const LINK_SHAPE_LOAD_HALF_LIFE_MS = parsePositiveInt(
  env.LINK_SHAPE_LOAD_HALF_LIFE_MS,
  DEFAULT_LINK_SHAPE_LOAD_HALF_LIFE_MS,
  1,
);

export const LINK_SHAPE_MIN_DWELL_MS = parsePositiveInt(
  env.LINK_SHAPE_MIN_DWELL_MS,
  DEFAULT_LINK_SHAPE_MIN_DWELL_MS,
  0,
);

export const LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD = parsePositiveInt(
  env.LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD,
  DEFAULT_LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD,
  1,
);

export const LINK_SHAPE_MULTI_ROW_RELEASE_THRESHOLD = parsePositiveInt(
  env.LINK_SHAPE_MULTI_ROW_RELEASE_THRESHOLD,
  DEFAULT_LINK_SHAPE_MULTI_ROW_RELEASE_THRESHOLD,
  0,
);

export const LINK_SHAPE_ALL_ENGAGE_THRESHOLD = parsePositiveInt(
  env.LINK_SHAPE_ALL_ENGAGE_THRESHOLD,
  DEFAULT_LINK_SHAPE_ALL_ENGAGE_THRESHOLD,
  1,
);

export const LINK_SHAPE_ALL_RELEASE_THRESHOLD = parsePositiveInt(
  env.LINK_SHAPE_ALL_RELEASE_THRESHOLD,
  DEFAULT_LINK_SHAPE_ALL_RELEASE_THRESHOLD,
  0,
);

export const LINK_SHAPE_HEARTBEAT_MS = parsePositiveInt(
  env.LINK_SHAPE_HEARTBEAT_MS,
  DEFAULT_LINK_SHAPE_HEARTBEAT_MS,
  1,
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
let maxAssembledLinkResources = SERVER_MAX_ASSEMBLED_LINK_RESOURCES;

// The (size, max) pairs already reported by `warnOncePerClamp`. In practice a
// clamp is driven by an authored page size — a constant in a card definition —
// so the distinct pairs are few and recur, which is what makes deduping the
// warning worthwhile. The size nonetheless arrives on a request, so the key
// space is the caller's to choose and the set is capped rather than trusted to
// stay small. Reset alongside the bounds themselves, so a test that lowers the
// ceiling still sees its warning.
let reportedClamps = new Set<string>();
const MAX_REPORTED_CLAMPS = 32;

export function setSearchBoundsForTests(overrides: {
  maxPageSize?: number;
  serverMaxPageSize?: number;
  serverAbsoluteMaxPageSize?: number;
  maxRealmsPerRequest?: number;
  timeBudgetMs?: number;
  maxAssembledLinkResources?: number;
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
  if (overrides.maxAssembledLinkResources !== undefined) {
    maxAssembledLinkResources = overrides.maxAssembledLinkResources;
  }
}

export function resetSearchBoundsForTests(): void {
  reportedClamps = new Set();
  maxPageSize = MAX_SEARCH_PAGE_SIZE;
  serverMaxPageSize = SERVER_MAX_SEARCH_PAGE_SIZE;
  serverAbsoluteMaxPageSize = SERVER_ABSOLUTE_MAX_PAGE_SIZE;
  maxRealmsPerRequest = MAX_REALMS_PER_SEARCH_REQUEST;
  timeBudgetMs = SEARCH_TIME_BUDGET_MS;
  maxAssembledLinkResources = SERVER_MAX_ASSEMBLED_LINK_RESOURCES;
}

// The effective assembled-resource budget. Read through a function rather than
// imported as a const so the test seam above reaches it — a test exercises the
// bound by lowering it to a handful of resources instead of authoring a
// thousand-card graph.
export function assembledLinkResourceBudget(): number {
  return maxAssembledLinkResources;
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

function warnOncePerClamp(size: number, max: number): void {
  let key = `${size}/${max}`;
  if (reportedClamps.has(key)) {
    return;
  }
  // `size` reaches here from a request body, so the key space is caller-chosen
  // rather than bounded by what the realm's cards declare. Real traffic
  // produces a handful of distinct sizes — every authored page size is a
  // constant — but a caller walking 2001, 2002, 2003… would otherwise retain an
  // entry each. Past the cap the clamp still applies and is simply no longer
  // logged, which is the right trade: the artifact exists for the authored
  // sizes that recur, not for a caller enumerating one-shot values.
  if (reportedClamps.size >= MAX_REPORTED_CLAMPS) {
    return;
  }
  reportedClamps.add(key);
  log.warn(
    `page.size ${size} exceeds the maximum of ${max}; clamped to ${max} (further identical clamps are not logged). The true match count rides meta.page.total; ${HTML_LEG_HINT}`,
  );
}

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

// Enforce mandatory pagination on an item-leg query. `dflt` is the size a query
// that names none is clamped to, so a non-paginating caller gets the first page
// rather than every row. `max` is the ceiling an explicit page may not pass;
// between the two, a caller that named a size gets it, having asked for that
// cost knowingly.
//
// `overMax` decides what happens past the ceiling, and the two answers exist for
// two different kinds of caller. `reject` is for a caller that can act on being
// told no — card code calling `getCards` surfaces the error in the card, and the
// author who wrote the number is the one who sees it. `clamp` is for a caller
// that cannot: a query-backed field's page is authored once and then resolved by
// machinery on three separate legs (the indexer's expansion, a peer realm's
// `_search`, the client's live refresh), so a rejection on one of them and a
// clamp on another is how a field comes to work from its seed and then fail on
// refresh. Clamping everywhere keeps the legs agreeing, and it is honest because
// `meta.page.total` reports the true match count beside the short page — so a
// caller can always see it got less than it asked for.
//
// Returns the (possibly clamped) query without mutating input.
function boundPageSize(
  query: Query,
  dflt: number,
  max: number,
  overMax: 'reject' | 'clamp',
): Query {
  // The default can never exceed the ceiling. Production can't invert them
  // (the exported consts are floored at module load), but the test seam can,
  // and a default above `max` would hand out a page larger than the one an
  // explicit request is held to.
  let effectiveDefault = Math.min(dflt, max);
  let page = query.page;
  if (page == null) {
    // No page at all: apply the mandatory default so the result set is bounded.
    return { ...query, page: { size: effectiveDefault } } as Query;
  }
  let size = Number((page as { size?: unknown }).size);
  if (!Number.isFinite(size) || size < 1) {
    // A page object with a missing / non-numeric / non-positive size can't
    // bound the result set — and would compile to `LIMIT undefined` / a
    // negative limit — so treat it like an absent page and clamp to the
    // default rather than let it through unbounded.
    return { ...query, page: { ...page, size: effectiveDefault } } as Query;
  }
  if (size > max) {
    if (overMax === 'reject') {
      throw new SearchBoundError(
        400,
        `page.size ${size} exceeds the maximum of ${max}; request a smaller page, or ${HTML_LEG_HINT}`,
      );
    }
    // Clamping is the quiet path, so leave an artifact. Without one the only
    // symptom is a result set smaller than the caller asked for, which looks
    // like the query matching less rather than the bound intervening — the
    // question "why am I only getting 2000?" has no answer anywhere else.
    //
    // Logged once per distinct (size, max) pair, because the caller that trips
    // this is typically a query-backed field whose page is authored once and
    // then applied on every index of every instance of that card: a realm with
    // ten thousand of them would otherwise emit ten thousand identical lines
    // per reindex, which buries the artifact rather than providing one.
    warnOncePerClamp(size, max);
    // `page.number` is carried through unchanged, so a smaller size moves the
    // window as well as narrowing it: `{size: 5000, number: 3}` becomes offset
    // 6000, not 15000. A caller walking pages from zero still sees every row
    // exactly once; one computing its own offset from `size × number` does not.
    return { ...query, page: { ...page, size: max } } as Query;
  }
  return query;
}

// The card `@context` page cap, enforced client-side on card-initiated
// item-leg searches (see host StoreService). One threshold, not two: untrusted
// card code doesn't get to opt into a larger page by asking for one.
export function applySearchPageBound(query: Query): Query {
  return boundPageSize(query, maxPageSize, maxPageSize, 'reject');
}

// The server-side page bounds. These hold on every item-leg request the server
// handles regardless of caller, and on the indexer's own in-process query-field
// expansion, which is server work that no HTTP bound would otherwise reach.
//
// A request naming no page is clamped to the default (higher than the card
// `@context` cap — the host may legitimately page larger). One naming a size is
// honored up to the absolute maximum, and clamped to it above. That pair is what
// lets a caller with a reason — a query-backed field declaring the page it needs
// — ask for more than the default while still leaving the server's work bounded.
//
// Clamping rather than rejecting is what keeps a query-backed field's three
// resolution legs agreeing. The field's page is authored once and then applied
// by the indexer's expansion, by a peer realm's `_search`, and by the client's
// live refresh; a rejection on one and a clamp on another is how a field comes
// to resolve from its seed and then fail the first time it refreshes. It is also
// what keeps an over-large page from making a card unindexable, since that page
// is read on every index of every instance of it. The shortfall is never silent:
// `meta.page.total` carries the true match count beside the short page, and a
// query-backed field surfaces it as `isPartial`.
export function applyServerSearchPageBound(query: Query): Query {
  return boundPageSize(
    query,
    serverMaxPageSize,
    serverAbsoluteMaxPageSize,
    'clamp',
  );
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
