// How much of a result's link graph a live read carries, chosen from the load
// the process is under rather than from a fixed setting.
//
// A live card read or search either side-loads the whole transitive link
// closure into `included[]`, or answers each relationship and carries none of
// its targets. Neither shape is right on its own: the closure is faster for any
// one page and is also what saturates the server, so it makes every other
// page slow and fails a share of their searches outright. The right shape
// depends on concurrency, which the client cannot observe and a fixed choice
// cannot track.
//
// The realm server's existing answer to pressure is to refuse work — a `429`
// once in-flight searches reach the admission cap. Degrading a response is
// gentler than rejecting a request, so this sits one rung earlier on the same
// ladder: under sustained load a read is served a cheaper representation, and
// the caller fetches the linked cards it actually displays.
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
  LINK_SHAPE_ALL_ENGAGE,
  LINK_SHAPE_ALL_RELEASE,
  LINK_SHAPE_HEARTBEAT_MS,
  LINK_SHAPE_MIN_DWELL_MS,
  LINK_SHAPE_MULTI_ROW_ENGAGE,
  LINK_SHAPE_MULTI_ROW_RELEASE,
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
  // The reading the decision was taken on, and the cap it is measured
  // against.
  load: number;
  limit: number;
  // How many realms this process has served since start, counted at the level
  // each was last left in. Not the realms it currently mounts: a realm is
  // added on its first read and never dropped, so one that has since been
  // unmounted keeps being counted, and one that is mounted but unread is
  // absent. Heartbeat only — on a transition these would describe the moment
  // after the change and invite being read as its cause.
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
  // The sustained in-flight reading the policy decides on. A policy built
  // without one is pinned — see `LinkShapePolicy.pinned`.
  readLoad?: () => number;
  // The admission cap the reading is measured against. Reported alongside every
  // decision so a threshold is legible next to the ceiling it sits below.
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
  #readLoad: (() => number) | undefined;
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
    this.#limit = opts.limit ?? SERVER_MAX_IN_FLIGHT_SEARCHES;
    let { engage, release } = normalizeThresholds(
      [
        opts.multiRowEngage ?? LINK_SHAPE_MULTI_ROW_ENGAGE,
        opts.allEngage ?? LINK_SHAPE_ALL_ENGAGE,
      ],
      [
        opts.multiRowRelease ?? LINK_SHAPE_MULTI_ROW_RELEASE,
        opts.allRelease ?? LINK_SHAPE_ALL_RELEASE,
      ],
      this.#limit,
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

  // The reading the next decision would be taken on. A decision reads it
  // itself; this is for the one caller that needs the reading without a realm
  // to decide for — a fan-out that named none.
  get load(): number {
    return this.#readLoad ? this.#readLoad() : 0;
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

    let load = this.load;
    let level = this.#advance(realm, load);
    let policyMode: LinkShapeMode =
      level === 'all' || (level === 'multi-row' && rowClass === 'multi-row')
        ? 'links-only'
        : 'full';
    // The server overrules only downward: a caller asking for less than the
    // policy would impose is taken at its word.
    let mode: LinkShapeMode =
      requested === 'links-only' ? 'links-only' : policyMode;
    this.#maybeHeartbeat(load);
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
  // answer wins. Most degraded rather than least because the fan-out's cost is
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
      if (
        !worst ||
        LINK_SHAPE_LEVELS.indexOf(decision.level ?? 'full') >
          LINK_SHAPE_LEVELS.indexOf(worst.level ?? 'full')
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
  #maybeHeartbeat(load: number): void {
    let now = this.#now();
    if (now - this.#lastHeartbeatAt < this.#heartbeatMs) {
      return;
    }
    this.#lastHeartbeatAt = now;
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
      load,
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

// Keep the ladder monotonic and under the cap it is measured against.
//
// Three invariants matter and none is guaranteed by the env overrides that
// feed this: a release at or above its own engage would make a level
// self-cancelling (it would engage and immediately release, once per dwell
// interval, forever); an engage at or above the admission cap would put the
// rung past the point where the process has already started shedding, which is
// precisely the ordering this policy exists to invert; and a release of zero
// would make the rung a one-way door, since the reading it is compared against
// is a decaying exponential mean that reaches exactly zero only by float
// underflow — about a day and a half of unbroken idleness at the shipped
// half-life. The env parser floors the release knobs at zero, so that last one
// is a plausible number an operator can type.
// The lowest release the reading can actually cross. The mean decays toward
// zero without arriving, so a release must sit above it for the rung to be
// two-way.
const MIN_RELEASE = 0.5;

function normalizeThresholds(
  engage: [number, number],
  release: [number, number],
  limit: number,
): { engage: [number, number]; release: [number, number] } {
  // Every engage strictly below the cap, and the upper rung no lower than the
  // lower one.
  // Every engage at least one clear of the release below it, and strictly
  // below the cap, so both bands have width and both rungs sit under the point
  // where the process shed.
  let ceiling = Math.max(MIN_RELEASE + 1, limit - 1);
  let multiRowEngage = Math.min(Math.max(engage[0], MIN_RELEASE + 1), ceiling);
  let allEngage = Math.min(Math.max(engage[1], multiRowEngage), ceiling);
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
