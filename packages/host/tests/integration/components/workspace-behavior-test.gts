import { click, find } from '@ember/test-helpers';

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

import type * as MarkdownFileDefModule from '@cardstack/base/markdown-file-def';

const HOME = 'nav.tabs .tab:nth-child(1)';
const LIBRARY = 'nav.tabs .tab:nth-child(2)';
const ACTIVITY = 'nav.tabs .tab:nth-child(3)';

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
    assert.dom('nav.tabs .tab.active').hasText('Home', 'Home is active first');

    await click(LIBRARY);
    assert.dom('nav.tabs .tab.active').hasText('Library');

    await click(ACTIVITY);
    assert.dom('nav.tabs .tab.active').hasText('Activity');

    await click(HOME);
    assert.dom('nav.tabs .tab.active').hasText('Home');
  });

  test('the Frame search input is present and editable', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    assert.dom('.search-box .search-input').exists('Cmd+K frame search input');
  });

  // The Library rail opens on "Everything", which lists a card twice — once as
  // the instance and once as the file-meta row for its `.json` — and both rows
  // carry the same extension-stripped `data-test-cards-grid-item`. Callers that
  // need one element per card (notably the matrix `showAllCards` helper, which
  // drives realm indexes end to end) select "Cards" instead, so these filter ids
  // are a contract rather than an implementation detail.
  test('the Library rail exposes stable filter hooks', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    await click(LIBRARY);

    for (let id of ['everything', 'cards', 'files']) {
      assert
        .dom(`[data-test-workspace-filter="${id}"]`)
        .exists(`the "${id}" rail filter is addressable`);
    }
    assert
      .dom('[data-test-workspace-filter="everything"]')
      .hasClass('selected', 'the Library opens on Everything');
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
      .dom('.readme-embed [data-test-markdown-preview]')
      .exists('the README renders through the content-only markdown preview');
    assert.dom('.readme-embed').containsText('Welcome aboard.');
    // The file shell would wrap the document in a file bar (icon, name, size,
    // extension pill) over a fixed-height scroll box.
    assert
      .dom('.readme-embed [data-test-file-embedded]')
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

    assert.dom('.readme-embed').hasClass('collapsed');
    assert.dom('.readme-body').exists('the card owns the clamped README body');
    let body = () => find('.readme-body') as HTMLElement;
    assert.ok(
      body().scrollHeight > body().clientHeight,
      'the collapsed README clips the rest of the document',
    );

    await click('.readme-toggle');

    assert.dom('.readme-embed').doesNotHaveClass('collapsed');
    assert.strictEqual(
      body().scrollHeight,
      body().clientHeight,
      'Read more renders the whole document',
    );
  });
});
