/**
 * The gallery ⇄ demo crossing, driven through the real router — the hero
 * use case of docs/choreo-constructs.md §4.7, asserted end to end: the
 * timeline arms on routeWillChange, the region's pass populates the orphan
 * layer with exactly the flying cast, the landing is clean, and nothing is
 * left stranded at a seeded opacity. Everything visual is asserted on
 * COMPUTED style: the inline attribute is how a standing bug hid once.
 *
 * The waits ride the crossing's own lifecycle (crossingActive), never
 * animationsSettled(): the gallery is thirty live demos and several of
 * them — by design — never go idle.
 */
import { click, currentURL, visit, waitUntil } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import { module, test } from 'qunit';
import { crossingActive, resetCrossing } from 'test-app/lib/crossing';
import { setTempo } from 'test-app/lib/tempo';

/** the application region's own orphan layer, not some demo's */
const pageLayer = () => document.querySelector('.page > [data-choreo-orphans]');

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

module('Acceptance | crossing', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(function () {
    setTempo('smooth');
    resetCrossing();
  });
  hooks.afterEach(function () {
    resetCrossing();
  });

  test('opening a demo flies the card apart; the landing is clean', async function (assert) {
    await visit('/');
    await frames(6);

    await click(".card[data-demo='playhead'] .card-meta");
    await frames(3);
    assert.strictEqual(currentURL(), '/playhead', 'the route swapped');
    assert.true(crossingActive(), 'the timeline is armed for the pass');
    const aloft = pageLayer()!.children.length;
    assert.true(
      aloft >= 4,
      `the old card's pieces are aloft in the page's own layer (${aloft})`
    );
    // COMPUTED, and geometric: the flight may ride WAAPI, so the style
    // attribute is not evidence — the box actually travelling is
    const stage = document.querySelector<HTMLElement>('.stage-wrap')!;
    const before = stage.getBoundingClientRect().top;
    await frames(8);
    const after = stage.getBoundingClientRect().top;
    assert.true(
      Math.abs(after - before) > 1,
      `the receiving stage is travelling (${before.toFixed(1)} -> ${after.toFixed(1)})`
    );

    await waitUntil(() => !crossingActive(), { timeout: 8000 });
    await frames(4);
    assert.strictEqual(
      pageLayer()!.children.length,
      0,
      'every leaver and skin is dropped at the landing'
    );
    const landed = document.querySelector<HTMLElement>('.stage-wrap')!;
    assert.strictEqual(
      getComputedStyle(landed).opacity,
      '1',
      'the stage stands at full opacity'
    );
    assert.strictEqual(
      getComputedStyle(document.querySelector('.demo-head h1')!).opacity,
      '1',
      'the title landed'
    );
  });

  test('going home leaves nothing stranded at a seeded opacity', async function (assert) {
    await visit('/');
    await frames(6);
    await click(".card[data-demo='playhead'] .card-meta");
    await waitUntil(() => !crossingActive(), { timeout: 8000 });
    await frames(4);

    await click('.back-all');
    assert.strictEqual(currentURL(), '/', 'home again');
    await frames(3);
    assert.true(
      pageLayer()!.children.length >= 4,
      'the demo page is aloft on the way out'
    );

    await waitUntil(() => !crossingActive(), { timeout: 8000 });
    await frames(4);
    assert.strictEqual(pageLayer()!.children.length, 0, 'the layer empties');
    const hero = document.querySelector('.hero')!;
    assert.strictEqual(
      getComputedStyle(hero).opacity,
      '1',
      'the hero is back at full opacity — its custom exit did not strand it'
    );
    const faded = [...document.querySelectorAll<HTMLElement>('.card')].filter(
      (card) => getComputedStyle(card).opacity !== '1'
    );
    assert.deepEqual(
      faded.map((card) => card.dataset['demo']),
      [],
      'no card is left stranded below full opacity'
    );
    const stage = document.querySelector<HTMLElement>(
      ".card[data-demo='playhead'] .card-stage"
    )!;
    assert.strictEqual(
      getComputedStyle(stage).opacity,
      '1',
      'the card got its stage back, solid'
    );
  });

  test('instant means instant: no run, no orphans, and the route still changes', async function (assert) {
    setTempo('instant');
    await visit('/');
    await frames(6);

    await click(".card[data-demo='playhead'] .card-meta");
    assert.strictEqual(currentURL(), '/playhead', 'the route swapped at once');
    assert.false(crossingActive(), 'no timeline was ever armed');
    await frames(2);
    assert.strictEqual(
      pageLayer()!.children.length,
      0,
      'nothing is retained: no run means no leavers'
    );
    await frames(4);
    assert.strictEqual(
      getComputedStyle(document.querySelector('.stage-wrap')!).opacity,
      '1',
      'the page is simply there'
    );
  });

  test('demo to demo: the crossing runs and the pills hold their seat', async function (assert) {
    await visit('/playhead');
    await frames(6);

    const next = document.querySelector<HTMLElement>('.next-demo');
    if (!next) {
      assert.ok(true, 'no next demo to page to — nothing to assert');
      return;
    }
    await click('.next-demo');
    assert.true(crossingActive(), 'paging is a crossing too');
    await waitUntil(() => !crossingActive(), { timeout: 8000 });
    await frames(4);
    assert.strictEqual(pageLayer()!.children.length, 0, 'clean landing');
    assert.strictEqual(
      getComputedStyle(document.querySelector('.apis')!).opacity,
      '1',
      'the api pills stand'
    );
    assert.strictEqual(
      getComputedStyle(document.querySelector('.stage-wrap')!).opacity,
      '1',
      'the arriving stage stands'
    );
  });
});
