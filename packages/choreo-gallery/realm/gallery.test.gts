// The gallery shell, rendered the way the host renders it.
//
// `boxel test` stamps the scoped-CSS attribute and delivers no stylesheet, so
// nothing here asserts a computed style: what the shell controls is which
// page is showing, what links where, and what it leaves alone in the host.
import { setupChoreo } from '@cardstack/choreo/test-support';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { click, waitFor } from '@ember/test-helpers';
import { getService } from '@universal-ember/test-support';
import { motionSpeed } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { GalleryDemo, WalkthroughStep } from './demo';
import { ChoreoGallery } from './gallery';
import { setTempo } from './lib/tempo';

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function one(selector: string): HTMLElement | null {
  return root().querySelector<HTMLElement>(selector);
}
function tiles(): string[] {
  return Array.from(
    root().querySelectorAll<HTMLElement>('[data-gallery-tile]'),
  ).map((tile) => tile.dataset.galleryTile!);
}

function demo(
  slug: string,
  group: string,
  extra: Record<string, unknown> = {},
) {
  return new GalleryDemo({
    slug,
    title: `Title ${slug}`,
    group,
    lede: `Lede ${slug}`,
    apis: [`${slug}()`],
    sample: `<div class='${slug}'></div>`,
    slowmo: false,
    theater: false,
    ...extra,
  });
}

function catalog() {
  return [
    demo('alpha', 'Animate'),
    demo('bravo', 'Layout', { slowmo: true }),
    demo('charlie', 'Layout'),
    demo('delta', 'Timeline', {
      walkthrough: [
        new WalkthroughStep({
          label: 'The score',
          note: 'Why it is shaped so.',
          source: 'score()',
        }),
      ],
    }),
  ];
}

async function renderGallery(demos = catalog()) {
  let loader = getService('loader-service').loader;
  let gallery = new ChoreoGallery({ demos });
  await renderCard(loader, gallery, 'isolated');
  await animationsSettled();
}

/** the element the gallery scrolls in, as the crossing finds it */
function scroller(): HTMLElement {
  let node = one('[data-choreo-site]')?.parentElement ?? null;
  while (node) {
    let { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement as HTMLElement;
}

function chip(label: string): HTMLButtonElement {
  return Array.from(root().querySelectorAll<HTMLButtonElement>('.chip')).find(
    (button) => button.textContent?.trim() === label,
  )!;
}

function speed(label: string): HTMLButtonElement {
  return Array.from(
    root().querySelectorAll<HTMLButtonElement>('.speeds button'),
  ).find((button) => button.textContent?.trim() === label)!;
}

module('Choreo gallery | site', function (hooks) {
  setupCardTest(hooks);
  setupChoreo(hooks);

  hooks.afterEach(function () {
    setTempo('smooth');
  });

  test('renders the frame and every demo, in catalog order', async function (assert) {
    await renderGallery();

    assert.ok(one('[data-choreo-site]'), 'the gallery root is there');
    assert.ok(one('[data-gallery-brand]'), 'the brand links home');
    assert.deepEqual(
      tiles(),
      ['alpha', 'bravo', 'charlie', 'delta'],
      'one tile per linked demo, in the order the card links them',
    );
    assert.strictEqual(
      root().querySelectorAll('[data-stage-pending]').length,
      4,
      'a demo with no stage of its own shows the pending stage',
    );
  });

  test('a group filter narrows the grid', async function (assert) {
    await renderGallery();

    let layout = Array.from(
      root().querySelectorAll<HTMLButtonElement>('.chip'),
    ).find((chip) => chip.textContent?.trim() === 'Layout')!;
    await click(layout);
    await animationsSettled();

    assert.deepEqual(tiles(), ['bravo', 'charlie'], 'only Layout demos stay');
    assert.strictEqual(layout.getAttribute('aria-pressed'), 'true');
  });

  test('a tile opens its demo page, and the brand comes back', async function (assert) {
    let title = document.title;
    let href = location.href;
    await renderGallery();

    await click('[data-gallery-tile="bravo"] .card-meta');
    await waitFor('[data-demo="bravo"]');
    await animationsSettled();

    assert.strictEqual(one('h1')?.textContent?.trim(), 'Title bravo');
    assert.deepEqual(tiles(), [], 'the grid has left');
    assert.ok(one('.speeds'), 'a slow-mo demo gets the speed control');
    assert.strictEqual(document.title, title, 'the host title is untouched');
    assert.strictEqual(location.href, href, 'the host URL is untouched');

    await click('[data-gallery-brand]');
    await waitFor('[data-gallery-tile]');
    await animationsSettled();

    assert.deepEqual(tiles(), ['alpha', 'bravo', 'charlie', 'delta']);
    assert.strictEqual(location.href, href, 'still the host URL');
  });

  test('the demo page pages through the catalog', async function (assert) {
    setTempo('instant');
    await renderGallery();

    await click('[data-gallery-tile="charlie"] .card-meta');
    await waitFor('[data-demo="charlie"]');
    assert.notOk(one('.speeds'), 'no speed control without slow-mo');

    await click('.next-demo');
    await waitFor('[data-demo="delta"]');
    await animationsSettled();
    assert.strictEqual(one('h1')?.textContent?.trim(), 'Title delta');
    assert.ok(one('.walk'), 'a demo with a walkthrough quotes it');
    assert.notOk(one('.next-demo'), 'the last demo has no next');

    await click('[data-gallery-home]');
    await waitFor('[data-gallery-tile]');
    assert.deepEqual(tiles(), ['alpha', 'bravo', 'charlie', 'delta']);
  });

  test('a filter leaves the scroll where it is, after a trip to a demo and back', async function (assert) {
    // enough tiles that the gallery scrolls
    let many = Array.from({ length: 24 }, (_, i) =>
      demo(`demo-${i}`, i % 2 ? 'Layout' : 'Animate'),
    );
    await renderGallery(many);
    let container = scroller();
    container.style.height = '400px';
    assert.ok(
      container.scrollHeight > container.clientHeight + 200,
      'the gallery scrolls',
    );

    container.scrollTop = 200;
    await click('[data-gallery-tile="demo-3"] .card-meta');
    await waitFor('[data-demo="demo-3"]');
    await animationsSettled();
    await click('[data-gallery-brand]');
    await waitFor('[data-gallery-tile]');
    await animationsSettled();
    assert.strictEqual(container.scrollTop, 200, 'the trip home restores it');

    container.scrollTop = 80;
    await click(chip('Layout'));
    await animationsSettled();
    await click(chip('All'));
    await animationsSettled();
    assert.strictEqual(container.scrollTop, 80, 'filtering does not move it');
  });

  test('a speed picked on one demo ends with it', async function (assert) {
    setTempo('instant');
    await renderGallery([
      demo('alpha', 'Animate', { slowmo: true }),
      demo('bravo', 'Animate', { slowmo: true }),
    ]);

    await click('[data-gallery-tile="alpha"] .card-meta');
    await waitFor('[data-demo="alpha"]');
    await click(speed('÷10'));
    assert.strictEqual(motionSpeed(), 10, 'the clock runs at a tenth');

    await click('.next-demo');
    await waitFor('[data-demo="bravo"]');
    assert.strictEqual(motionSpeed(), 1, 'the next demo starts at full speed');
    assert.strictEqual(
      speed('Full').getAttribute('aria-pressed'),
      'true',
      'and its picker says so',
    );

    await click(speed('÷5'));
    let loader = getService('loader-service').loader;
    await renderCard(loader, demo('charlie', 'Animate'), 'isolated');
    assert.strictEqual(
      motionSpeed(),
      1,
      'closing the demo puts the clock back for the rest of the host',
    );
  });
});

module('Choreo gallery | formats', function (hooks) {
  setupCardTest(hooks);
  setupChoreo(hooks);

  test('a demo card on its own is its page, without the gallery around it', async function (assert) {
    let loader = getService('loader-service').loader;
    await renderCard(loader, demo('echo', 'Choreo'), 'isolated');

    assert.strictEqual(one('h1')?.textContent?.trim(), 'Title echo');
    assert.ok(one('[data-stage-pending]'), 'the pending stage');
    assert.ok(
      root().textContent?.includes("<div class='echo'></div>"),
      'the usage example',
    );
    assert.notOk(one('[data-gallery-home]'), 'no way back to a gallery');
    assert.notOk(one('.pager'), 'no pager');
  });

  test('a new demo card with no code yet still renders', async function (assert) {
    let loader = getService('loader-service').loader;
    await renderCard(
      loader,
      new GalleryDemo({
        slug: 'blank',
        title: 'Blank',
        walkthrough: [new WalkthroughStep({ label: 'Empty step' })],
      }),
      'isolated',
    );

    assert.strictEqual(one('h1')?.textContent?.trim(), 'Blank');
    assert.strictEqual(
      root().querySelectorAll('.sample').length,
      2,
      'the usage example and the walkthrough step render empty',
    );
  });

  test('the gallery embeds as a summary, not the whole site', async function (assert) {
    let loader = getService('loader-service').loader;
    await renderCard(
      loader,
      new ChoreoGallery({ demos: catalog() }),
      'embedded',
    );

    assert.ok(root().textContent?.includes('4 demos'));
    assert.notOk(one('[data-gallery-tile]'), 'no live grid');
    assert.notOk(one('[data-gallery-brand]'), 'no site frame');
  });
});
