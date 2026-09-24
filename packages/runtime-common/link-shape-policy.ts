// How much of a result's link graph a live read carries, chosen from the load
// the realm is under rather than from a fixed setting.
//
// A live card read or search either side-loads the whole transitive link
// closure into `included[]`, or answers each relationship and carries none of
// its targets. Neither shape is right on its own: the closure is faster for any
// one page and is also what saturates the server, so it makes every other
// page slow and fails a share of their searches outright. The right shape
// depends on concurrency, which the client cannot observe and a fixed choice
// cannot track.
//
// The realm server's other answer to pressure is to refuse work — a `429` for
// a request still queued when the admission cap stays full past the admission
// wait. That is a response to bursts against the instantaneous cap. This one
// is a response to sustained load: under it a read is served a cheaper
// representation, and the caller fetches the linked cards it actually
// displays. The two act on different counts over different spans, so neither
// is placed relative to the other; a process can shed on a burst while its
// sustained reading sits below the lower rung.
//
// # Three levels, because the two costs scale differently
//
// A closure's cost grows with result count multiplied by links per row, so the
// population is very uneven: a single card read can afford its closure even
// under load, while a search that may return a page of rows should shed it
// well before load is critical. The policy therefore has two rungs rather than
// one switch —
//
//   full       every live read carries its closure
//   multi-row  reads that may return more than one row shed it
//   all        every live read sheds it
//
// — and each read is classified by whether its result count is bounded at one
// before it runs. That bound is the only cost signal available at decision
// time, and it has to be: the link mode is folded into the response validator,
// so it must be known before the response is built rather than after.
//
// Requested page size is a poor stand-in for cost on its own. Measured over
// 43,009 live production searches, the largest page size in use (500, the
// server default applied when a caller names no page) averaged 0.09 results,
// while page size 200 averaged 48.9 and page size 100 averaged 14.3. The
// ceiling only predicts the cost where it is tight, and the one place it is
// tight is at the bottom: every page-size-1 request returned exactly one row.
// So the classification splits single-row reads from the rest and makes no
// finer distinction, because the data supports none.
//
// # The decision is sticky, per realm
//
// The link mode is folded into both validators — the card+json ETag takes a
// `-links-only` variant, and the card+html one does the same for an
// item-bearing response — and the card+json response cache is keyed on the
// validator. A mode that flapped per request would mean conditional GETs
// answering `200` instead of `304` in both directions and cache entries
// fragmenting across two variants, with the misses landing exactly when the
// server is busiest. So a level is held per realm, moves at most one step per
// consult, and cannot move at all until it has been held for the minimum
// dwell.
//
// The realm is the unit because it is the scope one process's response cache
// is consistent over. That scope is also the whole of what this mechanism
// reaches: the ladder is a `Map` in process memory with no shared store, each
// replica's reading is fed only by its own admissions, and a realm's dwell
// advances only on the reads that replica served. So two replicas behind one
// load balancer can hold the same realm at different rungs, and a conditional
// GET that lands on the other one is answered `200` with a body rather than
// `304` — most likely under load, when their readings diverge most.
// Correctness is unaffected, since a validator always describes the bytes it
// ships with; the cost is a missed revalidation. What per-realm state buys
// within a process is that a realm only transitions on a read of its own, so a
// quiet realm neither changes level nor reports one, and every transition
// names the realm whose cache entries it fragmented.
//
// # Each realm is decided on its own load
//
// The reading a realm's level follows is that realm's own: the sustained count
// of search requests in flight that name it, not the process's. A level is
// what the realm's readers are served, and the realm's readers are not the
// ones whose load a busy neighbour generates — deciding every realm on the
// process's count would degrade an idle tenant's responses, and charge it a
// validator drop and a response-cache variant twice over, to relieve a load it
// did not cause. Degrading the realm that is busy is where the relief comes
// from in any case, since that is where the closures being assembled are.
//
// What this gives up is engaging on load spread thinly across many realms,
// where each realm's reading is a fraction of the process's and none crosses a
// rung. That case is the admission gate's: it bounds the process's
// concurrent computations whichever realms they name. The process's reading
// is still logged beside every decision, so the gap between the two is
// visible.
//
// # The caller states a preference the server may overrule
//
// The client knows whether it is hydrating full instances or rendering a
// fitted list; the server knows the concurrency. Neither alone is sufficient,
// so a caller states a preference and the server overrules it only downward.
// A caller that asks for links-only always gets links-only — the server never
// does more work than it was asked for — while a caller that asks for the
// closure gets it only while its realm's level permits.
//
// # Prerender is excluded by construction
//
// A prerender already asks for less than either shape (it skips the link
// assembly pass outright), so it never reaches this policy and prerendered
// HTML is byte-identical whatever the policy decides. Its searches do still
// count toward the load reading, because they are real pressure on the same
// event loop and the same heap — the exclusion is from being degraded, not
// from being counted.

import { logger } from './log.ts';
import {
  LINK_SHAPE_ALL_ENGAGE_THRESHOLD,
  LINK_SHAPE_ALL_RELEASE_THRESHOLD,
  LINK_SHAPE_HEARTBEAT_MS,
  LINK_SHAPE_MIN_DWELL_MS,
  LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD,
  LINK_SHAPE_MULTI_ROW_RELEASE_THRESHOLD,
  SERVER_MAX_IN_FLIGHT_SEARCHES,
} from './search-bounds.ts';

export const LINK_SHAPE_POLICY_CHANNEL = 'boxel:link-shape-policy';

// Elapsed spans inside one process, from a source that cannot step.
function monotonicNow(): number {
  return performance.now();
}

// The request header a caller states its preference on. Absent means the
// closure: that is the shape a caller gets when no policy is engaged, so an
// unstated preference is a request for it.
//
// Deliberately not declared in `Vary`. What keeps a cache honest here is the
// validator, not the varied-on header: the served shape is folded into the
// card+json and card+html ETags, and both are served `must-revalidate`, so a
// client holding a validator it obtained for one shape revalidates and is
// answered `200` with the other rather than `304` with the body it already
// had. A `Vary` entry would add nothing to that and would cost something — a
// browser cache keeps one stored variant per URL, so two populations asking
// for different shapes at one URL would evict each other's entry on every
// request.
export const X_BOXEL_LINK_SHAPE_HEADER = 'x-boxel-link-shape';

// The two shapes a live read can be served in. `full` assembles the closure;
// `links-only` answers relationships and carries no targets.
export type LinkShapeMode = 'full' | 'links-only';

// Whether a read's result count is bounded at one before it runs. A card read
// and a single-entry card+html read are `single-row` by construction; a search
// is `multi-row` unless its post-clamp page size is 1.
export type LinkShapeRowClass = 'single-row' | 'multi-row';

// The levels, in increasing order of degradation. The numeric values are the
// ladder's rungs and are compared, so they must stay ordered.
export const LINK_SHAPE_LEVELS = ['full', 'multi-row', 'all'] as const;
export type LinkShapeLevel = (typeof LINK_SHAPE_LEVELS)[number];

export interface LinkShapeDecision {
  // The shape the response will actually be built in.
  mode: LinkShapeMode;
  // The shape the caller asked for, which is what makes an override auditable:
  // one served-mode field cannot distinguish "the caller asked for links-only"
  // from "the caller asked for the closure and was downgraded".
  requested: LinkShapeMode;
  // The decision's inputs, recorded on the request they decided. Recording the
  // inputs rather than only the outcome is what separates "the policy did the
  // right thing on bad inputs" from "the policy misjudged good inputs" — those
  // need different fixes, and by the time anyone asks, the load that caused
  // the decision is gone.
  //
  // Both are null together, and mean the same thing: no ladder decided this.
  // A pinned policy answers one shape whatever the load, so reporting a level
  // and a reading it never consulted would make "the ladder ran and engaged
  // nothing" and "no ladder is wired into this process" the same two fields.
  level: LinkShapeLevel | null;
  load: number | null;
  rowClass: LinkShapeRowClass;
}

// One record per level change per realm, plus a sampled record of the decision
// being made when it is not changing. Low volume by construction: a transition
// costs a realm its cached validators, so there are few of them, and the
// heartbeat is per process rather than per realm so its rate does not grow
// with the number of realms mounted.
export interface LinkShapePolicyEvent {
  channel: typeof LINK_SHAPE_POLICY_CHANNEL;
  // False for the sampled no-change record. A reader splits the two on this
  // rather than on which fields are null.
  changed: boolean;
  // The realm whose level moved. Null on the heartbeat, which is per process.
  realm: string | null;
  previousLevel: LinkShapeLevel | null;
  level: LinkShapeLevel | null;
  // Which threshold the reading crossed, and in which direction. Null on the
  // heartbeat.
  threshold: number | null;
  thresholdKind: 'engage' | 'release' | null;
  // How long the realm held the level it just left. This is what separates
  // stable operation from flapping, and flapping is the specific failure this
  // design risks given the validator and response-cache coupling.
  dwellMs: number | null;
  // The reading the decision was taken on — the realm's own on a transition,
  // the process's on the heartbeat, which has no realm — and the process's
  // reading and admission cap beside it. A realm's reading never exceeds the
  // process's, so the gap between the two on a transition is the load other
  // realms were generating at the time. The reading and the cap are in
  // different units — the reading counts requests, the cap counts the
  // computations among them — so the reading can exceed the cap, and does
  // whenever the live-search cache is coalescing.
  load: number;
  processLoad: number;
  limit: number;
  // How many realms this process has served since start, counted at the level
  // each was last left in. Not the realms it currently mounts: a realm is
  // added on its first read and never dropped, so one that has since been
  // unmounted keeps being counted, and one that is mounted but unread is
  // absent. Heartbeat only — on a transition these would describe the moment
  // after the change and invite being read as its cause.
  //
  // A count here is a *recorded* level, not a served one. A realm's level is
  // re-evaluated only when that realm is read, never on a timer, so a realm
  // whose readers left while it was degraded stays counted at that level for
  // however long it goes unread — well past the point its reading fell under
  // the release. Nobody is served that level in the meantime: the first read
  // to arrive is decided against the current reading, releases the realm, and
  // is served the shape the release allows. So a realm counted at `multi-row`
  // after load has ended is idle at a stale level, not sitting degraded.
  realmsAtFull: number | null;
  realmsAtMultiRow: number | null;
  realmsAtAll: number | null;
}

// Test seam, mirroring `setSearchShapeSink`: when set, events go to the sink
// instead of the logger so a test can assert on records without scraping
// stdout.
let policySink: ((event: LinkShapePolicyEvent) => void) | undefined;

export function setLinkShapePolicySink(
  sink: ((event: LinkShapePolicyEvent) => void) | undefined,
): void {
  policySink = sink;
}

// Created lazily: a module-scope `logger()` here can race the circular import
// that installs the log-definitions factory (the same hazard `emitSearchShape`
// documents).
let policyLog: ReturnType<typeof logger> | undefined;

function emit(event: LinkShapePolicyEvent): void {
  if (policySink) {
    policySink(event);
    return;
  }
  (policyLog ??= logger(LINK_SHAPE_POLICY_CHANNEL)).info(JSON.stringify(event));
}

interface RealmState {
  level: LinkShapeLevel;
  // When the realm entered its current level, or null for a realm that has
  // never left the one it started at. Null passes the dwell floor: that floor
  // bounds how often a level *changes*, and a realm that has never changed one
  // has nothing to be protected from. Without this a process that boots into
  // an already-saturated fleet would serve closures for a full dwell interval
  // before it could react.
  since: number | null;
}

export interface LinkShapePolicyOptions {
  // The reading the policy decides a realm's level on: the sustained count of
  // search requests in flight naming that realm, joiners included. A policy
  // built without one is pinned — see `LinkShapePolicy.pinned`.
  readLoad?: (realm: string) => number;
  // The process's sustained count of search requests in flight, logged beside
  // each decision. Absent reads as 0.
  readProcessLoad?: () => number;
  // The process's admission cap. Reported alongside every decision for
  // context; it does not bound the thresholds, since it counts computations
  // and the reading counts requests.
  limit?: number;
  multiRowEngage?: number;
  multiRowRelease?: number;
  allEngage?: number;
  allRelease?: number;
  minDwellMs?: number;
  heartbeatMs?: number;
  now?: () => number;
}

export class LinkShapePolicy {
  #readLoad: ((realm: string) => number) | undefined;
  #readProcessLoad: (() => number) | undefined;
  #pinned: LinkShapeMode | undefined;
  #limit: number;
  #engage: [number, number];
  #release: [number, number];
  #minDwellMs: number;
  #heartbeatMs: number;
  #now: () => number;
  #realms = new Map<string, RealmState>();
  #lastHeartbeatAt: number;

  constructor(opts: LinkShapePolicyOptions = {}) {
    this.#readLoad = opts.readLoad;
    this.#readProcessLoad = opts.readProcessLoad;
    this.#limit = opts.limit ?? SERVER_MAX_IN_FLIGHT_SEARCHES;
    let { engage, release } = normalizeThresholds(
      [
        opts.multiRowEngage ?? LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD,
        opts.allEngage ?? LINK_SHAPE_ALL_ENGAGE_THRESHOLD,
      ],
      [
        opts.multiRowRelease ?? LINK_SHAPE_MULTI_ROW_RELEASE_THRESHOLD,
        opts.allRelease ?? LINK_SHAPE_ALL_RELEASE_THRESHOLD,
      ],
    );
    this.#engage = engage;
    this.#release = release;
    this.#minDwellMs = opts.minDwellMs ?? LINK_SHAPE_MIN_DWELL_MS;
    this.#heartbeatMs = opts.heartbeatMs ?? LINK_SHAPE_HEARTBEAT_MS;
    // `performance.now()`, not `Date.now()`: the dwell floor measures an
    // elapsed span inside one process, and a forward wall-clock step can
    // satisfy a whole dwell interval at once, letting a realm take a rung it
    // had just been blocked from.
    this.#now = opts.now ?? monotonicNow;
    this.#lastHeartbeatAt = this.#now();
  }

  // A policy that always answers one shape, whatever the load. This is how a
  // realm constructed outside a realm-server process — a test fixture, an
  // in-browser realm — gets a definite shape without an admission gate to read
  // a reading from, and it is the only way to hold one shape fixed now that
  // the operator-set environment variable is gone.
  static pinned(mode: LinkShapeMode): LinkShapePolicy {
    let policy = new LinkShapePolicy();
    policy.#pinned = mode;
    return policy;
  }

  // The reading the next decision for `realm` would be taken on.
  loadFor(realm: string): number {
    return this.#readLoad ? this.#readLoad(realm) : 0;
  }

  get #processLoad(): number {
    return this.#readProcessLoad ? this.#readProcessLoad() : 0;
  }

  // The level a realm is currently held at, without advancing it. A realm
  // never consulted has never transitioned, so it reads as `full` — which is
  // also what it would be served.
  levelFor(realm: string): LinkShapeLevel {
    return this.#realms.get(realm)?.level ?? 'full';
  }

  decide(args: {
    realm: string;
    rowClass: LinkShapeRowClass;
    requested: LinkShapeMode;
  }): LinkShapeDecision {
    let { realm, rowClass, requested } = args;
    if (this.#pinned !== undefined) {
      // A pinned policy still honours a links-only preference, so the two
      // reasons a response can be links-only stay distinguishable in the log.
      let mode =
        requested === 'links-only'
          ? 'links-only'
          : (this.#pinned as LinkShapeMode);
      return {
        mode,
        requested,
        level: null,
        load: null,
        rowClass,
      };
    }

    let load = this.loadFor(realm);
    let level = this.#advance(realm, load);
    let policyMode: LinkShapeMode =
      level === 'all' || (level === 'multi-row' && rowClass === 'multi-row')
        ? 'links-only'
        : 'full';
    // The server overrules only downward: a caller asking for less than the
    // policy would impose is taken at its word.
    let mode: LinkShapeMode =
      requested === 'links-only' ? 'links-only' : policyMode;
    this.#maybeHeartbeat();
    return {
      mode,
      requested,
      level,
      load,
      rowClass,
    };
  }

  // The federated fan-out's decision: one shape for a document merged from
  // several realms, since the response carries one `included[]` and is keyed
  // on one validator.
  //
  // Every named realm is consulted, so each advances on reads it actually
  // serves rather than only on its own routes' traffic, and the most degraded
  // answer wins. Between realms at the same level, the one with the higher
  // reading is reported, since it is the one closest to the next rung and so
  // the reading that explains the decision. Most degraded rather than least because the fan-out's cost is
  // the sum across realms: if assembling one realm's closure is already more
  // than the process should be doing, adding the others' does not make it
  // less. A request naming no realms has nothing to consult and keeps its
  // closure.
  decideAcross(args: {
    realms: string[];
    rowClass: LinkShapeRowClass;
    requested: LinkShapeMode;
  }): LinkShapeDecision {
    let { realms, rowClass, requested } = args;
    let worst: LinkShapeDecision | undefined;
    for (let realm of realms) {
      let decision = this.decide({ realm, rowClass, requested });
      let rank = LINK_SHAPE_LEVELS.indexOf(decision.level ?? 'full');
      let worstRank = worst
        ? LINK_SHAPE_LEVELS.indexOf(worst.level ?? 'full')
        : -1;
      if (
        rank > worstRank ||
        (rank === worstRank && (decision.load ?? 0) > (worst?.load ?? 0))
      ) {
        worst = decision;
      }
    }
    return (
      worst ?? {
        mode: requested === 'links-only' ? 'links-only' : 'full',
        requested,
        // No realm was named, so no realm's ladder was consulted.
        level: null,
        load: null,
        rowClass,
      }
    );
  }

  // Move the realm at most one rung toward where the reading says it belongs,
  // and only if it has held its current level for the minimum dwell. One rung
  // per consult rather than a jump to the matching level: each rung change
  // costs the realm a set of cached validators, so they are worth taking one
  // at a time, and the dwell floor already paces them.
  #advance(realm: string, load: number): LinkShapeLevel {
    let now = this.#now();
    let state = this.#realms.get(realm);
    if (!state) {
      state = { level: 'full', since: null };
      this.#realms.set(realm, state);
    }
    let index = LINK_SHAPE_LEVELS.indexOf(state.level);
    let wanted = index;
    let threshold: number | null = null;
    let thresholdKind: 'engage' | 'release' | null = null;
    if (index < 2 && load >= this.#engage[index]) {
      wanted = index + 1;
      threshold = this.#engage[index];
      thresholdKind = 'engage';
    } else if (index > 0 && load <= this.#release[index - 1]) {
      wanted = index - 1;
      threshold = this.#release[index - 1];
      thresholdKind = 'release';
    }
    if (wanted === index) {
      return state.level;
    }
    let dwellMs = state.since === null ? null : now - state.since;
    if (dwellMs !== null && dwellMs < this.#minDwellMs) {
      return state.level;
    }
    let previousLevel = state.level;
    state.level = LINK_SHAPE_LEVELS[wanted];
    state.since = now;
    emit({
      channel: LINK_SHAPE_POLICY_CHANNEL,
      changed: true,
      realm,
      previousLevel,
      level: state.level,
      threshold,
      thresholdKind,
      dwellMs,
      load,
      processLoad: this.#processLoad,
      limit: this.#limit,
      realmsAtFull: null,
      realmsAtMultiRow: null,
      realmsAtAll: null,
    });
    return state.level;
  }

  // The sampled no-change record. Driven off decisions rather than a timer: a
  // process serving no live reads is making no decisions, so there is nothing
  // for it to report and nothing its silence could be mistaken for.
  #maybeHeartbeat(): void {
    let now = this.#now();
    if (now - this.#lastHeartbeatAt < this.#heartbeatMs) {
      return;
    }
    this.#lastHeartbeatAt = now;
    let processLoad = this.#processLoad;
    let counts: Record<LinkShapeLevel, number> = {
      full: 0,
      'multi-row': 0,
      all: 0,
    };
    for (let state of this.#realms.values()) {
      counts[state.level]++;
    }
    emit({
      channel: LINK_SHAPE_POLICY_CHANNEL,
      changed: false,
      realm: null,
      previousLevel: null,
      level: null,
      threshold: null,
      thresholdKind: null,
      dwellMs: null,
      load: processLoad,
      processLoad,
      limit: this.#limit,
      realmsAtFull: counts.full,
      realmsAtMultiRow: counts['multi-row'],
      realmsAtAll: counts.all,
    });
  }
}

// Read a caller's stated preference off the request headers. Anything other
// than the one recognized opt-in reads as the closure, including a missing
// header: that is the shape a caller gets when no policy is engaged, so it is
// the right reading of "said nothing".
export function requestedLinkShape(
  headerValue: string | null | undefined,
): LinkShapeMode {
  return headerValue?.trim().toLowerCase() === 'links-only'
    ? 'links-only'
    : 'full';
}

// Classify a search by whether its result count is bounded at one. Takes the
// post-clamp page size, since that is the page the query will actually run
// with.
//
// Only an explicit page of exactly one is bounded at one row. Every other
// value — absent, unparseable, zero, negative — is a page the clamp replaces
// with the server default, which is far above one, so all of them classify as
// multi-row. Reading a zero as "at most one row" would invert the very clamp
// this function is meant to read, and the classification does not always run
// after it: the page bound is applied only on the item leg, so a fieldset that
// skips it reaches here with whatever the caller wrote.
export function rowClassForPageSize(
  pageSize: number | null | undefined,
): LinkShapeRowClass {
  return pageSize === 1 ? 'single-row' : 'multi-row';
}

// The lowest release the reading can actually cross. The mean decays toward
// zero without arriving, so a release must sit above it for the rung to be
// two-way.
const MIN_RELEASE = 0.5;

// Keep the ladder monotonic and every band two-way.
//
// Two invariants matter and neither is guaranteed by the env overrides that
// feed this: a release at or above its own engage would make a level
// self-cancelling (it would engage and immediately release, once per dwell
// interval, forever); and a release of zero would make the rung a one-way
// door, since the reading it is compared against is a decaying exponential
// mean that reaches exactly zero only by float underflow — about a day and a
// half of unbroken idleness at the shipped half-life. The env parser floors the
// release knobs at zero, so that last one is a plausible number an operator
// can type.
//
// There is deliberately no ceiling from the admission cap. The cap counts
// slots — computations — and the reading counts requests, which exceed the
// slots by however much the live-search cache is coalescing, so a request
// reading well past the cap is ordinary rather than impossible. Nor can the
// ordering "engage before shedding starts" be expressed as a sustained reading
// in either unit: sheds are driven by bursts against the instantaneous cap,
// and they begin at sustained readings ranging from under one (a burst from
// idle) to the high teens on loads where engaging is measured to help. An
// engage set too high for the traffic simply never engages, which is visible
// on the heartbeat.
function normalizeThresholds(
  engage: [number, number],
  release: [number, number],
): { engage: [number, number]; release: [number, number] } {
  // Every engage at least one clear of the release below it, so both bands
  // have width.
  let multiRowEngage = Math.max(engage[0], MIN_RELEASE + 1);
  let allEngage = Math.max(engage[1], multiRowEngage);
  // Every release reachable by the reading, and strictly below its own engage.
  let multiRowRelease = Math.min(
    Math.max(release[0], MIN_RELEASE),
    multiRowEngage - 1,
  );
  let allRelease = Math.min(
    Math.max(release[1], multiRowRelease),
    allEngage - 1,
  );
  return {
    engage: [multiRowEngage, allEngage],
    release: [multiRowRelease, allRelease],
  };
}
