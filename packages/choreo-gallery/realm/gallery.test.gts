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
import {
  click,
  render,
  settled,
  triggerKeyEvent,
  waitUntil,
} from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { getService } from '@universal-ember/test-support';
import { DialStore } from 'dialkit/vanilla';
import { motionSpeed } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { GalleryDemo, WalkthroughStep } from './demo';
import { ChoreoGallery } from './gallery';
import { openThroughHost } from './lib/pointer';
import { Theater } from './lib/theater';
import { setThemeMode, theme } from './lib/theme';
import { DemoPage } from './shell/demo-page';
import { KeyframesDemo } from './stages/keyframes';

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

  test('a filter says what the grid now shows, for a screen reader', async function (assert) {
    await renderGallery();
    let status = () => one('[role="status"]');

    assert.strictEqual(
      status()?.textContent?.trim(),
      '',
      'nothing is said before a filter is chosen',
    );

    await click(chip('Layout'));
    assert.strictEqual(status()?.textContent?.trim(), 'Layout: 2 of 4 demos');

    await click(chip('All'));
    assert.strictEqual(status()?.textContent?.trim(), 'All 4 demos');
  });

  test('the appearance picker is one radio group, and gives focus back to its pill', async function (assert) {
    let mode = theme.mode;
    await renderGallery();
    let picker = one('.header-picker') as HTMLDetailsElement;
    let summary = picker.querySelector('summary')!;
    let radio = (label: string) =>
      Array.from(
        picker.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
      ).find((button) => button.textContent?.trim() === label)!;

    try {
      setThemeMode('dark');
      await settled();
      assert.ok(
        picker.querySelector('[role="radiogroup"][aria-label="Appearance"]'),
        'the segments are one named group',
      );
      assert.deepEqual(
        Array.from(picker.querySelectorAll('[role="radio"]')).map((button) =>
          button.getAttribute('tabindex'),
        ),
        ['-1', '-1', '0'],
        'and one Tab stop, on the chosen segment',
      );

      await click(summary);
      radio('Dark').focus();
      await triggerKeyEvent(radio('Dark'), 'keydown', 'ArrowRight');
      assert.strictEqual(
        theme.mode,
        'auto',
        'an arrow chooses, wrapping round',
      );
      assert.strictEqual(document.activeElement, radio('Auto'), 'and focuses');
      assert.true(picker.open, 'the menu stays open while arrowing');

      await click(radio('Light'));
      assert.strictEqual(theme.mode, 'light', 'a click chooses');
      assert.false(picker.open, 'and closes the menu');
      assert.strictEqual(
        document.activeElement,
        summary,
        'with focus back on the pill',
      );

      await click(summary);
      await triggerKeyEvent(picker, 'keydown', 'Escape');
      assert.false(picker.open, 'Escape closes it');
      assert.strictEqual(document.activeElement, summary, 'onto the pill too');
    } finally {
      setThemeMode(mode);
    }
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

module('Choreo gallery | tile link', function () {
  // called directly rather than dispatched: a dispatched click on a link
  // that is not stopped navigates the test page
  test('a plain click is the host’s, a modified one the browser’s', function (assert) {
    let plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    openThroughHost(plain);
    assert.true(plain.defaultPrevented, 'the link does not navigate itself');
    assert.false(plain.cancelBubble, 'and the click goes on to the host');

    let modified = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    openThroughHost(modified);
    assert.false(
      modified.defaultPrevented,
      'a new-tab click opens the card’s URL',
    );
    assert.true(modified.cancelBubble, 'and the host never hears of it');
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
      speed('Full').getAttribute('aria-checked'),
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

/** a running platform animation's cycle, in ms, and where it is in it */
function cycleOf(animation: Animation) {
  let cycle = Number(animation.effect!.getComputedTiming().duration);
  return { cycle, phase: (Number(animation.currentTime) % cycle) / cycle };
}

module('Choreo gallery | lab', function (hooks) {
  setupCardTest(hooks);
  setupChoreo(hooks);

  test('an edit retimes a loop that is already running, without a replay', async function (assert) {
    let loader = getService('loader-service').loader;
    await renderCard(
      loader,
      new KeyframesDemo({ slug: 'keyframes', title: 'Keyframes' }),
      'embedded',
    );
    await click(one('.lab-toggle')!);

    // the glow's opacity pulse runs on the platform, so its clock is readable
    let glow = one('.morph-glow')!;
    // Motion starts it once its keyframes resolve, a beat after mount
    await waitUntil(() => glow.getAnimations().length > 0);
    let loop = glow.getAnimations()[0]!;
    assert.strictEqual(cycleOf(loop).cycle, 1350, 'the authored 1.35s loop');
    loop.currentTime = 1350 / 4;

    DialStore.updateValue('lab:keyframes', 'transition', {
      type: 'easing',
      duration: 2.7,
      ease: [0.22, 1, 0.36, 1],
    });
    await settled();

    assert.strictEqual(
      one('.morph-glow'),
      glow,
      'the same stage, not a replay',
    );
    let retimed = cycleOf(glow.getAnimations()[0]!);
    assert.strictEqual(retimed.cycle, 2700, 'the loop now takes 2.7s');
    assert.ok(
      Math.abs(retimed.phase - 0.25) < 0.05,
      `still a quarter of the way round (${retimed.phase})`,
    );
  });
});
