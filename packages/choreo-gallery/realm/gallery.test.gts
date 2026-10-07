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

async function renderGallery() {
  let loader = getService('loader-service').loader;
  let gallery = new ChoreoGallery({ demos: catalog() });
  await renderCard(loader, gallery, 'isolated');
  await animationsSettled();
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
