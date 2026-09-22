import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  LinkShapePolicy,
  LINK_SHAPE_POLICY_CHANNEL,
  requestedLinkShape,
  rowClassForPageSize,
  setLinkShapePolicySink,
  type LinkShapePolicyEvent,
} from '@cardstack/runtime-common';
import {
  admitSearchUnconditionally,
  beginSearchRequest,
  SearchRequestLoad,
  getSearchInFlight,
  getSearchRequestLoad,
  resetSearchAdmissionForTests,
  setSearchAdmissionForTests,
} from '../search-inflight.ts';

// How much of a result's link graph a live read carries, chosen from the load
// the process is under. The tests below drive the policy through a clock and a
// load reading they control, because the behaviour that matters is what it does
// over minutes of changing concurrency — which is neither reachable nor
// repeatable by generating real load.

const REALM = 'http://localhost:4201/test/';
const OTHER_REALM = 'http://localhost:4201/other/';

// A fixed ladder for the tests below, deliberately not the shipped defaults.
// What these exercise is the ladder's mechanics — one rung per consult, the
// band holding a level, the dwell floor — and those want a geometry that stays
// put: both bands wide enough to step through, and a gap between the rungs
// that a single load value can sit inside. Reading the shipped values here
// instead would let a retune silently reshape every scenario, and a scenario
// whose load values no longer straddle the rung they were written for can pass
// while testing nothing. Whether the shipped numbers are the right ones is a
// question about production traffic, decided where they are defined.
const ENGAGE_MULTI_ROW = 8;
const RELEASE_MULTI_ROW = 4;
const ENGAGE_ALL = 12;
const RELEASE_ALL = 6;
const MIN_DWELL_MS = 60_000;

function buildPolicy(opts: { load: () => number; now: () => number }) {
  return new LinkShapePolicy({
    readLoad: opts.load,
    now: opts.now,
    limit: 30,
    multiRowEngage: ENGAGE_MULTI_ROW,
    multiRowRelease: RELEASE_MULTI_ROW,
    allEngage: ENGAGE_ALL,
    allRelease: RELEASE_ALL,
    minDwellMs: MIN_DWELL_MS,
    heartbeatMs: 60_000,
  });
}

module(basename(import.meta.filename), function () {
  module('the link-shape ladder', function (hooks) {
    let load = 0;
    let clock = 0;
    let policy: LinkShapePolicy;
    let events: LinkShapePolicyEvent[];

    hooks.beforeEach(function () {
      load = 0;
      clock = 0;
      events = [];
      setLinkShapePolicySink((event) => events.push(event));
      policy = buildPolicy({ load: () => load, now: () => clock });
    });

    hooks.afterEach(function () {
      setLinkShapePolicySink(undefined);
    });

    // Every decision below is a multi-row read unless a test says otherwise,
    // so the level and the served mode move together and a level change is
    // visible in the response shape.
    function read(realm = REALM) {
      return policy.decide({
        realm,
        rowClass: 'multi-row',
        requested: 'full',
      });
    }

    test('a quiet fleet carries the closure', function (assert) {
      load = 1;
      let decision = read();
      assert.strictEqual(decision.level, 'full');
      assert.strictEqual(decision.mode, 'full');
      assert.strictEqual(
        decision.requested,
        decision.mode,
        'nothing was overruled',
      );
      assert.strictEqual(
        events.length,
        0,
        'a level that did not move is not a transition',
      );
    });

    test('a rising reading climbs one rung per consult', function (assert) {
      load = 20; // above both engage thresholds at once
      assert.strictEqual(
        read().level,
        'multi-row',
        'the first consult takes one rung, not the rung the reading alone would justify',
      );
      clock += MIN_DWELL_MS;
      assert.strictEqual(
        read().level,
        'all',
        'the next consult takes the second',
      );
      clock += MIN_DWELL_MS;
      assert.strictEqual(read().level, 'all', 'and there is no rung above it');
    });

    test('a reading inside the band holds the level', function (assert) {
      load = ENGAGE_ALL;
      read();
      clock += MIN_DWELL_MS;
      read();
      assert.strictEqual(policy.levelFor(REALM), 'all');

      // Between the release of `all` and the engage of `all`: neither
      // condition is met, so the level stands.
      load = RELEASE_ALL + 1;
      clock += MIN_DWELL_MS;
      assert.strictEqual(
        read().level,
        'all',
        'a reading below the engage but above the release does not release',
      );
      assert.strictEqual(
        events.filter((e) => e.changed).length,
        2,
        'and records no transition for standing still',
      );
    });

    test('the reading has to fall past the release to come back down', function (assert) {
      load = 20;
      read();
      clock += MIN_DWELL_MS;
      read();
      assert.strictEqual(policy.levelFor(REALM), 'all');

      load = RELEASE_ALL;
      clock += MIN_DWELL_MS;
      assert.strictEqual(read().level, 'multi-row', 'one rung back');
      load = RELEASE_MULTI_ROW;
      clock += MIN_DWELL_MS;
      assert.strictEqual(read().level, 'full', 'and then the other');
    });

    // The flap bound the design rests on: the mode is folded into two
    // validators and keys the card+json response cache, so each change costs a
    // realm its cached entries. A reading swung across the whole band as fast
    // as it can be swung must still not move the level faster than the dwell
    // floor permits.
    test('an oscillating reading cannot change level faster than the dwell floor', function (assert) {
      let ticks = 600;
      let stepMs = 1_000; // a full swing every second, for ten minutes
      for (let i = 0; i < ticks; i++) {
        load = i % 2 === 0 ? 30 : 0;
        read();
        clock += stepMs;
      }
      let changes = events.filter((e) => e.changed).length;
      let elapsedMs = ticks * stepMs;
      let ceiling = Math.ceil(elapsedMs / MIN_DWELL_MS) + 1;
      assert.ok(
        changes <= ceiling,
        `${changes} level changes over ${elapsedMs / 1000}s is within the ${ceiling} the dwell floor permits`,
      );
      assert.ok(
        changes > 0,
        'and the bound is doing work rather than the policy being inert',
      );
    });

    test('a single-row read keeps its closure while a multi-row read loses it', function (assert) {
      load = ENGAGE_MULTI_ROW;
      let single = policy.decide({
        realm: REALM,
        rowClass: 'single-row',
        requested: 'full',
      });
      assert.strictEqual(
        single.level,
        'multi-row',
        'the realm is on the first rung',
      );
      assert.strictEqual(
        single.mode,
        'full',
        'a read that cannot return more than one row still carries its closure',
      );

      clock += MIN_DWELL_MS;
      // Held at the same rung: the reading is inside the band.
      load = ENGAGE_MULTI_ROW;
      let multi = policy.decide({
        realm: REALM,
        rowClass: 'multi-row',
        requested: 'full',
      });
      assert.strictEqual(multi.level, 'multi-row', 'same rung');
      assert.strictEqual(
        multi.mode,
        'links-only',
        'a read that may return a page of rows sheds it',
      );
    });

    test('the top rung degrades a single-row read too', function (assert) {
      load = 20;
      read();
      clock += MIN_DWELL_MS;
      read();
      let single = policy.decide({
        realm: REALM,
        rowClass: 'single-row',
        requested: 'full',
      });
      assert.strictEqual(single.level, 'all');
      assert.strictEqual(single.mode, 'links-only');
    });

    test('a links-only preference is honoured at every level', function (assert) {
      load = 0;
      let decision = policy.decide({
        realm: REALM,
        rowClass: 'multi-row',
        requested: 'links-only',
      });
      assert.strictEqual(decision.level, 'full', 'the fleet is quiet');
      assert.strictEqual(
        decision.mode,
        'links-only',
        'the server never does more work than it was asked for',
      );
      assert.strictEqual(
        decision.requested,
        decision.mode,
        'and getting what you asked for is not a downgrade',
      );
    });

    test('a closure preference is overruled above the threshold, and both modes are reported', function (assert) {
      load = 20;
      read();
      clock += MIN_DWELL_MS;
      let decision = read();
      assert.strictEqual(
        decision.requested,
        'full',
        'what the caller asked for',
      );
      assert.strictEqual(decision.mode, 'links-only', 'what it was served');
      assert.strictEqual(
        decision.load,
        20,
        'the reading the decision was taken on',
      );
      assert.strictEqual(decision.rowClass, 'multi-row');
    });

    test('a federated read takes the most degraded of the realms it names', function (assert) {
      // Drive one realm to the top rung while the other stays quiet, by
      // consulting only the first.
      load = 20;
      read(REALM);
      clock += MIN_DWELL_MS;
      read(REALM);
      assert.strictEqual(policy.levelFor(REALM), 'all');

      // A fan-out naming both. The quiet realm advances on this read too, but
      // only by one rung, so the answer is the other realm's.
      let decision = policy.decideAcross({
        realms: [OTHER_REALM, REALM],
        rowClass: 'multi-row',
        requested: 'full',
      });
      assert.strictEqual(
        decision.level,
        'all',
        'the most degraded realm decides',
      );
      assert.strictEqual(decision.mode, 'links-only');
      assert.strictEqual(
        policy.levelFor(OTHER_REALM),
        'multi-row',
        'and the realm that was named advanced on a read it served',
      );
    });

    test('a fan-out naming no realms keeps its closure', function (assert) {
      load = 30;
      let decision = policy.decideAcross({
        realms: [],
        rowClass: 'multi-row',
        requested: 'full',
      });
      assert.strictEqual(decision.mode, 'full');
      assert.strictEqual(
        decision.level,
        null,
        'no realm was named, so no realm ladder was consulted',
      );
      assert.strictEqual(decision.load, null);
    });

    test('a transition records the realm, both levels, the threshold and the dwell', function (assert) {
      load = 20;
      read();
      clock += 90_000;
      read();

      let transitions = events.filter((e) => e.changed);
      assert.strictEqual(transitions.length, 2);

      assert.deepEqual(
        {
          channel: transitions[0].channel,
          realm: transitions[0].realm,
          previousLevel: transitions[0].previousLevel,
          level: transitions[0].level,
          threshold: transitions[0].threshold,
          thresholdKind: transitions[0].thresholdKind,
          dwellMs: transitions[0].dwellMs,
          load: transitions[0].load,
          limit: transitions[0].limit,
        },
        {
          channel: LINK_SHAPE_POLICY_CHANNEL,
          realm: REALM,
          previousLevel: 'full',
          level: 'multi-row',
          threshold: ENGAGE_MULTI_ROW,
          thresholdKind: 'engage',
          // A realm that has never left the level it started at reports no
          // dwell rather than a zero that would read as a flap.
          dwellMs: null,
          load: 20,
          limit: 30,
        },
        'the first transition',
      );

      assert.strictEqual(transitions[1].previousLevel, 'multi-row');
      assert.strictEqual(transitions[1].level, 'all');
      assert.strictEqual(transitions[1].threshold, ENGAGE_ALL);
      assert.strictEqual(
        transitions[1].dwellMs,
        90_000,
        'the time spent in the level being left',
      );
    });

    test('a release transition names the release threshold', function (assert) {
      load = 20;
      read();
      clock += MIN_DWELL_MS;
      load = RELEASE_MULTI_ROW;
      read();
      let last = events.filter((e) => e.changed).at(-1)!;
      assert.strictEqual(last.thresholdKind, 'release');
      assert.strictEqual(last.threshold, RELEASE_MULTI_ROW);
      assert.strictEqual(last.level, 'full');
    });

    test('a decision record is emitted even when nothing changed', function (assert) {
      load = 1;
      read();
      assert.strictEqual(
        events.length,
        0,
        'not on the first read — the cadence has not elapsed',
      );

      clock += 60_000;
      read();
      let heartbeats = events.filter((e) => !e.changed);
      assert.strictEqual(heartbeats.length, 1, 'one per cadence');
      assert.strictEqual(
        heartbeats[0].realm,
        null,
        'the heartbeat is per process',
      );
      assert.strictEqual(heartbeats[0].load, 1, 'carrying the reading it saw');
      assert.strictEqual(heartbeats[0].realmsAtFull, 1);
      assert.strictEqual(heartbeats[0].realmsAtMultiRow, 0);
      assert.strictEqual(heartbeats[0].realmsAtAll, 0);
    });

    test('the heartbeat counts realms at each level', function (assert) {
      load = 20;
      // Both realms take their first rung; neither read is far enough from
      // construction for the cadence to have elapsed.
      read(REALM);
      read(OTHER_REALM);
      assert.strictEqual(events.filter((e) => !e.changed).length, 0);

      // One cadence later, only REALM is read — so it takes the second rung
      // and OTHER_REALM stays on the first, which is the asymmetry that makes
      // the counts worth asserting. The heartbeat rides this read.
      clock += 60_000;
      read(REALM);

      let heartbeat = events.filter((e) => !e.changed).at(-1)!;
      assert.strictEqual(
        (heartbeat.realmsAtFull ?? 0) +
          (heartbeat.realmsAtMultiRow ?? 0) +
          (heartbeat.realmsAtAll ?? 0),
        2,
        'every realm this process has served is counted exactly once',
      );
      assert.strictEqual(
        heartbeat.realmsAtAll,
        1,
        'the realm that was read again',
      );
      assert.strictEqual(
        heartbeat.realmsAtMultiRow,
        1,
        'the realm that was not',
      );
      assert.strictEqual(heartbeat.realmsAtFull, 0);
    });
  });

  module('a pinned policy', function () {
    test('answers one shape whatever the load', function (assert) {
      let policy = LinkShapePolicy.pinned('links-only');
      let decision = policy.decide({
        realm: REALM,
        rowClass: 'single-row',
        requested: 'full',
      });
      assert.strictEqual(decision.mode, 'links-only');
      assert.strictEqual(
        decision.requested,
        'full',
        'the caller asked for the closure',
      );
      assert.strictEqual(
        decision.level,
        null,
        'and no ladder decided otherwise — a pinned policy consults none',
      );
      assert.strictEqual(decision.load, null);
    });

    test('a full pin still honours a links-only preference', function (assert) {
      let policy = LinkShapePolicy.pinned('full');
      let decision = policy.decide({
        realm: REALM,
        rowClass: 'multi-row',
        requested: 'links-only',
      });
      assert.strictEqual(
        decision.mode,
        'links-only',
        'so the two reasons a response can be links-only stay distinguishable',
      );
      assert.strictEqual(decision.level, null, 'still no ladder');
    });
  });

  module('threshold normalization', function () {
    // The reading counts requests and the cap counts the computations among
    // them, so a reading past the cap is ordinary whenever the live-search
    // cache coalesces, and a rung placed there is a real rung.
    test('an engage above the admission cap is honoured, not pulled under it', function (assert) {
      let load = 40;
      let policy = new LinkShapePolicy({
        readLoad: () => load,
        limit: 10,
        multiRowEngage: 50,
        allEngage: 60,
        minDwellMs: 0,
      });
      let read = () =>
        policy.decide({
          realm: REALM,
          rowClass: 'multi-row',
          requested: 'full',
        });
      assert.strictEqual(
        read().level,
        'full',
        'a reading of 40 is past the cap of 10 but short of the engage of 50',
      );
      load = 55;
      assert.strictEqual(
        read().level,
        'multi-row',
        'and the ladder engages once the reading reaches the configured rung',
      );
    });

    test('a release at or above its engage is pushed below it', function (assert) {
      let clock = 0;
      let policy = new LinkShapePolicy({
        readLoad: () => 10,
        now: () => clock,
        limit: 30,
        multiRowEngage: 8,
        multiRowRelease: 99, // would otherwise release the instant it engaged
        allEngage: 12,
        allRelease: 99,
        minDwellMs: 0,
      });
      let first = policy.decide({
        realm: REALM,
        rowClass: 'multi-row',
        requested: 'full',
      });
      assert.strictEqual(first.level, 'multi-row', 'it engaged');
      clock += 1_000;
      let second = policy.decide({
        realm: REALM,
        rowClass: 'multi-row',
        requested: 'full',
      });
      assert.strictEqual(
        second.level,
        'multi-row',
        'and did not immediately release itself',
      );
    });
  });

  module('reading the caller preference and the row class', function () {
    test('only the recognized opt-in reads as links-only', function (assert) {
      assert.strictEqual(requestedLinkShape('links-only'), 'links-only');
      assert.strictEqual(requestedLinkShape('  LINKS-ONLY '), 'links-only');
      assert.strictEqual(requestedLinkShape('closure'), 'full');
      assert.strictEqual(requestedLinkShape(''), 'full');
      assert.strictEqual(requestedLinkShape(null), 'full');
      assert.strictEqual(requestedLinkShape(undefined), 'full');
      assert.strictEqual(
        requestedLinkShape('links-only, full'),
        'full',
        'a value that is not exactly the opt-in is not the opt-in',
      );
    });

    test('a page bounded at one row is the only single-row class', function (assert) {
      assert.strictEqual(rowClassForPageSize(1), 'single-row');
      assert.strictEqual(
        rowClassForPageSize(0),
        'multi-row',
        'a page the clamp replaces with the server default is not bounded at one row',
      );
      assert.strictEqual(rowClassForPageSize(-1), 'multi-row');
      assert.strictEqual(rowClassForPageSize(2), 'multi-row');
      assert.strictEqual(rowClassForPageSize(100), 'multi-row');
      assert.strictEqual(
        rowClassForPageSize(undefined),
        'multi-row',
        'an absent page takes the server default, which is far above one',
      );
      assert.strictEqual(rowClassForPageSize(NaN), 'multi-row');
    });
  });

  module('the sustained request reading', function (hooks) {
    hooks.afterEach(function () {
      resetSearchAdmissionForTests();
    });

    test('is the time-weighted mean of the count, not the count', function (assert) {
      let clock = 0;
      let load = new SearchRequestLoad({
        halfLifeMs: 10_000,
        now: () => clock,
      });
      assert.strictEqual(load.sustained, 0, 'an idle process reads zero');

      load.begin();
      assert.strictEqual(load.inFlight, 1);
      assert.strictEqual(
        load.sustained,
        0,
        'a request that has only just started has contributed no time',
      );

      clock += 10_000; // one half-life held at 1
      assert.ok(
        Math.abs(load.sustained - 0.5) < 0.01,
        `after one half-life at 1 the reading is ~0.5, got ${load.sustained}`,
      );
    });

    test('a brief spike moves it far less than a sustained one', function (assert) {
      let clock = 0;
      function readingAfter(spikeMs: number, totalMs: number): number {
        clock = 0;
        let load = new SearchRequestLoad({
          halfLifeMs: 120_000,
          now: () => clock,
        });
        let ends = [];
        for (let i = 0; i < 30; i++) {
          ends.push(load.begin());
        }
        clock += spikeMs;
        for (let end of ends) {
          end();
        }
        clock += totalMs - spikeMs;
        return load.sustained;
      }
      // The same peak count, held for 5s against 10 minutes, over the same
      // wall clock. This is the separation the whole policy rests on: the
      // production record contains half-hours whose raw samples touch the
      // admission cap while their mean never leaves single digits.
      let brief = readingAfter(5_000, 600_000);
      let sustained = readingAfter(600_000, 600_000);
      assert.ok(
        brief < 1,
        `a 5s spike over 10 minutes leaves the reading under 1, got ${brief}`,
      );
      assert.ok(
        sustained > 25,
        `the same count held for 10 minutes reads above 25, got ${sustained}`,
      );
    });

    test('a quiet stretch decays the reading with nothing sampling it', function (assert) {
      let clock = 0;
      let load = new SearchRequestLoad({
        halfLifeMs: 10_000,
        now: () => clock,
      });
      let end = load.begin();
      clock += 100_000;
      // Reading here is what advances the accumulator — there is no timer.
      let loaded = load.sustained;
      assert.ok(loaded > 0.9, `held at 1 for ten half-lives, got ${loaded}`);

      end();
      clock += 100_000;
      assert.ok(
        load.sustained < 0.01,
        `and decays back toward zero unattended, got ${load.sustained}`,
      );
    });

    test('a request that ends twice is counted out once', function (assert) {
      let load = new SearchRequestLoad();
      let end = load.begin();
      load.begin();
      end();
      end();
      assert.strictEqual(
        load.inFlight,
        1,
        'a response that both finished and closed does not take another request with it',
      );
    });

    // Asserting only that a fresh gate reads 0 would pass against a reading
    // wired to nothing, since 0 is also the seed. The reading has to be made
    // non-zero through the module surface the policy actually calls.
    test('the module-level reading tracks the process request count', function (assert) {
      let clock = 0;
      setSearchAdmissionForTests({
        limit: 30,
        halfLifeMs: 10_000,
        now: () => clock,
      });
      assert.strictEqual(getSearchRequestLoad(), 0, 'idle to begin with');

      let end = beginSearchRequest();
      clock += 10_000; // one half-life held at 1
      let loaded = getSearchRequestLoad();
      assert.ok(
        Math.abs(loaded - 0.5) < 0.01,
        `the module reading followed the request count, got ${loaded}`,
      );

      end();
      clock += 100_000;
      assert.ok(getSearchRequestLoad() < 0.01, 'and follows it back down');
    });

    // The reading and the admission ceiling count different things, and the
    // difference is the whole point: a joiner hands its slot back as soon as
    // the live-search cache decides it is one, but it is still a request in
    // flight. A reading fed by slots would read the request count multiplied by
    // the cache's miss rate.
    test('is not moved by admission slots, which count computations', function (assert) {
      let clock = 0;
      setSearchAdmissionForTests({
        limit: 30,
        halfLifeMs: 10_000,
        now: () => clock,
      });
      let slot = admitSearchUnconditionally();
      clock += 100_000;
      assert.strictEqual(getSearchInFlight(), 1, 'a slot is held');
      assert.strictEqual(
        getSearchRequestLoad(),
        0,
        'but a slot alone is not a request the reading counts',
      );
      slot();
    });
  });
});
