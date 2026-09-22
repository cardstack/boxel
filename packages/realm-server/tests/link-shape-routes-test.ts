import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import {
  DURING_PRERENDER_HEADER,
  LINK_SHAPE_ALL_ENGAGE_THRESHOLD,
  LINK_SHAPE_ALL_RELEASE_THRESHOLD,
  LINK_SHAPE_HEARTBEAT_MS,
  LINK_SHAPE_LOAD_HALF_LIFE_MS,
  LINK_SHAPE_MIN_DWELL_MS,
  LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD,
  LINK_SHAPE_MULTI_ROW_RELEASE_THRESHOLD,
  LinkShapePolicy,
  rri,
  SERVER_MAX_IN_FLIGHT_SEARCHES,
  setLinkShapePolicySink,
  setSearchShapeSink,
  SupportedMimeType,
  X_BOXEL_LINK_SHAPE_HEADER,
  type LinkShapePolicyEvent,
  type SearchShapeEvent,
} from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import {
  beginSearchRequest,
  buildLinkShapePolicy,
  getSearchRequestLoad,
  getSearchRequestsInFlight,
  resetSearchAdmissionForTests,
  setSearchAdmissionForTests,
} from '../search-inflight.ts';
import {
  setupPermissionedRealmCached,
  testRealmURLFor,
} from './helpers/index.ts';

// What the link-shape policy does to the routes it decides, as opposed to what
// it decides — `link-shape-policy-test.ts` covers the ladder itself.
//
// The three things the first module pins are the ones a shape change breaks
// quietly: the response validator has to describe the shape it was sent with,
// the card+json response cache must not serve one shape's body under the
// other's key, and prerendered output has to be untouched by any of it. Its
// realm is built over a load reading the module sets directly, which is what
// makes stepping the ladder read by read cheap — the reading is an input, so a
// test names the rung it wants and goes straight there.
//
// The second module gives that up to cover what an assigned reading cannot
// reach: where a real one comes from. It builds its realm's policy the way the
// realm server builds its own and moves the reading by putting load on the
// process's admission gate.

const realmURL = testRealmURLFor('link-shape/');

// The reading the fixture realm's policy sees. A test assigns it and the next
// read decides on it.
let load = 0;

// Dwell is off and the rungs are close together so a test can step the ladder
// read by read on an assigned reading. These are a fixture rather than the
// shipped values, like the ladder in `link-shape-policy-test.ts` — what a route
// has to show is that it follows whatever rung its realm is on, which is
// independent of where the rungs are set. The module below is where the shipped
// numbers appear, because reaching a rung from real load is the one thing that
// stops being true if a rung is set past what a process can reach.
function buildTestPolicy(): LinkShapePolicy {
  return new LinkShapePolicy({
    readLoad: () => load,
    limit: 30,
    multiRowEngage: 8,
    multiRowRelease: 4,
    allEngage: 12,
    allRelease: 6,
    minDwellMs: 0,
    // Far enough out that no heartbeat fires mid-test and lands in a log a
    // test is reading.
    heartbeatMs: 60 * 60 * 1000,
  });
}

function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  let fs: Record<string, string | LooseSingleCardDocument> = {};

  fs['target.gts'] = `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Target extends CardDef {
      @field name = contains(StringField);
    }
  `;

  fs['consumer.gts'] = `
    import { field, linksTo, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { contains } from "@cardstack/base/card-api";
    import { Target } from "./target";

    export class Consumer extends CardDef {
      @field name = contains(StringField);
      @field directLink = linksTo(() => Target);
    }
  `;

  fs['direct-target.json'] = {
    data: {
      attributes: { name: 'DT' },
      meta: { adoptsFrom: { module: rri('./target'), name: 'Target' } },
    },
  } as LooseSingleCardDocument;

  fs['consumer-1.json'] = {
    data: {
      attributes: { name: 'C1' },
      relationships: { directLink: { links: { self: './direct-target' } } },
      meta: { adoptsFrom: { module: rri('./consumer'), name: 'Consumer' } },
    },
  } as LooseSingleCardDocument;

  return fs;
}

// The link targets a response side-loaded. A card+json body's `included` is
// exactly the closure, but a card+html entry document also carries the entry's
// own resources there — so counting the array would count those too, and would
// read a response that side-loaded nothing as one that side-loaded two things.
function linkTargetsIn(included: { id?: string }[] | undefined): number {
  return (included ?? []).filter((resource) =>
    (resource.id ?? '').endsWith('/direct-target'),
  ).length;
}

// A card read is single-row, so only the top rung degrades it. Two reads at a
// reading above both engage thresholds take the realm up both rungs, since the
// ladder moves one rung per consult.
async function driveToTopRung(request: SuperTest<Test>, cardPath: string) {
  load = 20;
  await request.get(cardPath).set('Accept', SupportedMimeType.CardJson);
  await request.get(cardPath).set('Accept', SupportedMimeType.CardJson);
}

module(basename(import.meta.filename), function () {
  module('the shape a live read is served', function (hooks) {
    let request: SuperTest<Test>;
    let cardPath: string;

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
    }) {
      request = args.request;
      cardPath = `${new URL(args.testRealm.url).pathname}consumer-1`;
    }

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      linkShapePolicy: buildTestPolicy(),
      onRealmSetup,
    });

    // The realm — and so its policy, and so the realm's rung on the ladder —
    // is built once for the module, which is what makes these tests cheap.
    // Each test therefore starts by walking the ladder back down rather than
    // assuming where the last one left it. Two quiet reads are enough: the
    // ladder has three levels and moves one rung per read.
    hooks.beforeEach(async function () {
      load = 0;
      await request.get(cardPath).set('Accept', SupportedMimeType.CardJson);
      await request.get(cardPath).set('Accept', SupportedMimeType.CardJson);
    });

    test('a quiet fleet carries the closure and a saturated one does not', async function (assert) {
      let quiet = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(quiet.status, 200, `HTTP 200: ${quiet.text}`);
      assert.strictEqual(
        (quiet.body.included ?? []).length,
        1,
        'the link target is side-loaded',
      );

      await driveToTopRung(request, cardPath);
      let saturated = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(saturated.status, 200, `HTTP 200: ${saturated.text}`);
      assert.strictEqual(
        (saturated.body.included ?? []).length,
        0,
        'the same read under load side-loads nothing',
      );
      assert.ok(
        saturated.body.data.relationships?.directLink?.links?.self,
        'while still naming the target it declined to carry',
      );
    });

    test('the two shapes take different validators', async function (assert) {
      let quiet = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      let quietEtag = quiet.headers.etag;
      assert.ok(quietEtag, 'the closure response carries a validator');

      await driveToTopRung(request, cardPath);
      let saturated = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      let saturatedEtag = saturated.headers.etag;
      assert.ok(saturatedEtag, 'so does the degraded one');
      assert.notStrictEqual(
        quietEtag,
        saturatedEtag,
        'and they differ, because they describe different bytes at the same indexed_at',
      );
      assert.ok(
        saturatedEtag.includes('links-only'),
        `the degraded validator names its variant: ${saturatedEtag}`,
      );
    });

    // The failure this guards is silent in both directions: a client holding
    // the closure's validator would be 304'd back to a body it never had, and
    // one holding the degraded validator would be 304'd past a closure it now
    // wants.
    test('a validator from the other shape does not revalidate', async function (assert) {
      let quiet = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      let quietEtag = quiet.headers.etag;

      let revalidatedQuiet = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set('If-None-Match', quietEtag);
      assert.strictEqual(
        revalidatedQuiet.status,
        304,
        'the same shape still revalidates — the control for the assertion below',
      );

      await driveToTopRung(request, cardPath);
      let crossed = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set('If-None-Match', quietEtag);
      assert.strictEqual(
        crossed.status,
        200,
        'a closure validator does not match a degraded response',
      );
      assert.strictEqual(
        (crossed.body.included ?? []).length,
        0,
        'and the body it returns instead is the degraded one',
      );
    });

    // The card+json response cache is keyed on the validator, so the previous
    // test's guarantee is what keeps the two shapes in separate entries. This
    // asserts the consequence directly: crossing back must not hand back the
    // shape that was cached under the other key.
    test('neither shape is served from the other cache entry', async function (assert) {
      let quiet = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      let quietEtag = quiet.headers.etag;
      assert.strictEqual(
        (quiet.body.included ?? []).length,
        1,
        'closure first',
      );

      await driveToTopRung(request, cardPath);
      let degraded = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(
        (degraded.body.included ?? []).length,
        0,
        'then degraded, which populates an entry of its own',
      );

      // A card read is single-row, so it recovers its closure as soon as the
      // realm steps off the top rung.
      load = 0;
      let recovered = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(
        (recovered.body.included ?? []).length,
        1,
        'the closure comes back rather than the degraded body being retained under a shared key',
      );
      assert.strictEqual(
        recovered.headers.etag,
        quietEtag,
        'under the validator it had before, since the card itself never changed',
      );
    });

    test('a caller preference is honoured below the threshold', async function (assert) {
      let response = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set(X_BOXEL_LINK_SHAPE_HEADER, 'links-only');
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      assert.strictEqual(
        (response.body.included ?? []).length,
        0,
        'a caller that asked for less gets less even on a quiet fleet',
      );
      assert.ok(
        response.headers.etag.includes('links-only'),
        'and its validator describes the shape it was sent',
      );
    });

    // The same guarantee as the cross-shape revalidation above, reached the
    // other way: the shape changed because the caller asked, not because the
    // load did. Card+json is served `must-revalidate`, so this is the path a
    // client takes on every request once it holds a validator — and a `304`
    // here would hand back the closure body to a caller that asked not to have
    // it, which no amount of `Vary` would prevent.
    test('a stated preference does not revalidate against the other shape', async function (assert) {
      let closure = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      let closureEtag = closure.headers.etag;
      assert.strictEqual((closure.body.included ?? []).length, 1);

      let asked = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set(X_BOXEL_LINK_SHAPE_HEADER, 'links-only')
        .set('If-None-Match', closureEtag);
      assert.strictEqual(
        asked.status,
        200,
        'the validator it holds describes a shape it no longer wants',
      );
      assert.strictEqual(
        (asked.body.included ?? []).length,
        0,
        'so it is answered with the shape it asked for',
      );
    });

    test('an unrecognized preference reads as the closure', async function (assert) {
      let response = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set(X_BOXEL_LINK_SHAPE_HEADER, 'whatever-you-think-best');
      assert.strictEqual(
        (response.body.included ?? []).length,
        1,
        'the closure is what a caller gets when it has said nothing meaningful',
      );
    });

    // Prerender is excluded by construction: `resolveLinksOnly` is gated on
    // the during-prerender signal, so the prerender cache cannot carry a
    // policy's effects past a change.
    test('a prerender read is byte-identical across a policy change', async function (assert) {
      let quiet = await request
        .get(`${cardPath}?fields=item`)
        .set('Accept', SupportedMimeType.CardHtml)
        .set(DURING_PRERENDER_HEADER, 'true');
      assert.strictEqual(quiet.status, 200, `HTTP 200: ${quiet.text}`);

      await driveToTopRung(request, cardPath);
      let saturated = await request
        .get(`${cardPath}?fields=item`)
        .set('Accept', SupportedMimeType.CardHtml)
        .set(DURING_PRERENDER_HEADER, 'true');
      assert.strictEqual(saturated.status, 200, `HTTP 200: ${saturated.text}`);

      assert.strictEqual(
        saturated.text,
        quiet.text,
        'the prerender path never reaches the policy',
      );
      assert.strictEqual(
        saturated.headers.etag,
        quiet.headers.etag,
        'so its validator is unmoved too',
      );
    });

    // A live card+html item is the leg the host's selective refresh takes.
    // Left undegraded it would put back exactly the closure a degraded search
    // declined to send.
    test('a live card+html item follows the policy', async function (assert) {
      let quiet = await request
        .get(`${cardPath}?fields=item`)
        .set('Accept', SupportedMimeType.CardHtml);
      assert.strictEqual(quiet.status, 200, `HTTP 200: ${quiet.text}`);
      assert.strictEqual(
        linkTargetsIn(JSON.parse(quiet.text).included),
        1,
        'the closure is carried on a quiet fleet',
      );

      await driveToTopRung(request, cardPath);
      let saturated = await request
        .get(`${cardPath}?fields=item`)
        .set('Accept', SupportedMimeType.CardHtml);
      assert.strictEqual(
        linkTargetsIn(JSON.parse(saturated.text).included),
        0,
        'and dropped under load',
      );
      assert.notStrictEqual(
        saturated.headers.etag,
        quiet.headers.etag,
        'with its own validator, as the card+json leg has',
      );
    });
  });

  // The ladder over the reading the server itself decides on.
  //
  // The module above shows a response following the level its realm is held
  // at. What it cannot see is anything upstream of that level: whether a
  // search the server answers puts load on the reading the policy decides on,
  // whether the policy is wired to that reading at all, and whether the shipped
  // thresholds sit anywhere a process under load can reach. All three fail in
  // the same direction and none of them fails loudly — the ladder simply stays
  // at `full` — so a run reporting that nothing degraded reads identically
  // whether the policy declined or could never have engaged.
  //
  // This realm's policy is therefore constructed the way the realm server
  // constructs its own: over `getSearchRequestLoad`, against the admission
  // cap, at the thresholds and the dwell the server ships. The load is real
  // requests counted on the process's own request count. Only the clock is supplied,
  // because the reading is a two-minute mean and the dwell a minute — a test
  // that waited either out would not be runnable, and one that shortened them
  // would pin numbers nobody deploys.
  //
  // The thresholds are imported rather than restated, so these assertions
  // follow a retune instead of pinning one. That is deliberate: what they claim
  // is not that a rung sits at a particular number but that wherever it sits, a
  // real reading reaches it and the routes follow. The ladder's own behaviour
  // at a fixed pair of thresholds is `link-shape-policy-test.ts`, which
  // constructs its policy with explicit values and so describes the mechanism
  // rather than the tuning.
  module('the ladder over the process reading', function (hooks) {
    let request: SuperTest<Test>;
    let realmHref: string;
    let realmKey: string;
    let cardPath: string;
    let searchPath: string;

    // Monotonic across the module. Resetting it per test would push the
    // policy's dwell measurement backwards, which reads as a dwell not yet
    // served and blocks the very transitions these tests exist to take.
    let clock = 0;
    let held: (() => void)[] = [];
    let policyEvents: LinkShapePolicyEvent[] = [];

    // How close a mean gets to a count held across a span, as a fraction of
    // that count. Six half-lives is within 2%, which is what lets the slot
    // counts below be stated in whole searches rather than in fractions of
    // one.
    const SETTLE_HALF_LIVES = 6;
    const SETTLED_FRACTION = 1 - 2 ** -SETTLE_HALF_LIVES;

    // The fewest concurrent searches whose settled mean clears each engage.
    // Derived from the shipped thresholds rather than written down, so a
    // retune moves what these tests drive to instead of turning them red —
    // and each test asserts where its reading actually landed before it reads
    // anything, so a band too narrow to hold one of these fails with both
    // numbers in the message rather than silently exercising the wrong rung.
    const FIRST_RUNG_HOLD = Math.ceil(
      LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD / SETTLED_FRACTION,
    );
    const TOP_RUNG_HOLD = Math.ceil(
      LINK_SHAPE_ALL_ENGAGE_THRESHOLD / SETTLED_FRACTION,
    );

    // The construction the realm server runs under, not a copy of it. Building
    // an equivalent policy here would leave the wiring untested in exactly the
    // way that matters: a change that stopped the policy reading the admission
    // gate would leave a suite that supplied its own reading green. The clock
    // is the factory's only seam, and the reason for it is recorded there.
    //
    // Evaluated at module load, before any test has retuned the gate, so the
    // limit it takes is the one a fresh process starts with.
    const policy = buildLinkShapePolicy({ now: () => clock });

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
    }) {
      request = args.request;
      realmKey = args.testRealm.url;
      realmHref = new URL(args.testRealm.url).href;
      cardPath = `${new URL(args.testRealm.url).pathname}consumer-1`;
      searchPath = `${new URL(args.testRealm.url).pathname.replace(/\/$/, '')}/_search`;
    }

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      linkShapePolicy: policy,
      onRealmSetup,
    });

    // Put `count` search requests in flight on the process's request count, the
    // way the admission middleware counts them, hold them long enough for the
    // mean to all but catch up, and report where the reading landed — having first pinned it inside the band the
    // caller is aiming at.
    //
    // Every hold states its band, including the ones whose test would fail
    // anyway. A reading that missed its rung still fails, but it fails several
    // lines later as a level that is not the expected one, and that message
    // cannot tell a moved threshold from a broken ladder. Since the slot counts
    // are derived precisely so that the next retune walks into these tests, the
    // message it walks into should name both numbers.
    function hold(
      assert: Assert,
      count: number,
      band: { atLeast: number; below?: number },
    ): number {
      for (let i = 0; i < count; i++) {
        held.push(beginSearchRequest());
      }
      clock += SETTLE_HALF_LIVES * LINK_SHAPE_LOAD_HALF_LIFE_MS;
      let reading = getSearchRequestLoad();
      assert.ok(
        reading >= band.atLeast,
        `${count} concurrent searches read ${reading.toFixed(2)}, at or above ${band.atLeast}`,
      );
      if (band.below !== undefined) {
        assert.ok(
          reading < band.below,
          `and below ${band.below}, so this exercises the intended rung alone`,
        );
      }
      return reading;
    }

    // Hand every slot back and let the reading fall as far as it goes. Ten
    // half-lives leaves a thousandth of what was held, which is below any
    // release the thresholds can normalize to.
    function quiesce(): number {
      for (let release of held) {
        release();
      }
      held = [];
      clock += 10 * LINK_SHAPE_LOAD_HALF_LIFE_MS;
      return getSearchRequestLoad();
    }

    function cardRead() {
      return request.get(cardPath).set('Accept', SupportedMimeType.CardJson);
    }

    // A read whose result count is not bounded at one, which is the class the
    // lower rung degrades. The page is stated rather than left to the server
    // default so the classification this read takes is visible here.
    function multiRowSearch() {
      return request
        .post(searchPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({
          filter: {
            'item.on': { module: `${realmHref}consumer`, name: 'Consumer' },
          },
          fields: { entry: ['item'] },
          page: { size: 10 },
        });
    }

    // The same read at the realm-server's own fan-out endpoint, which is where
    // a deployment's live search traffic and this repo's load harness both
    // land. It reports a query-shape record, which the realm's own `_search`
    // route does not, so the tests that read one go through here.
    //
    // Every call asks a question no earlier call asked. This endpoint carries a
    // live-search cache, and a repeated query would be answered from it —
    // so each call here is a search that was actually decided and computed,
    // rather than one that inherited an earlier call's body.
    let federatedPage = 10;
    function federatedSearch() {
      return request
        .post('/_federated-search')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({
          filter: {
            'item.on': { module: `${realmHref}consumer`, name: 'Consumer' },
          },
          fields: { entry: ['item'] },
          page: { size: federatedPage++ },
          realms: [realmKey],
        });
    }

    // The policy is built once for the module, so each test inherits whatever
    // rung the last one left its realm on. The ladder moves only on a read and
    // only one rung at a time, so two reads over a reading at the floor cover
    // all three levels, with the shipped dwell between them.
    async function settleAtFull() {
      quiesce();
      for (let i = 0; i < 2; i++) {
        await cardRead();
        clock += LINK_SHAPE_MIN_DWELL_MS;
      }
    }

    hooks.beforeEach(async function (assert) {
      // A fresh gate at the shipped ceiling and the shipped half-life, reading
      // zero, over the clock these tests step.
      setSearchAdmissionForTests({
        limit: SERVER_MAX_IN_FLIGHT_SEARCHES,
        halfLifeMs: LINK_SHAPE_LOAD_HALF_LIFE_MS,
        now: () => clock,
      });
      setLinkShapePolicySink((event) => policyEvents.push(event));
      await settleAtFull();
      assert.strictEqual(
        policy.levelFor(realmKey),
        'full',
        'each test starts with the realm carrying its closure',
      );
      policyEvents = [];
    });

    hooks.afterEach(function () {
      quiesce();
      setLinkShapePolicySink(undefined);
      setSearchShapeSink(undefined);
      resetSearchAdmissionForTests();
    });

    // Everything else here rests on the reading being fed by the searches this
    // server answers. Asserting that a quiet realm reads zero would pass just
    // as well against a policy wired to nothing, so the reading has to be
    // moved by a request that went through the router.
    test('a search the server answers counts as a request on the reading the ladder decides on', async function (assert) {
      let inFlightWhileServing: number | null = null;
      let shapes: SearchShapeEvent[] = [];
      setSearchShapeSink((event) => {
        // The handler reports its shape with the response built and not yet
        // sent, which is the one moment the count can be read from inside a
        // request.
        inFlightWhileServing ??= getSearchRequestsInFlight();
        // The span this request stays in flight across, which is what the
        // reading integrates.
        clock += LINK_SHAPE_LOAD_HALF_LIFE_MS;
        shapes.push(event);
      });

      let response = await federatedSearch();
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      assert.strictEqual(shapes.length, 1, 'the search reported one shape');
      assert.ok(
        (inFlightWhileServing ?? 0) >= 1,
        `the search was counted as a request while it was being served, got ${inFlightWhileServing}`,
      );
      let reading = getSearchRequestLoad();
      assert.ok(
        reading > 0.4,
        `and one search held for one half-life moved the reading the policy decides on to ~0.5, got ${reading}`,
      );
    });

    // The question a run that never degraded cannot answer about itself. A
    // reading is a mean over minutes, so a process can be busy for a long time
    // and still read below a rung placed too high — in which case the ladder is
    // unreachable and nothing says so. The request count is not bounded by the
    // admission cap, so the top rung is stated against a number of concurrent
    // requests rather than against the cap.
    test('enough concurrent requests read above both rungs', function (assert) {
      let reading = hold(assert, TOP_RUNG_HOLD, {
        atLeast: LINK_SHAPE_ALL_ENGAGE_THRESHOLD,
      });
      assert.ok(
        reading > LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD,
        `and above the lower rung at ${LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD}`,
      );
      assert.ok(
        reading <= TOP_RUNG_HOLD,
        'while never exceeding the count it is a mean of',
      );
    });

    test('a real reading past the first engage degrades a multi-row read and spares a single-row one', async function (assert) {
      let reading = hold(assert, FIRST_RUNG_HOLD, {
        atLeast: LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD,
        below: LINK_SHAPE_ALL_ENGAGE_THRESHOLD,
      });

      let search = await multiRowSearch();
      assert.strictEqual(search.status, 200, `HTTP 200: ${search.text}`);
      assert.strictEqual(
        policy.levelFor(realmKey),
        'multi-row',
        'the read that crossed the threshold is the one that moved the realm',
      );
      assert.strictEqual(
        linkTargetsIn(search.body.included),
        0,
        'and is itself served without the closure',
      );

      let card = await cardRead();
      assert.strictEqual(card.status, 200, `HTTP 200: ${card.text}`);
      assert.strictEqual(
        linkTargetsIn(card.body.included),
        1,
        'while a read bounded at one row keeps it',
      );

      let [transition] = policyEvents.filter((event) => event.changed);
      assert.strictEqual(transition?.realm, realmKey);
      assert.strictEqual(transition?.level, 'multi-row');
      assert.strictEqual(transition?.thresholdKind, 'engage');
      assert.strictEqual(
        transition?.threshold,
        LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD,
        'the record names the shipped threshold the real reading crossed',
      );
      assert.strictEqual(
        transition?.load,
        reading,
        'and the reading on it is the one the gate reported, not a number reconstructed later',
      );
      assert.strictEqual(
        transition?.limit,
        SERVER_MAX_IN_FLIGHT_SEARCHES,
        'reported beside the cap the threshold sits under',
      );
    });

    test('a real reading past the top engage degrades a single-row read too', async function (assert) {
      hold(assert, TOP_RUNG_HOLD, { atLeast: LINK_SHAPE_ALL_ENGAGE_THRESHOLD });

      // One rung per read, so the realm takes two consults to reach the top.
      await cardRead();
      clock += LINK_SHAPE_MIN_DWELL_MS;
      await cardRead();
      assert.strictEqual(policy.levelFor(realmKey), 'all');

      let card = await cardRead();
      assert.strictEqual(card.status, 200, `HTTP 200: ${card.text}`);
      assert.strictEqual(
        linkTargetsIn(card.body.included),
        0,
        'the top rung sheds the closure from a read bounded at one row',
      );
      assert.ok(
        card.headers.etag.includes('links-only'),
        `and its validator describes the shape it was sent: ${card.headers.etag}`,
      );
    });

    // The dwell is what bounds how often a realm's cached validators are
    // thrown away. A reading far above both rungs is exactly the case that
    // would jump them in one step without it.
    test('the ladder cannot take both rungs without the dwell between them', async function (assert) {
      hold(assert, TOP_RUNG_HOLD, { atLeast: LINK_SHAPE_ALL_ENGAGE_THRESHOLD });

      await cardRead();
      assert.strictEqual(policy.levelFor(realmKey), 'multi-row');

      // No clock movement: the realm has held this level for nothing at all.
      await cardRead();
      assert.strictEqual(
        policy.levelFor(realmKey),
        'multi-row',
        'the second rung waits out the dwell however saturated the process is',
      );

      clock += LINK_SHAPE_MIN_DWELL_MS;
      await cardRead();
      assert.strictEqual(
        policy.levelFor(realmKey),
        'all',
        'and is taken once the dwell has been served',
      );
    });

    test('the closure comes back as the reading decays past the releases', async function (assert) {
      hold(assert, TOP_RUNG_HOLD, { atLeast: LINK_SHAPE_ALL_ENGAGE_THRESHOLD });
      await cardRead();
      clock += LINK_SHAPE_MIN_DWELL_MS;
      await cardRead();
      assert.strictEqual(policy.levelFor(realmKey), 'all');

      let reading = quiesce();
      assert.ok(
        reading < LINK_SHAPE_ALL_RELEASE_THRESHOLD,
        `an idle process reads ${reading.toFixed(3)}, under the top rung's release at ${LINK_SHAPE_ALL_RELEASE_THRESHOLD}`,
      );
      assert.ok(
        reading < LINK_SHAPE_MULTI_ROW_RELEASE_THRESHOLD,
        `and under the lower rung's at ${LINK_SHAPE_MULTI_ROW_RELEASE_THRESHOLD}`,
      );

      await cardRead();
      assert.strictEqual(policy.levelFor(realmKey), 'multi-row');
      clock += LINK_SHAPE_MIN_DWELL_MS;
      let card = await cardRead();
      assert.strictEqual(policy.levelFor(realmKey), 'full');
      assert.strictEqual(
        linkTargetsIn(card.body.included),
        1,
        'a single-row read carries its closure again',
      );

      let search = await multiRowSearch();
      assert.strictEqual(search.status, 200, `HTTP 200: ${search.text}`);
      assert.strictEqual(
        linkTargetsIn(search.body.included),
        1,
        'and so does a multi-row one',
      );
    });

    // The record that makes a quiet ladder legible. Without it a process whose
    // policy never engages is indistinguishable from one running no policy at
    // all, which is the ambiguity a load run cannot otherwise resolve.
    test('the heartbeat reports the process reading while nothing is changing', async function (assert) {
      hold(assert, FIRST_RUNG_HOLD, {
        atLeast: LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD,
        below: LINK_SHAPE_ALL_ENGAGE_THRESHOLD,
      });
      await multiRowSearch();
      assert.strictEqual(policy.levelFor(realmKey), 'multi-row');
      policyEvents = [];

      clock += LINK_SHAPE_HEARTBEAT_MS;
      let settled = getSearchRequestLoad();
      await multiRowSearch();
      assert.strictEqual(
        policy.levelFor(realmKey),
        'multi-row',
        'a reading inside the band leaves the realm where it is',
      );

      let [beat] = policyEvents.filter((event) => !event.changed);
      assert.ok(beat, 'and a decision that changed nothing still reports one');
      assert.strictEqual(
        beat?.load,
        settled,
        'carrying the reading it declined to act on',
      );
      assert.strictEqual(
        beat?.level,
        null,
        'with no realm or level of its own, because it is per process',
      );
      assert.strictEqual(beat?.realm, null);
      assert.strictEqual(
        beat?.realmsAtMultiRow,
        1,
        'and a count of the realms this process is holding at each level',
      );
      assert.strictEqual(beat?.realmsAtFull, 0);
      assert.strictEqual(beat?.realmsAtAll, 0);
    });

    // What a deployment has to read to tell a policy that declined from one
    // that never ran. The record is only evidence if the reading on it is the
    // process's own.
    test('a degraded search reports the real reading and the level it was decided at', async function (assert) {
      let reading = hold(assert, FIRST_RUNG_HOLD, {
        atLeast: LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD,
        below: LINK_SHAPE_ALL_ENGAGE_THRESHOLD,
      });
      let shapes: SearchShapeEvent[] = [];
      setSearchShapeSink((event) => shapes.push(event));

      let response = await federatedSearch();
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      let [shape] = shapes;
      assert.strictEqual(shape?.linkMode, 'links-only', 'what was served');
      assert.strictEqual(
        shape?.requestedLinkMode,
        'full',
        'against what the caller asked for',
      );
      assert.true(shape?.linkModeDowngraded, 'which is the override recorded');
      assert.strictEqual(shape?.linkShapeLevel, 'multi-row');
      assert.strictEqual(
        shape?.linkShapeLoad,
        reading,
        'and the reading on the record is the one the gate reported',
      );
    });
  });
});
