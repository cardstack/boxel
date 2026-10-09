/**
 * The gallery ⇄ demo crossing, driven through the gallery card — the hero
 * use case of docs/choreo-constructs.md §4.7, asserted end to end: the
 * timeline arms when a tile is followed, the region's pass populates the
 * orphan layer with exactly the flying cast, the landing is clean, and
 * nothing is left stranded at a seeded opacity. Everything visual is
 * asserted on COMPUTED style: the inline attribute is how a standing bug hid
 * once.
 *
 * The waits ride the crossing's own lifecycle (crossingActive), never
 * animationsSettled(): the gallery is dozens of live demos and several of
 * them — by design — never go idle.
 */
import { click, waitUntil } from '@ember/test-helpers';

import { liveAll } from '@cardstack/choreo/test-support';
import { module, test } from 'qunit';

import { choreoGalleryContents } from '../helpers/choreo-gallery';
import {
  frames,
  setupChoreoGalleryTest,
} from '../helpers/choreo-gallery-stage';
import { renderCard } from '../helpers/render-component';

import type * as DemoModule from '../../../choreo-gallery/realm/demo';
import type * as GalleryModule from '../../../choreo-gallery/realm/gallery';
import type * as TempoModule from '../../../choreo-gallery/realm/lib/tempo';

interface Instance {
  data: {
    attributes: Record<string, unknown> & {
      lesson?: Record<string, unknown>;
      walkthrough?: Record<string, unknown>[];
    };
    meta: { adoptsFrom: { module: string; name: string } };
    relationships?: Record<string, { links: { self: string } }>;
  };
}

const CONTENTS = choreoGalleryContents();
const instance = (path: string) =>
  JSON.parse(CONTENTS[path] as string) as Instance;

/** the demos the gallery's index links, in the order it links them */
const LINKED = Object.entries(instance('index.json').data.relationships ?? {})
  .map(([key, { links }]) => ({
    at: Number(/^demos\.(\d+)$/.exec(key)?.[1] ?? NaN),
    slug: links.self.replace(/^\.\/demos\//, ''),
  }))
  .filter(({ at }) => !Number.isNaN(at))
  .sort((a, b) => a.at - b.at)
  .map(({ slug }) => slug);

/** the site frame's own region — the page — not some demo's */
const PAGE = '.page-shell > [data-choreo]';

/** the page region's own orphan layer, not some demo's */
const pageLayer = () =>
  document.querySelector(`${PAGE} > [data-choreo-orphans]`);

/**
 * The site frame renders the crossing's timeline into its region only while
 * a crossing is armed, so the timeline standing in the region IS the armed
 * flag.
 */
const crossingActive = () =>
  Boolean(document.querySelector(`${PAGE} > [data-choreo-block]`));

/** the demo page standing in the page, as opposed to a leaving copy of it */
const demoPageOf = (slug: string) =>
  liveAll(`.demo-head[data-demo='${slug}']`).length > 0;

const tileOf = (el: HTMLElement) => el.dataset['galleryTile'];

module('Integration | Choreo gallery | crossing', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);

  async function setTempo(tempo: TempoModule.Tempo) {
    let tempoModule = await gallery.import<typeof TempoModule>('lib/tempo');
    tempoModule.setTempo(tempo);
  }

  /** the gallery card, built from the realm's own index and demo instances */
  async function renderGallery() {
    let { DemoLesson, WalkthroughStep } =
      await gallery.import<typeof DemoModule>('demo');
    let demos = await Promise.all(
      LINKED.map(async (slug) => {
        let { data } = instance(`demos/${slug}.json`);
        let { module, name } = data.meta.adoptsFrom;
        let classes = await gallery.import<
          Record<string, new (attrs: object) => DemoModule.GalleryDemo>
        >(module.replace(/^\.\.\//, ''));
        let { lesson, walkthrough, ...attributes } = data.attributes;
        return new classes[name]!({
          ...attributes,
          lesson: lesson ? new DemoLesson(lesson) : undefined,
          walkthrough: (walkthrough ?? []).map(
            (step) => new WalkthroughStep(step),
          ),
        });
      }),
    );
    let { ChoreoGallery } =
      await gallery.import<typeof GalleryModule>('gallery');
    await renderCard(gallery.loader, new ChoreoGallery({ demos }), 'isolated');
  }

  hooks.beforeEach(async function () {
    await setTempo('smooth');
  });
  hooks.afterEach(async function () {
    await setTempo('smooth');
  });

  test('opening a demo flies the card apart; the landing is clean', async function (assert) {
    await renderGallery();
    await frames(6);

    await click("[data-gallery-tile='playhead'] .card-meta");
    await frames(3);
    assert.true(demoPageOf('playhead'), 'the route swapped');
    assert.true(crossingActive(), 'the timeline is armed for the pass');
    const aloft = pageLayer()!.children.length;
    assert.true(
      aloft >= 4,
      `the old card's pieces are aloft in the page's own layer (${aloft})`,
    );
    // COMPUTED, and geometric: the flight may ride WAAPI, so the style
    // attribute is not evidence — the box actually travelling is
    const stage = document.querySelector<HTMLElement>('.stage-wrap')!;
    const before = stage.getBoundingClientRect().top;
    await frames(8);
    const after = stage.getBoundingClientRect().top;
    assert.true(
      Math.abs(after - before) > 1,
      `the receiving stage is travelling (${before.toFixed(1)} -> ${after.toFixed(1)})`,
    );

    await waitUntil(() => !crossingActive(), { timeout: 8000 });
    await frames(4);
    assert.strictEqual(
      pageLayer()!.children.length,
      0,
      'every leaver and skin is dropped at the landing',
    );
    const landed = document.querySelector<HTMLElement>('.stage-wrap')!;
    assert.strictEqual(
      getComputedStyle(landed).opacity,
      '1',
      'the stage stands at full opacity',
    );
    assert.strictEqual(
      getComputedStyle(document.querySelector('.demo-head h1')!).opacity,
      '1',
      'the title landed',
    );
  });

  test('going home leaves nothing stranded at a seeded opacity', async function (assert) {
    await renderGallery();
    await frames(6);
    // the gallery AT REST, tile by tile: the flight is measured against
    // each card's own height, not against its neighbours'. Cards differ
    // in height by design — a long lede is a taller row — so comparing
    // tiles to each other only asserts that the copy is evenly cut.
    const restHeights = new Map(
      [...document.querySelectorAll<HTMLElement>('.card')].map((el) => [
        tileOf(el),
        el.offsetHeight,
      ]),
    );
    await click("[data-gallery-tile='playhead'] .card-meta");
    await waitUntil(() => !crossingActive(), { timeout: 8000 });
    await frames(4);

    await click('.back-all');
    assert.strictEqual(
      liveAll('[data-gallery-tile]').length,
      LINKED.length,
      'home again',
    );
    await frames(3);
    assert.true(
      pageLayer()!.children.length >= 4,
      'the demo page is aloft on the way out',
    );
    // the flight must not lean on the grid: a receiver animating its
    // LAYOUT size stretches its whole row mid-crossing (the stretched-
    // gallery screenshot). Shape-matching rides transform scale instead,
    // which leaves layout alone — so every tile still stands at the
    // height it had at rest.
    const stretched = [...document.querySelectorAll<HTMLElement>('.card')]
      .map((el) => ({
        demo: tileOf(el),
        rest: restHeights.get(tileOf(el)) ?? 0,
        now: el.offsetHeight,
      }))
      .filter((c) => Math.abs(c.now - c.rest) >= 8);
    assert.deepEqual(
      stretched.map((c) => `${c.demo} ${c.rest}->${c.now}`),
      [],
      'no card stretches under the flight',
    );
    // mid-flight only the counterpart tile is lit; every unmatched card
    // HOLDS its hidden pose — dark, not entering — until the settle
    const lit = [...document.querySelectorAll<HTMLElement>('.card')].filter(
      (el) => getComputedStyle(el).opacity !== '0',
    );
    assert.deepEqual(
      lit.map(tileOf),
      ['playhead'],
      'only the counterpart tile is visible under the flight',
    );
    // the stages hold empty for the span — booting every demo inside the
    // pass is the heaviest render in the gallery — EXCEPT the
    // counterpart's: the skin dissolves over it, and a dissolve needs
    // something real underneath
    const boarded = [
      ...document.querySelectorAll<HTMLElement>('.card-stage'),
    ].filter((el) => el.children.length > 0);
    assert.deepEqual(
      boarded.map((el) => {
        const card = el.closest<HTMLElement>('.card');
        return card ? tileOf(card) : undefined;
      }),
      ['playhead'],
      'only the tile the flight lands on is alive mid-crossing',
    );

    await waitUntil(() => !crossingActive(), { timeout: 8000 });
    await frames(4);
    assert.strictEqual(pageLayer()!.children.length, 0, 'the layer empties');
    const hero = document.querySelector('.hero')!;
    assert.strictEqual(
      getComputedStyle(hero).opacity,
      '1',
      'the hero is back at full opacity — its custom exit did not strand it',
    );
    // the unmatched tiles enter AFTER the landing, by design — a spring
    // each — so give the entrances their moment, then demand full opacity
    await waitUntil(
      () =>
        [...document.querySelectorAll<HTMLElement>('.card')].every(
          (card) => getComputedStyle(card).opacity === '1',
        ),
      { timeout: 4000 },
    );
    const faded = [...document.querySelectorAll<HTMLElement>('.card')].filter(
      (card) => getComputedStyle(card).opacity !== '1',
    );
    assert.deepEqual(
      faded.map(tileOf),
      [],
      'every tile has entered — none left stranded below full opacity',
    );
    const stage = document.querySelector<HTMLElement>(
      "[data-gallery-tile='playhead'] .card-stage",
    )!;
    assert.strictEqual(
      getComputedStyle(stage).opacity,
      '1',
      'the card got its stage back, solid',
    );
    assert.true(
      stage.children.length > 0,
      'the landing brings the demos alive',
    );
    // none of the crossing's own participants wears leftover inline
    // geometry: a stranded width/height stretches the card — and the
    // whole grid row with it
    const sized = [
      ...document.querySelectorAll<HTMLElement>(
        '.card, .card-stage, .card-title, .card-lede, .card-group, .hero',
      ),
    ]
      .filter((el) => el.style.width !== '' || el.style.height !== '')
      .map(
        (el) =>
          `${el.className.toString().split(' ')[0]}[w=${el.style.width};h=${el.style.height}]`,
      );
    assert.deepEqual(sized, [], 'no inline geometry strands on participants');
    const layoutHeights = [
      ...document.querySelectorAll<HTMLElement>('.card-stage'),
    ].map((el) => Math.round(el.offsetHeight));
    assert.true(
      Math.max(...layoutHeights) - Math.min(...layoutHeights) < 8,
      `every stage keeps its stylesheet height (${Math.min(...layoutHeights)}..${Math.max(...layoutHeights)})`,
    );
  });

  test('two round trips in a row leave the grid exactly as it was', async function (assert) {
    await renderGallery();
    await frames(6);
    const rest = [...document.querySelectorAll<HTMLElement>('.card')].map(
      (el) => Math.round(el.offsetHeight),
    );

    for (let trip = 0; trip < 2; trip++) {
      await click("[data-gallery-tile='inbox'] .card-meta");
      await waitUntil(() => !crossingActive(), { timeout: 8000 });
      await frames(4);
      await click('.back-all');
      await waitUntil(() => !crossingActive(), { timeout: 8000 });
      await frames(6);
    }

    const after = [...document.querySelectorAll<HTMLElement>('.card')].map(
      (el) => Math.round(el.offsetHeight),
    );
    assert.deepEqual(
      after,
      rest,
      'every card stands at its resting layout height',
    );
    // identity spellings (transform: none, scale(1)…) are rest — the
    // engine writes them and they are harmless; real residue is a size
    const stage = document.querySelector<HTMLElement>(
      "[data-gallery-tile='inbox'] .card-stage",
    )!;
    assert.strictEqual(
      `${stage.style.width}|${stage.style.height}`,
      '|',
      `the returned stage wears no inline size — got '${(stage.getAttribute('style') ?? '').slice(0, 120)}'`,
    );
    await frames(2);
  });

  test('instant means instant: no run, no orphans, and the route still changes', async function (assert) {
    await setTempo('instant');
    await renderGallery();
    await frames(6);

    await click("[data-gallery-tile='playhead'] .card-meta");
    assert.true(demoPageOf('playhead'), 'the route swapped at once');
    assert.false(crossingActive(), 'no timeline was ever armed');
    await frames(2);
    assert.strictEqual(
      pageLayer()!.children.length,
      0,
      'nothing is retained: no run means no leavers',
    );
    await frames(4);
    assert.strictEqual(
      getComputedStyle(document.querySelector('.stage-wrap')!).opacity,
      '1',
      'the page is simply there',
    );
  });

  test('demo to demo: the crossing runs and the pills hold their seat', async function (assert) {
    await renderGallery();
    await frames(6);
    await click("[data-gallery-tile='playhead'] .card-meta");
    await waitUntil(() => !crossingActive(), { timeout: 8000 });
    await frames(6);

    // the playhead is the first demo the gallery links, so it has a next
    assert.ok(
      document.querySelector('.next-demo'),
      'there is a next demo to page to',
    );
    await click('.next-demo');
    assert.true(crossingActive(), 'paging is a crossing too');
    await waitUntil(() => !crossingActive(), { timeout: 8000 });
    await frames(4);
    assert.strictEqual(pageLayer()!.children.length, 0, 'clean landing');
    assert.strictEqual(
      getComputedStyle(document.querySelector('.apis')!).opacity,
      '1',
      'the api pills stand',
    );
    assert.strictEqual(
      getComputedStyle(document.querySelector('.stage-wrap')!).opacity,
      '1',
      'the arriving stage stands',
    );
  });
});
