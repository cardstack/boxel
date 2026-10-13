// The gallery shell, rendered the way the host renders it.
//
// `boxel test` stamps the scoped-CSS attribute and delivers no stylesheet, so
// nothing here asserts a computed style or anything that rests on layout (a
// tile boots its stage only once it measures room for one): what the shell
// controls is what each page shows, what links where, and what it leaves
// alone in the host. Opening a demo card is the host's, and the host's own
// suite covers it, with the tile's stage.
import { setupChoreo } from '@cardstack/choreo/test-support';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { click, render } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { getService } from '@universal-ember/test-support';
import { motionSpeed } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { GalleryDemo, WalkthroughStep } from './demo';
import { ChoreoGallery } from './gallery';
import { Theater } from './lib/theater';
import { DemoPage } from './shell/demo-page';

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

  test('renders the frame and every demo as a tile, in catalog order', async function (assert) {
    await renderGallery();

    assert.ok(one('[data-choreo-site]'), 'the gallery root is there');
    assert.ok(one('.topbar .brand'), 'the brand heads the site');
    assert.notStrictEqual(
      one('.topbar .brand')?.tagName,
      'A',
      'and is no link: the way back to the gallery is the host’s',
    );
    assert.deepEqual(
      tiles(),
      ['alpha', 'bravo', 'charlie', 'delta'],
      'one tile per linked demo, in the order the card links them',
    );
  });

  test('a group filter narrows the grid', async function (assert) {
    await renderGallery();

    await click(chip('Layout'));
    await animationsSettled();

    assert.deepEqual(tiles(), ['bravo', 'charlie'], 'only Layout demos stay');
    assert.strictEqual(chip('Layout').getAttribute('aria-pressed'), 'true');
  });

  test('a click on a tile leaves the host’s URL and title alone', async function (assert) {
    let title = document.title;
    let href = location.href;
    await renderGallery();

    await click('[data-gallery-tile="bravo"] .tile-title');

    assert.strictEqual(document.title, title, 'the host title is untouched');
    assert.strictEqual(location.href, href, 'the host URL is untouched');
    assert.deepEqual(
      tiles(),
      ['alpha', 'bravo', 'charlie', 'delta'],
      'the grid stays: opening the demo card is the host’s to do',
    );
  });
});

class TwoPages {
  @tracked first = true;
  @tracked second = false;
}

module('Choreo gallery | demo page', function (hooks) {
  setupCardTest(hooks);
  setupChoreo(hooks);

  test('the pager opens the neighbours through the host', async function (assert) {
    const [alpha, bravo, charlie] = catalog();
    const near = { prev: alpha, next: charlie };
    const theater = new Theater();
    let opened: string[] = [];
    const onOpen = (card: GalleryDemo) => opened.push(card.slug ?? '');
    await render(
      <template>
        <DemoPage
          @demo={{bravo}}
          @near={{near}}
          @onOpen={{onOpen}}
          @theater={{theater}}
        />
      </template>,
    );

    assert.strictEqual(
      one('.next-demo b')?.textContent?.trim(),
      'Title charlie',
      'the next demo, under the title',
    );
    assert.deepEqual(
      Array.from(root().querySelectorAll('.pager a')).map((a) =>
        a.textContent?.replace(/\s+/g, ' ').trim(),
      ),
      ['← Title alpha', 'Title charlie →'],
      'and either side of it at the foot',
    );

    await click('.next-demo');
    await click('.pager a');
    assert.deepEqual(opened, ['charlie', 'alpha'], 'each opens its demo card');
  });

  test('the first demo has no previous, and a page with no host has no pager', async function (assert) {
    const [alpha, bravo] = catalog();
    const near = { next: bravo };
    const theater = new Theater();
    const onOpen = () => undefined;
    const state = new TwoPages();
    await render(
      <template>
        {{#if state.second}}
          <DemoPage @demo={{alpha}} @near={{near}} @theater={{theater}} />
        {{else}}
          <DemoPage
            @demo={{alpha}}
            @near={{near}}
            @onOpen={{onOpen}}
            @theater={{theater}}
          />
        {{/if}}
      </template>,
    );
    assert.strictEqual(
      root().querySelectorAll('.pager a').length,
      1,
      'only the next demo',
    );

    state.second = true;
    await animationsSettled();
    assert.notOk(one('.pager'), 'no pager');
    assert.notOk(one('.next-demo'), 'and no next link');
  });

  test('a speed picked on one demo page ends when another opens over it', async function (assert) {
    const [, bravo] = catalog();
    // a demo with no speed picker of its own to put the clock back
    const other = demo('echo', 'Animate');
    const theater = new Theater();
    const state = new TwoPages();
    await render(
      <template>
        {{#if state.first}}
          <div class='first'>
            <DemoPage @demo={{bravo}} @theater={{theater}} />
          </div>
        {{/if}}
        {{#if state.second}}
          <div class='second'>
            <DemoPage @demo={{other}} @theater={{theater}} />
          </div>
        {{/if}}
      </template>,
    );

    await click(speed('÷10'));
    assert.strictEqual(motionSpeed(), 10, 'the clock runs at a tenth');

    state.second = true;
    await animationsSettled();
    assert.strictEqual(motionSpeed(), 1, 'the next demo starts at full speed');
    assert.notOk(one('.second .speeds'), 'though it has no speed picker');
    assert.strictEqual(
      speed('Full').getAttribute('aria-pressed'),
      'true',
      'and the picker on the page underneath says so',
    );

    await click(speed('÷5'));
    assert.strictEqual(motionSpeed(), 5);
    state.first = false;
    await animationsSettled();
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

  test('a demo card on its own is its page, in the site’s frame', async function (assert) {
    let loader = getService('loader-service').loader;
    await renderCard(loader, demo('echo', 'Choreo'), 'isolated');

    assert.strictEqual(one('h1')?.textContent?.trim(), 'Title echo');
    assert.ok(one('[data-stage-pending]'), 'the pending stage');
    assert.ok(
      root().textContent?.includes("<div class='echo'></div>"),
      'the usage example',
    );
    assert.ok(one('.topbar .brand'), 'the site’s brand');
    assert.ok(one('summary[aria-label="Appearance"]'), 'and its theme picker');
    assert.notOk(one('.pager'), 'no gallery lists it, so no pager');
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
    assert.notOk(one('.topbar'), 'no site frame');
  });
});
