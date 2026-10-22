/**
 * A guide is read on its page: the `Guide` card beside the guide's Markdown,
 * at the Markdown's URL without `.md`. The page is the gallery's frame around
 * the guide's own Markdown, with the guides' sections beside it, the guide's
 * pager and its live demos, and none of the host's file chrome.
 */
import { getOwner } from '@ember/owner';
import { visit, waitFor } from '@ember/test-helpers';

import { getPageTitle } from 'ember-page-title/test-support';
import { module, test } from 'qunit';

import HostModeService from '@cardstack/host/services/host-mode-service';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  testHostModeRealmURL,
} from '../helpers';
import {
  choreoGalleryGuidePages,
  choreoGalleryGuides,
  choreoGalleryRealmOf,
} from '../helpers/choreo-gallery';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// a request to a published site: the realm is the page's whole origin
class StubHostModeService extends HostModeService {
  get isActive() {
    return true;
  }

  get hostModeOrigin() {
    return testHostModeRealmURL.replace(/\/test\/?$/, '');
  }
}

const guide = (slug: string) => `${testHostModeRealmURL}docs/guides/${slug}`;
const article = '[data-test-guide-article]';

module('Acceptance | Choreo gallery | guide pages', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testHostModeRealmURL],
  });

  hooks.beforeEach(async function (this) {
    let owner = getOwner(this)! as ReturnType<typeof getOwner> & {
      unregister?: (fullName: string) => void;
    };
    owner.unregister?.('service:host-mode-service');
    owner.register('service:host-mode-service', StubHostModeService);

    mockMatrixUtils.createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();
    await setupAcceptanceTestRealm({
      realmURL: testHostModeRealmURL,
      mockMatrixUtils,
      permissions: { '*': ['read'] },
      contents: {
        // core-start embeds enter, whose lesson names another guide;
        // core-presence embeds presence, whose lesson names core-presence
        ...choreoGalleryRealmOf(['enter', 'presence']),
        ...choreoGalleryGuidePages(['core-start', 'core-presence']),
      },
    });
    mockMatrixUtils.setActiveRealms([testHostModeRealmURL]);
  });

  test("a guide's page is the gallery's, with the guide's Markdown and no file chrome", async function (assert) {
    await visit('/test/docs/guides/core-start');
    await waitFor(`${article} h1`, { timeout: 15_000 });

    assert
      .dom(`[data-test-host-mode-card="${guide('core-start')}"]`)
      .exists('the page is the guide card');
    assert.dom(`${article} h1`).hasText('Getting Started');
    assert
      .dom('[data-choreo-site] [data-test-guide-article]')
      .exists('inside the gallery’s frame and palette');
    assert
      .dom('[data-test-site-home]')
      .hasAttribute('href', testHostModeRealmURL, 'the brand leads home');
    assert
      .dom('[data-test-guide-home]')
      .hasAttribute('href', testHostModeRealmURL, 'and so does the nav');
    assert
      .dom('[data-test-file-isolated]')
      .doesNotExist('no file view around it');
    assert.dom('[data-test-file-download]').doesNotExist('no Download');
    assert.dom('[data-test-file-copy-link]').doesNotExist('no Copy link');
    assert.strictEqual(getPageTitle(), 'Getting Started', 'the page title');
    assert.notStrictEqual(
      getComputedStyle(document.querySelector(`${article} p`)!).maxWidth,
      'none',
      'its prose runs at a reading measure',
    );
  });

  test("the guides' sections run down the side, with the guide marked", async function (assert) {
    await visit('/test/docs/guides/core-presence');
    await waitFor('[data-test-guide-section]', { timeout: 15_000 });

    let titles = [
      ...document.querySelectorAll('[data-test-guide-section-title]'),
    ].map((title) => title.textContent!.replace(/\s+/g, ' ').trim());
    assert.deepEqual(
      titles,
      [
        '01 Core glimmer-motion',
        '02 Interactive Choreo',
        '03 Spatial & 3D Choreo',
        '04 Recorded & Film Choreo',
      ],
      'the four sections of the index, in its order',
    );
    assert
      .dom('[data-test-guide-nav-link]')
      .exists(
        { count: Object.keys(choreoGalleryGuides()).length },
        'every guide, whether or not this realm holds it',
      );
    assert
      .dom('[data-test-guide-nav] [aria-current="page"]')
      .exists({ count: 1 }, 'one guide is marked');
    assert
      .dom('[data-test-guide-nav-link="core-presence"]')
      .hasAttribute('aria-current', 'page', 'the one being read');
    assert
      .dom('[data-test-guide-nav-link="core-layout"]')
      .hasAttribute('href', guide('core-layout'), 'each links its page');
  });

  test("the guide's pager and links lead to the guides' pages", async function (assert) {
    await visit('/test/docs/guides/core-presence');
    await waitFor(`${article} h1`, { timeout: 15_000 });

    let pager = [
      ...document.querySelectorAll<HTMLAnchorElement>(`${article} a`),
    ].slice(-3);
    // the links are relative, as written, and resolve against the guide's
    // own URL, which is the page's on a published site
    assert.deepEqual(
      pager.map((link) => [
        link.textContent,
        new URL(link.getAttribute('href')!, guide('core-presence')).href,
      ]),
      [
        ['← Animating an Element', guide('core-elements')],
        ['All guides', guide('README')],
        ['Animating Layout →', guide('core-layout')],
      ],
      'the pager names the neighbours’ pages, and the index’s',
    );
  });

  test('an embedded demo is live, and links its guide unless it is the one being read', async function (assert) {
    await visit('/test/docs/guides/core-start');
    await waitFor(
      `${article} .markdown-bfm-card-slot--block [data-test-demo-tile]`,
      {
        timeout: 15_000,
      },
    );
    assert
      .dom(`${article} .markdown-bfm-card-slot--block [data-test-tile-title]`)
      .hasText('Enter', 'core-start embeds the enter demo');
    assert
      .dom(`${article} .markdown-bfm-card-slot--block [data-test-tile-stage]`)
      .exists('with its live stage');
    assert
      .dom(`${article} [data-test-guide-link]`)
      .hasAttribute(
        'href',
        guide('core-targets'),
        'its guide is another one, so it links it',
      );

    await visit('/test/docs/guides/core-presence');
    await waitFor(
      `${article} .markdown-bfm-card-slot--block [data-test-demo-tile]`,
      {
        timeout: 15_000,
      },
    );
    assert
      .dom(`${article} .markdown-bfm-card-slot--block [data-test-tile-title]`)
      .hasText('Presence', 'core-presence embeds the presence demo');
    assert
      .dom(`${article} [data-test-guide-link]`)
      .doesNotExist('its guide is this one, so there is no link back to it');
  });

  test("the index's page is a guide page too", async function (assert) {
    await visit('/test/docs/guides/README');
    await waitFor(`${article} h1`, { timeout: 15_000 });

    assert.dom(`${article} h1`).hasText('The Choreo guides');
    assert
      .dom('[data-test-guide-nav] [aria-current="page"]')
      .hasText('All guides', 'the index is the one marked');
    assert
      .dom(`${article} a[href="core-start"]`)
      .exists('and its list leads to the guides’ pages');
  });
});
