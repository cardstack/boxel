import {
  blur,
  click,
  find,
  focus,
  render,
  settled,
  triggerEvent,
  triggerKeyEvent,
  waitUntil,
} from '@ember/test-helpers';

import { CardDef } from '@cardstack/base/card-api';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { percySnapshot } from '../../helpers';
import {
  Workspace,
  setupBaseRealm,
  setupWorkspaceCard,
} from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { Format } from '@cardstack/base/card-api';
import type * as MarkdownFileDefModule from '@cardstack/base/markdown-file-def';
import type { ComponentLike } from '@glint/template';

const HOME = '[data-test-workspace-tab="home"]';
const LIBRARY = '[data-test-workspace-tab="library"]';
const ACTIVITY = '[data-test-workspace-tab="activity"]';

module('Integration | Card | workspace | segments', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupWorkspaceCard(hooks);

  let loader: Loader;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  test('clicking a tab moves the active segment', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    assert
      .dom('nav.tabs [aria-current="true"]')
      .hasText('Home', 'Home is active first');

    await click(LIBRARY);
    assert.dom('nav.tabs [aria-current="true"]').hasText('Library');

    await click(ACTIVITY);
    assert.dom('nav.tabs [aria-current="true"]').hasText('Activity');

    await click(HOME);
    assert.dom('nav.tabs [aria-current="true"]').hasText('Home');
  });

  test('the Frame search input is present and editable', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    assert
      .dom('[data-test-workspace-search]')
      .exists('Cmd+K frame search input');
  });

  // The Library rail opens on "Everything", which lists a card twice — once as
  // the instance and once as the file-meta row for its `.json` — and both rows
  // carry the same extension-stripped `data-test-cards-grid-item`. Callers that
  // need one element per card (notably the matrix `showAllCards` helper, which
  // drives realm indexes end to end) select "Cards" instead, so these filter
  // names, exposed through the rail's `data-test-library-filter` hooks, are a
  // contract rather than an implementation detail.
  test('the Library rail exposes stable filter hooks', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    await click(LIBRARY);

    for (let name of ['Everything', 'Cards', 'Files']) {
      assert
        .dom(`[data-test-library-filter="${name}"]`)
        .exists(`the "${name}" rail filter is addressable`);
    }
    assert
      .dom('[data-test-library-filter="Everything"]')
      .hasAria('current', 'page', 'the Library opens on Everything');
  });
});

module('Integration | Card | workspace | Library rail', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupWorkspaceCard(hooks);

  let loader: Loader;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  // The Library pane is a Pret UI Sidebar: its shell carries the rail's state,
  // the rail is its nav, and its seam is a resize separator while the rail is
  // open and a plain toggle while it is folded.
  const PANE = '[data-test-library]';
  const RAIL = `${PANE} [data-test-pretui-sidebar-rail]`;
  const SEAM = `${PANE} [data-test-pretui-sidebar-resize]`;
  const FOLDED_SEAM = `${PANE} [data-test-pretui-sidebar-handle]`;
  const TOGGLE = '[data-test-rail-toggle]';

  let pane = () => find(PANE) as HTMLElement;
  let railOpen = () => pane().dataset['state'] === 'expanded';
  // layout px, unaffected by the test container's scale
  let railWidth = () => (find(RAIL) as HTMLElement).offsetWidth;
  // A toggle slides the rail; measure it once it has landed.
  let slideSettled = () => waitUntil(() => pane().getAnimations().length === 0);
  let rem = () =>
    parseFloat(getComputedStyle(document.documentElement).fontSize);

  // Drags the seam by `by` screen px. The events go to the element itself: a
  // drag that folds the rail unmounts the seam before the pointer is released.
  async function dragSeam(by: number, from = 500) {
    let seam = find(SEAM) as HTMLElement;
    let fire = (type: string, clientX: number) =>
      seam.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pointerId: 1,
          clientX,
        }),
      );
    fire('pointerdown', from);
    fire('pointermove', from + by);
    await settled();
    fire('pointerup', from + by);
    await settled();
  }

  // A fixed box, so the pane's width is known.
  async function renderIn(width: string) {
    let api = await loader.import<typeof import('@cardstack/base/card-api')>(
      '@cardstack/base/card-api',
    );
    let Comp = api.getComponent(new Workspace({})) as ComponentLike<{
      Args: { format?: Format };
    }>;
    let style = `width: ${width}; height: 30rem`;
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style={{style}}>
          <Comp @format='isolated' />
        </div>
      </template>,
    );
  }

  test('the rail can be hidden and shown again without losing its selection', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    await click(LIBRARY);

    assert.true(railOpen(), 'the rail is open at a comfortable width');
    assert.dom(RAIL).hasAria('label', 'Library filters', 'a named landmark');
    assert.dom(TOGGLE).exists({ count: 1 }, 'the header has a single toggle');
    assert
      .dom(TOGGLE)
      .hasAria('expanded', 'true')
      .hasAria('label', 'Collapse Library filters')
      .hasAria('controls', find(RAIL)!.id, 'the toggle names the rail');

    await click(TOGGLE);
    assert.false(railOpen(), 'the rail is hidden');
    assert.strictEqual(
      getComputedStyle(find(RAIL)!).visibility,
      'hidden',
      'and out of the tab order and the accessibility tree',
    );
    assert
      .dom(TOGGLE)
      .hasAria('expanded', 'false')
      .hasAria('label', 'Expand Library filters');
    assert.dom(TOGGLE).isFocused('focus stays on the toggle');
    assert
      .dom('[data-test-cards-grid-header]')
      .containsText('Everything', 'the header still names the active filter');

    await click(TOGGLE);
    assert.true(railOpen(), 'the rail is back');
    assert.dom(TOGGLE).hasAria('expanded', 'true');
    assert.dom(TOGGLE).isFocused('focus stays on the toggle');
    assert
      .dom('[data-test-library-filter="Everything"]')
      .hasAria('current', 'page', 'with its selection intact');
  });

  test('the rail claims no keyboard shortcut from the host', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    await click(LIBRARY);

    await triggerKeyEvent(document.body, 'keydown', 'B', { metaKey: true });
    assert.true(railOpen(), 'Cmd+B leaves the rail as it was');
    await triggerKeyEvent(document.body, 'keydown', 'B', { ctrlKey: true });
    assert.true(railOpen(), 'and so does Ctrl+B');
  });

  test('dragging the seam resizes the rail within its bounds, Enter restores it, and a drag past the minimum folds it', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    await click(LIBRARY);

    let defaultWidth = Math.round(13.375 * rem());
    assert.strictEqual(
      railWidth(),
      defaultWidth,
      'the rail starts at 13.375rem',
    );
    assert
      .dom(SEAM)
      .hasAttribute('role', 'separator')
      .hasAria('label', 'Resize Library filters')
      .hasAria('controls', find(RAIL)!.id, 'the seam names the rail')
      .hasAria('valuenow', String(defaultWidth));

    let screenWidth = Math.round(find(RAIL)!.getBoundingClientRect().width);
    await dragSeam(40);
    assert.strictEqual(
      Math.round(find(RAIL)!.getBoundingClientRect().width),
      screenWidth + 40,
      'dragging widens it, with the edge following the pointer',
    );
    assert
      .dom(SEAM)
      .hasAria('valuenow', String(railWidth()), 'and reports the new width');

    await dragSeam(1000);
    assert.strictEqual(railWidth(), Math.round(26 * rem()), 'up to 26rem');

    await focus(SEAM);
    await triggerKeyEvent(SEAM, 'keydown', 'Enter');
    assert.strictEqual(
      railWidth(),
      defaultWidth,
      'Enter on the focused seam restores the default',
    );

    await dragSeam(-1000);
    assert.false(railOpen(), 'a drag past the minimum folds the rail');
    assert.dom(SEAM).doesNotExist('folded, the seam is no separator');
    assert
      .dom(FOLDED_SEAM)
      .hasAria('expanded', 'false')
      .hasAria('label', 'Expand Library filters', 'but a toggle to reopen it');
  });

  test("the seam's target reaches past the rail's edge over the grid's gutter, clear of the rows and the rail's scrollbar", async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    await click(LIBRARY);

    let seam = find(SEAM) as HTMLElement;
    seam.scrollIntoView({ block: 'center' });
    let box = seam.getBoundingClientRect();
    let strip = parseFloat(getComputedStyle(seam).width);
    // screen px per layout px, since the test container is scaled
    let scale = box.width / strip;
    let y = box.top + box.height / 2;
    let past = (layoutPx: number) =>
      document.elementFromPoint(box.right + layoutPx * scale, y);
    let outset = 1.5 * rem() - strip;
    assert.strictEqual(
      past(outset - 2),
      seam,
      'the strip and its reach past the edge make a 1.5rem target',
    );
    assert.notStrictEqual(past(outset + 2), seam, 'and it ends there');
    assert.notStrictEqual(
      past(-strip - 2),
      seam,
      'it reaches no further into the rail than the strip',
    );
    // the groups' parent is the rail's scrolling body
    let body = find('[data-test-rail-group]')!.parentElement!;
    assert.true(
      body.getBoundingClientRect().right <= box.left + 1,
      "the rail's scrolling body, and so its scrollbar, ends where the strip begins",
    );
  });

  test('in a narrow pane the rail stops short of the pane edge, so its seam stays in reach', async function (assert) {
    await renderIn('22rem');
    await click(LIBRARY);
    await waitUntil(() => pane().dataset['state'] === 'collapsed');
    await click(TOGGLE);
    await slideSettled();

    await dragSeam(2000, 100);
    let paneWidth = pane().clientWidth;
    assert.true(
      Math.abs(railWidth() - (paneWidth - 3 * rem())) <= 1,
      `the rail stops 3rem inside the pane (${railWidth()}px in ${paneWidth}px)`,
    );
    assert.true(
      find(SEAM)!.getBoundingClientRect().right <=
        pane().getBoundingClientRect().right,
      'the seam is inside the pane',
    );
  });

  test('in a pane too narrow for that margin the rail keeps its min width', async function (assert) {
    await renderIn('12rem');
    await click(LIBRARY);
    await waitUntil(() => pane().dataset['state'] === 'collapsed');
    await click(TOGGLE);
    await slideSettled();

    let min = Math.round(11 * rem());
    assert.strictEqual(
      railWidth(),
      min,
      'the rail opens at 11rem, narrower than its default, to fit the pane',
    );
    assert
      .dom(SEAM)
      .hasAria('valuenow', String(min), 'and the seam reports that width')
      .hasAria('valuemax', String(min));

    await dragSeam(2000, 100);
    assert.strictEqual(railWidth(), min, 'a drag keeps it there');
  });

  test('a narrow pane starts with the rail closed, and the toggle opens it beside the grid', async function (assert) {
    let reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Narrower than the 40rem the rail folds under.
    await renderIn('30rem');
    await click(LIBRARY);

    // The width arrives through a ResizeObserver, a beat after render.
    await waitUntil(() => pane().dataset['state'] === 'collapsed');
    assert.dom(TOGGLE).hasAria('expanded', 'false');
    assert.strictEqual(
      getComputedStyle(pane()).transitionDuration,
      '0s',
      'the rail is shut from the start rather than sliding shut',
    );
    assert
      .dom('[data-test-cards-grid-cards]')
      .doesNotHaveAttribute(
        'inert',
        'the grid is usable while the rail is shut',
      );
    assert
      .dom('[data-test-cards-grid-content]')
      .hasAttribute('tabindex', '0', 'the grid scroll region is a tab stop');

    await click(TOGGLE);
    assert.true(railOpen(), 'the toggle opens it');
    assert.dom(TOGGLE).hasAria('expanded', 'true');
    if (!reducedMotion) {
      assert.notStrictEqual(
        getComputedStyle(pane()).transitionDuration,
        '0s',
        'a toggle slides',
      );
    }
    await slideSettled();
    assert
      .dom('[data-test-cards-grid-cards]')
      .doesNotHaveAttribute('inert', 'the grid beside the open rail is usable');
    assert.true(
      find('[data-test-cards-grid-content]')!.getBoundingClientRect().left >=
        find(RAIL)!.getBoundingClientRect().right - 1,
      'the open rail narrows the grid rather than covering it',
    );
  });
});

module('Integration | Card | workspace | README', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupWorkspaceCard(hooks);

  let loader: Loader;
  let MarkdownDef: typeof MarkdownFileDefModule.MarkdownDef;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    // MarkdownDef is only needed by these tests, so it is imported here rather
    // than from the shared base-realm helper.
    MarkdownDef = (
      await loader.import<typeof MarkdownFileDefModule>(
        '@cardstack/base/markdown-file-def',
      )
    ).MarkdownDef;
  });

  // `linksTo` rejects a FileDef with no id, so the README carries the url it
  // would have in a realm.
  function readme(content: string) {
    let url = 'https://example.com/README.md';
    return new MarkdownDef({
      id: url,
      url,
      sourceUrl: url,
      name: 'README.md',
      contentType: 'text/markdown',
      content,
    });
  }

  // Tall enough to overrun the collapsed clamp whatever the container width.
  const LONG_README = [
    '# The space',
    ...Array.from(
      { length: 40 },
      (_, i) => `Paragraph ${i + 1} of the workspace README.`,
    ),
  ].join('\n\n');

  test('an unpinned space renders the README as a document, not a file card', async function (assert) {
    await renderCard(
      loader,
      new Workspace({ readme: readme('# The space\n\nWelcome aboard.') }),
      'isolated',
    );

    assert
      .dom('[data-test-readme] [data-test-markdown-preview]')
      .exists('the README renders through the content-only markdown preview');
    assert.dom('[data-test-readme]').containsText('Welcome aboard.');
    // The file shell would wrap the document in a file bar (icon, name, size,
    // extension pill) over a fixed-height scroll box.
    assert
      .dom('[data-test-readme] [data-test-file-embedded]')
      .doesNotExist('no file shell chrome around the README');
  });

  test('the About README is clamped until Read more', async function (assert) {
    await renderCard(
      loader,
      new Workspace({
        entryPoints: [new CardDef({ cardTitle: 'Pinned card' })],
        readme: readme(LONG_README),
      }),
      'isolated',
    );

    assert
      .dom('[data-test-readme]')
      .hasAttribute('data-test-readme-state', 'collapsed');
    assert
      .dom('[data-test-readme-body]')
      .exists('the card owns the clamped README body');
    let body = () => find('[data-test-readme-body]') as HTMLElement;
    assert.ok(
      body().scrollHeight > body().clientHeight,
      'the collapsed README clips the rest of the document',
    );

    await click('[data-test-readme-toggle]');

    assert
      .dom('[data-test-readme]')
      .hasAttribute('data-test-readme-state', 'expanded');
    assert.strictEqual(
      body().scrollHeight,
      body().clientHeight,
      'Read more renders the whole document',
    );
  });
});

module('Integration | Card | workspace | visual', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupWorkspaceCard(hooks);

  let loader: Loader;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  const PANE = '[data-test-library]';
  const TOGGLE = '[data-test-rail-toggle]';
  const OPEN_TIP = '[data-test-pretui-tooltip-bubble][data-open]';
  let railState = () => (find(PANE) as HTMLElement | null)?.dataset['state'];

  // Close the tooltip of the trigger `selector` and wait until none shows. A
  // tooltip opens on hover over its wrapper, or on keyboard focus, so take
  // both away.
  async function dismissTooltip(selector: string) {
    await blur(selector);
    let wrapper = find(selector)?.closest('[data-test-pretui-tooltip]');
    if (wrapper) {
      await triggerEvent(wrapper, 'mouseleave');
    }
    await waitUntil(() => !find(OPEN_TIP));
  }

  // Fixed boxes so the container queries resolve the same on every run.
  async function renderAt(width: string, height: string) {
    let api = await loader.import<typeof import('@cardstack/base/card-api')>(
      '@cardstack/base/card-api',
    );
    let Comp = api.getComponent(new Workspace({})) as ComponentLike<{
      Args: { format?: Format };
    }>;
    let style = `width: ${width}; height: ${height}`;
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style={{style}}>
          <Comp @format='isolated' />
        </div>
      </template>,
    );
  }

  test('wide pane', async function (assert) {
    await renderAt('64rem', '40rem');
    await percySnapshot('Integration | Card | workspace | visual | wide home');

    await click(LIBRARY);
    // The rail stays hidden until the pane's width arrives through a
    // ResizeObserver, a beat after render.
    await waitUntil(() => !find(`${PANE} [data-measuring]`));
    assert.strictEqual(
      railState(),
      'expanded',
      'the rail is open at a wide width',
    );
    await percySnapshot(
      'Integration | Card | workspace | visual | wide library with rail open',
    );
  });

  test('narrow pane', async function (assert) {
    await renderAt('30rem', '40rem');
    await click(LIBRARY);
    // The width arrives through a ResizeObserver, a beat after render.
    await waitUntil(() => railState() === 'collapsed');
    assert.strictEqual(railState(), 'collapsed', 'the rail starts closed');
    await percySnapshot(
      'Integration | Card | workspace | visual | narrow library with rail closed',
    );

    await click(TOGGLE);
    assert.strictEqual(railState(), 'expanded', 'the rail is open');
    // The rail slides open and moves the toggle with it, so wait for it to
    // land. A tooltip left open would be placed wherever the toggle was when it
    // opened, so the snapshot would differ from run to run; the snapshot is of
    // the rail, so make sure none is open.
    await waitUntil(() => find(PANE)!.getAnimations().length === 0);
    await dismissTooltip(TOGGLE);
    assert
      .dom(OPEN_TIP)
      .doesNotExist('no tooltip is open when the snapshot is taken');
    await percySnapshot(
      'Integration | Card | workspace | visual | narrow library with rail open',
    );
  });

  test('phone width', async function (assert) {
    await renderAt('22rem', '40rem');
    assert.dom(HOME).hasAria('current', 'true', 'Home is active');
    await percySnapshot('Integration | Card | workspace | visual | phone home');
  });
});
