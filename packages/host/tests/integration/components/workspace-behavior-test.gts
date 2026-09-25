import { click, find, render, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import {
  CardDef,
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
  // names, exposed through FilterList's hooks, are a contract rather than an
  // implementation detail.
  test('the Library rail exposes stable filter hooks', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    await click(LIBRARY);

    for (let name of ['Everything', 'Cards', 'Files']) {
      assert
        .dom(`[data-test-boxel-filter-list-button="${name}"]`)
        .exists(`the "${name}" rail filter is addressable`);
    }
    assert
      .dom('[data-test-selected-filter="Everything"]')
      .exists('the Library opens on Everything');
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

  const RAIL = '[data-test-library-rail]';
  const RAIL_SLOT = '[data-test-library-rail-slot]';
  const TOGGLE = '[data-test-rail-toggle]';

  test('the rail can be hidden and shown again without losing its selection', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    await click(LIBRARY);

    assert
      .dom(RAIL_SLOT)
      .doesNotHaveAttribute('inert', 'the rail is open at a comfortable width');
    assert.dom(TOGGLE).exists({ count: 1 }, 'there is a single toggle');
    assert.dom(TOGGLE).hasAria('expanded', 'true');
    assert.dom(TOGGLE).hasAria('label', 'Hide Sidebar');
    assert
      .dom(TOGGLE)
      .hasAria('controls', find(RAIL)!.id, 'the toggle names the rail');

    await click(TOGGLE);
    assert.dom(RAIL_SLOT).hasAttribute('inert', '', 'the rail is hidden');
    assert.dom(TOGGLE).hasAria('expanded', 'false');
    assert.dom(TOGGLE).hasAria('label', 'Show Sidebar');
    assert.dom(TOGGLE).isFocused('focus stays on the toggle');
    assert
      .dom('[data-test-cards-grid-header]')
      .containsText('Everything', 'the header still names the active filter');

    await click(TOGGLE);
    assert.dom(RAIL_SLOT).doesNotHaveAttribute('inert', 'the rail is back');
    assert.dom(TOGGLE).hasAria('expanded', 'true');
    assert.dom(TOGGLE).isFocused('focus stays on the toggle');
    assert
      .dom('[data-test-selected-filter="Everything"]')
      .exists('with its selection intact');
  });

  test('a narrow pane starts with the rail closed, and the toggle opens it', async function (assert) {
    let api = await loader.import<typeof import('@cardstack/base/card-api')>(
      '@cardstack/base/card-api',
    );
    let Comp = api.getComponent(new Workspace({})) as ComponentLike<{
      Args: { format?: Format };
    }>;

    // Narrower than the 40rem the rail collapses under.
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style='width: 30rem; height: 30rem'>
          <Comp @format='isolated' />
        </div>
      </template>,
    );
    await click(LIBRARY);

    // The width arrives through a ResizeObserver, a beat after render.
    await waitUntil(() => find(RAIL_SLOT)?.hasAttribute('inert'));
    assert
      .dom(RAIL_SLOT)
      .hasAttribute('inert', '', 'the rail starts closed in a narrow pane');
    assert.dom(TOGGLE).hasAria('expanded', 'false');

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
    assert
      .dom(RAIL_SLOT)
      .doesNotHaveAttribute('inert', 'the toggle still opens it');
    assert.dom(TOGGLE).hasAria('expanded', 'true');
    assert
      .dom('[data-test-cards-grid-cards]')
      .hasAttribute(
        'inert',
        '',
        'the grid the open rail pushes aside is inert',
      );
    assert
      .dom('[data-test-cards-grid-content]')
      .hasAttribute(
        'tabindex',
        '-1',
        'the covered grid scroll region drops out of the tab order',
      );
    assert.strictEqual(
      find(TOGGLE)?.closest('[inert]'),
      null,
      'the toggle stays usable to close it',
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
