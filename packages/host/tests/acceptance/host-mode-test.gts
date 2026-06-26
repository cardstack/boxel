import { getOwner } from '@ember/owner';
import {
  click,
  currentURL,
  visit,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { getPageTitle } from 'ember-page-title/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Deferred } from '@cardstack/runtime-common';

import HostModeService from '@cardstack/host/services/host-mode-service';
import type StoreService from '@cardstack/host/services/store';

import {
  percySnapshot,
  setupLocalIndexing,
  setupOnSave,
  testHostModeRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  setupAuthEndpoints,
  setupUserSubscription,
  realmConfigCardJSON,
} from '../helpers';
import { viewCardDemoCardSource } from '../helpers/cards/view-card-demo';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

let testHostModeRealmURLWithoutRealm = testHostModeRealmURL.replace(
  /\/test\/?$/,
  '',
);

// Overrides to simulate a request to a host mode domain
class StubHostModeService extends HostModeService {
  get isActive() {
    return true;
  }

  get hostModeOrigin() {
    return removeTrailingSlash(testHostModeRealmURLWithoutRealm);
  }
}

class StubCustomSubdomainHostModeService extends StubHostModeService {
  get hostModeOrigin() {
    return removeTrailingSlash(testHostModeRealmURL);
  }
}

module('Acceptance | host mode tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testHostModeRealmURL],
  });

  let { setActiveRealms, setExpiresInSec, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(function (this) {
    let owner = getOwner(this)!;
    let ownerWithUnregister = owner as {
      unregister?: (fullName: string) => void;
    };
    ownerWithUnregister.unregister?.('service:host-mode-service');
    owner.register('service:host-mode-service', StubHostModeService);
  });

  hooks.beforeEach(async function () {
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    setExpiresInSec(60 * 60);

    let loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class Pet extends CardDef {
      static displayName = 'Pet';
      static headerColor = '#355e3b';
      @field name = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}}>
            <@fields.name />
          </h3>
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div class='pet-isolated'>
            <h2 data-test-pet-isolated={{@model.name}}>
              <@fields.name />
            </h2>
          </div>
          <style scoped>
            .pet-isolated {
              height: 100%;
              background-color: #355e3b;
            }
            h2 {
              margin: 0;
              padding: 20px;
              color: white;
            }
          </style>
        </template>
      };
    }
    class Whitepaper extends CardDef {
      static displayName = 'Boxel Whitepaper';
      static prefersWideFormat = true;

      @field cardTitle = contains(StringField, {
        computeVia: function () {
          return 'Boxel Whitepaper';
        },
      });

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <article class='whitepaper' data-test-whitepaper>
            <header class='wp-header'>
              <h1>Boxel Whitepaper</h1>
              <p class='wp-subtitle'>A System for Composable Software in the Age
                of Abundant Code</p>
              <p class='wp-byline'>By Chris Tse, Cardstack Foundation — January
                2026</p>
            </header>
            <section>
              <h2>Executive Summary</h2>
              <p>We are witnessing the most significant shift in software
                development since the invention of high-level programming
                languages. Large language models (LLMs) can now generate
                functional code in seconds. Yet the infrastructure surrounding
                that code—the databases, the deployment pipelines, the security
                models, the economic relationships—remains trapped in paradigms
                from the 1990s.</p>
              <p>The result is a peculiar kind of friction. You can ask Claude
                to write you a React component in thirty seconds, but deploying
                that component to production still requires navigating a maze of
                Git repositories, CI/CD pipelines, environment variables, SSL
                certificates, and cloud provider dashboards. The intelligence
                has arrived, but the architecture hasn't caught up.</p>
              <p>Boxel is what comes next: a complete environment where
                AI-generated software can be created, run, evolved, and
                monetized without ever leaving a coherent system. Not another
                tool to add to your stack—a replacement for the stack itself.</p>
            </section>
            <section>
              <h2>1. The Fragmentation Problem</h2>
              <p>Open your browser tabs right now. If you're building anything
                with AI, you probably have ChatGPT or Claude open for ideation
                and code generation. Cursor or Windsurf for editing that code in
                context. V0 or Lovable for generating UI components. GitHub for
                version control. Vercel or Netlify for deployment. Notion or
                Confluence for documentation. Figma for design. Slack or Discord
                for communication.</p>
              <p>Each of these tools is excellent at what it does. Each
                represents millions of dollars in engineering investment and
                years of refinement. And each is a silo.</p>
              <p>The workflow: describe an idea to ChatGPT, copy the code into
                Cursor, commit to GitHub, deploy to Vercel, document in Notion,
                share in Slack. At each boundary, you lose context. The AI that
                helped you write the code doesn't know how you deployed it. The
                documentation system doesn't understand the code it describes.</p>
              <p>The irony is acute. We have AI systems capable of understanding
                complex software in its entirety—but we force them to operate
                through disconnected interfaces, each with its own
                authentication, its own data model, its own limitations. We have
                given AI the ability to think holistically while constraining it
                to act in fragments.</p>
            </section>
          </article>

          <style scoped>
            .whitepaper {
              max-width: 50rem;
              margin: 0 auto;
              padding: 2rem;
              font-family: Georgia, serif;
              line-height: 1.7;
            }
            .wp-header {
              border-bottom: 2px solid var(--boxel-purple, #6638d0);
              margin-bottom: 2rem;
              padding-bottom: 1rem;
            }
            h1 {
              font-size: 2rem;
              margin: 0 0 0.5rem;
            }
            h2 {
              font-size: 1.3rem;
              margin: 2rem 0 0.75rem;
            }
            p {
              margin: 0 0 1rem;
            }
            .wp-subtitle {
              font-style: italic;
              font-size: 1.1rem;
              margin: 0 0 0.25rem;
            }
            .wp-byline {
              color: #666;
              font-size: 0.9rem;
              margin: 0;
            }
          </style>
        </template>
      };
    }

    await setupAcceptanceTestRealm({
      realmURL: testHostModeRealmURL,
      mockMatrixUtils,
      permissions: {
        '*': ['read'],
      },
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'pet.gts': { Pet },
        'whitepaper.gts': { Whitepaper },
        'view-card-demo.gts': viewCardDemoCardSource,
        'Whitepaper/index.json': {
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: `${testHostModeRealmURL}whitepaper`,
                name: 'Whitepaper',
              },
            },
          },
        },
        'Pet/mango.json': {
          data: {
            attributes: {
              name: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: `${testHostModeRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'ViewCardDemo/index.json': {
          data: {
            type: 'card',
            attributes: {
              cardTitle: 'Primary View Demo',
              targetCardURL: `${testHostModeRealmURL}ViewCardDemo/secondary.json`,
            },
            meta: {
              adoptsFrom: {
                module: `${testHostModeRealmURL}view-card-demo`,
                name: 'ViewCardDemo',
              },
            },
          },
        },
        'ViewCardDemo/secondary.json': {
          data: {
            type: 'card',
            attributes: {
              cardTitle: 'Secondary View Demo',
              targetCardURL: `${testHostModeRealmURL}ViewCardDemo/tertiary.json`,
            },
            meta: {
              adoptsFrom: {
                module: `${testHostModeRealmURL}view-card-demo`,
                name: 'ViewCardDemo',
              },
            },
          },
        },
        'ViewCardDemo/tertiary.json': {
          data: {
            type: 'card',
            attributes: {
              cardTitle: 'Tertiary View Demo',
              targetCardURL: `${testHostModeRealmURL}ViewCardDemo/index.json`,
            },
            meta: {
              adoptsFrom: {
                module: `${testHostModeRealmURL}view-card-demo`,
                name: 'ViewCardDemo',
              },
            },
          },
        },
        'index.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
        'broken-card.gts': `
          import { contains, field, Component, CardDef } from 'https://cardstack.com/base/card-api';
          import StringField from 'https://cardstack.com/base/string';
          export class BrokenCard extends CardDef {
            static displayName = 'BrokenCard';
            @field name = contains(StringField);
            static isolated = class Isolated extends Component<typeof this> {
              <template><div>{{this.triggerError}}</div></template>
              get triggerError() {
                throw new Error('Intentional rendering error');
              }
            };
          }
        `,
        'BrokenCard/broken.json': {
          data: {
            attributes: {
              name: 'Broken',
            },
            meta: {
              adoptsFrom: {
                module: `${testHostModeRealmURL}broken-card`,
                name: 'BrokenCard',
              },
            },
          },
        },
        // A valid card definition whose module imports a dependency that does
        // not exist, so resolving the import 404s. The card itself is found;
        // it just can't load because a dependency is missing — a legitimate
        // error state, distinct from the card not being found.
        'missing-dep-card.gts': `
          import { Component, CardDef } from 'https://cardstack.com/base/card-api';
          import { MissingThing } from './missing-dependency';
          export class MissingDepCard extends CardDef {
            static displayName = 'MissingDepCard';
            static isolated = class Isolated extends Component<typeof this> {
              <template><div>{{MissingThing}}</div></template>
            };
          }
        `,
        'MissingDepCard/instance.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: `${testHostModeRealmURL}missing-dep-card`,
                name: 'MissingDepCard',
              },
            },
          },
        },
        'realm.json': realmConfigCardJSON({
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        }),
      },
    });

    setActiveRealms([testHostModeRealmURL]);
  });

  test('visiting a default width card in host mode', async function (assert) {
    await visit('/test/Pet/mango.json');

    assert.dom('[data-test-host-mode-content]').hasStyle({
      'background-image':
        'url("https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg")',
    });

    assert
      .dom(`[data-test-host-mode-card="${testHostModeRealmURL}Pet/mango"]`)
      .exists();
    assert.dom('[data-test-host-mode-content]').hasNoClass('is-wide');
    assert.strictEqual(getPageTitle(), 'Mango');

    await percySnapshot(assert);
  });

  test('visiting a full width card in host mode', async function (assert) {
    await visit('/test');

    assert
      .dom(`[data-test-host-mode-card="${testHostModeRealmURL}index"]`)
      .exists();
    assert.strictEqual(getPageTitle(), 'Test Workspace B');
    assert.dom('[data-test-host-mode-content]').hasClass('is-wide');

    await percySnapshot(assert);
  });

  test('host mode fetches the card head from the search API and injects it', async function (assert) {
    // The published page talks to its realm server directly (cookie creds), so
    // the head prefetch goes through the global fetch rather than the virtual
    // network. Intercept the head query, assert its shape, and answer with a
    // search-entry doc whose `html` resource carries the head markup so the
    // injection path is exercised end-to-end.
    let cardUrl = `${testHostModeRealmURL}Pet/mango`;
    let htmlId = `${cardUrl}#head#${testHostModeRealmURL}pet/Pet`;
    let capturedHeadQuery: any;
    let realFetch = globalThis.fetch;
    globalThis.fetch = async (input: any, init?: any) => {
      let url = typeof input === 'string' ? input : (input?.url ?? '');
      if (url.includes('_federated-search') && init?.body) {
        let body = JSON.parse(init.body);
        if (body?.filter?.eq?.htmlQuery) {
          capturedHeadQuery = body;
          return new Response(
            JSON.stringify({
              data: [
                {
                  type: 'search-entry',
                  id: cardUrl,
                  relationships: {
                    html: { data: [{ type: 'html', id: htmlId }] },
                  },
                },
              ],
              included: [
                {
                  type: 'html',
                  id: htmlId,
                  attributes: {
                    format: 'head',
                    html: '<title data-test-card-head-title>Mango</title>\n<meta property="og:title" content="Mango" />',
                  },
                },
              ],
              meta: { page: { total: 1 } },
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/vnd.card+json' },
            },
          );
        }
      }
      return realFetch(input, init);
    };

    // The realm server serves index.html with these boundary markers, between
    // which the host injects the card's prerendered <head>. The test harness
    // index.html has none, so stand them in to observe the injection.
    let headStart = document.createElement('meta');
    headStart.setAttribute('data-boxel-head-start', '');
    let headEnd = document.createElement('meta');
    headEnd.setAttribute('data-boxel-head-end', '');
    document.head.append(headStart, headEnd);

    try {
      await visit('/test/Pet/mango.json');

      // The request is the head query: html-only fieldset, the `head`
      // htmlQuery, scoped to the visited card.
      assert.deepEqual(
        capturedHeadQuery?.fields,
        { 'search-entry': ['html'] },
        'requests only the html branch',
      );
      assert.strictEqual(
        capturedHeadQuery?.filter?.eq?.htmlQuery?.eq?.format,
        'head',
        'selects the head rendering',
      );
      assert.deepEqual(
        capturedHeadQuery?.cardUrls,
        [`${cardUrl}.json`],
        'scoped to the visited card',
      );

      // og:title is emitted only by the prerendered card <head> (ember-page-title
      // never does), so it uniquely marks the injected markup.
      let ogTitle = document.head.querySelector('meta[property="og:title"]');
      assert.ok(
        ogTitle,
        'the head markup from the search response is injected',
      );
      assert.strictEqual(
        ogTitle?.getAttribute('content'),
        'Mango',
        'the injected head markup is the visited card head',
      );

      let hostModeService = getService('host-mode-service') as HostModeService;
      assert.true(
        hostModeService.headTemplateContainsTitle,
        'the fetched head markup carries a title',
      );
    } finally {
      globalThis.fetch = realFetch;
      for (let node = headStart.nextSibling; node && node !== headEnd; ) {
        let next = node.nextSibling;
        node.remove();
        node = next;
      }
      headStart.remove();
      headEnd.remove();
    }
  });

  test('visiting a non-existent card shows an error', async function (assert) {
    let store = getService('store') as StoreService;
    let originalGet = store.get.bind(store);
    let gate = new Deferred<void>();
    let pending = new Deferred<void>();
    let targetId = `${testHostModeRealmURL}Pet/non-existent.json`;
    store.get = (async (...args: Parameters<StoreService['get']>) => {
      let [id] = args;
      if (id === targetId) {
        pending.fulfill();
        await gate.promise;
      }
      return (originalGet as StoreService['get'])(...args);
    }) as StoreService['get'];

    let visitPromise = visit('/test/Pet/non-existent.json');
    await pending.promise; // store.get is now blocked — loading state is active
    assert
      .dom('[data-test-host-loading]')
      .doesNotExist('Loading screen is never shown on host mode');
    gate.fulfill();

    await visitPromise;
    await waitFor('[data-test-host-mode-404]');
    assert
      .dom('[data-test-host-mode-404]')
      .containsText('This page could not be found.');
    assert.strictEqual(
      getPageTitle(),
      `Card not found: ${testHostModeRealmURL}Pet/non-existent`,
    );
    assert.dom('[data-test-host-loading]').doesNotExist();

    store.get = originalGet;
  });

  test('visiting a card whose dependency is missing surfaces the error rather than a 404', async function (assert) {
    await visit('/test/MissingDepCard/instance.json');

    await waitFor('[data-test-card-error]');
    // The card itself exists; one of its dependencies 404s. That is a
    // legitimate error state, not a missing card, so the error is surfaced
    // instead of the bare 404 placeholder.
    assert
      .dom('[data-test-host-mode-404]')
      .doesNotExist('a missing dependency is not a missing card');
    assert
      .dom('[data-test-card-error]')
      .containsText('This card contains an error');
    assert.strictEqual(
      getPageTitle(),
      `Error rendering ${testHostModeRealmURL}MissingDepCard/instance`,
    );
  });

  test('visiting a card with a rendering error shows an error', async function (assert) {
    await visit('/test/BrokenCard/broken.json');

    await waitFor('[data-test-card-error]');
    assert.dom('[data-test-card-error]').exists();
    assert
      .dom('[data-test-card-error]')
      .containsText('This card contains an error');
    assert.strictEqual(
      getPageTitle(),
      `Error rendering ${testHostModeRealmURL}BrokenCard/broken`,
    );
  });

  test('invoking viewCard from a card stacks the linked card', async function (assert) {
    let targetStackId = `${testHostModeRealmURL}ViewCardDemo/secondary`;

    await visit('/test/ViewCardDemo/index.json');

    await waitFor('[data-test-view-card-demo-button]');
    assert
      .dom(`[data-test-host-mode-stack-item="${targetStackId}"]`)
      .doesNotExist();

    await click('[data-test-view-card-demo-button]');
    await waitFor(`[data-test-host-mode-stack-item="${targetStackId}"]`);

    assert.dom(`[data-test-host-mode-stack-item="${targetStackId}"]`).exists();
  });

  test('clicking a card in card list stacks it', async function (assert) {
    await visit('/test'); // Visit the index card (CardsGrid)

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    // Wait for the cards grid to render with cards
    await waitFor('[data-test-cards-grid-item]');

    // Verify the pet card is not in the stack initially
    assert
      .dom(
        `[data-test-host-mode-stack-item="${testHostModeRealmURL}Pet/mango"]`,
      )
      .doesNotExist();

    // Click on the pet card in the list
    await click(
      `[data-test-cards-grid-item="${testHostModeRealmURL}Pet/mango"]`,
    );

    // Wait for the card to be added to the stack
    await waitFor(
      `[data-test-host-mode-stack-item="${testHostModeRealmURL}Pet/mango"]`,
    );

    // Verify the card is now in the stack
    assert
      .dom(
        `[data-test-host-mode-stack-item="${testHostModeRealmURL}Pet/mango"]`,
      )
      .exists();

    // Verify the card content is rendered
    assert.dom('[data-test-pet-isolated="Mango"]').exists();
  });

  test('viewCard tabs persist after stacking and closing cards in host mode', async function (assert) {
    let primaryCardId = `${testHostModeRealmURL}ViewCardDemo/index`;
    let firstStackCardId = `${testHostModeRealmURL}ViewCardDemo/secondary`;
    let secondStackCardId = `${testHostModeRealmURL}ViewCardDemo/tertiary`;

    await visit('/test/ViewCardDemo/index.json');

    let primaryCardSelector = `[data-test-host-mode-card="${primaryCardId}"]`;
    await waitFor(
      `${primaryCardSelector} [data-test-view-card-demo-active-tab]`,
    );
    await waitFor(`${primaryCardSelector} [data-test-view-card-demo-button]`);
    assert
      .dom(`${primaryCardSelector} [data-test-view-card-demo-active-tab]`)
      .hasAttribute('data-test-view-card-demo-active-tab', 'overview');

    await click(
      `${primaryCardSelector} [data-test-view-card-demo-tab="details"]`,
    );

    assert
      .dom(`${primaryCardSelector} [data-test-view-card-demo-active-tab]`)
      .hasAttribute('data-test-view-card-demo-active-tab', 'details');

    await click(`${primaryCardSelector} [data-test-view-card-demo-button]`);

    let firstStackSelector = `[data-test-host-mode-stack-item="${firstStackCardId}"]`;
    await waitFor(
      `${firstStackSelector} [data-test-view-card-demo-active-tab]`,
    );
    await waitFor(`${firstStackSelector} [data-test-view-card-demo-button]`);
    await waitFor(firstStackSelector);

    assert
      .dom(`${firstStackSelector} [data-test-view-card-demo-active-tab]`)
      .hasAttribute('data-test-view-card-demo-active-tab', 'overview');

    await click(
      `${firstStackSelector} [data-test-view-card-demo-tab="history"]`,
    );

    assert
      .dom(`${firstStackSelector} [data-test-view-card-demo-active-tab]`)
      .hasAttribute('data-test-view-card-demo-active-tab', 'history');

    await click(`${firstStackSelector} [data-test-view-card-demo-button]`);

    let secondStackSelector = `[data-test-host-mode-stack-item="${secondStackCardId}"]`;
    await waitFor(`${secondStackSelector} [data-test-view-card-demo-button]`);
    await waitFor(secondStackSelector);

    await click(`[data-test-host-mode-breadcrumb="${firstStackCardId}"]`);

    await waitUntil(() => {
      return !document.querySelector(secondStackSelector);
    });

    assert
      .dom(`${firstStackSelector} [data-test-view-card-demo-active-tab]`)
      .hasAttribute('data-test-view-card-demo-active-tab', 'history');

    await click(`[data-test-host-mode-breadcrumb="${primaryCardId}"]`);

    await waitUntil(() => {
      return !document.querySelector(firstStackSelector);
    });

    assert
      .dom(`${primaryCardSelector} [data-test-view-card-demo-active-tab]`)
      .hasAttribute('data-test-view-card-demo-active-tab', 'details');
  });

  test('stack state persists in query parameter', async function (assert) {
    let hostModeStackValue = encodeURIComponent(
      JSON.stringify([`${testHostModeRealmURL}index`]),
    );

    await visit(`/test/Pet/mango.json?hostModeStack=${hostModeStackValue}`);

    assert
      .dom(`[data-test-host-mode-stack-item="${testHostModeRealmURL}index"]`)
      .exists();
    await click(
      `[data-test-host-mode-stack-item="${testHostModeRealmURL}index"] [data-test-host-stack-item-close-button]`,
    );

    assert.strictEqual(currentURL(), '/test/Pet/mango.json');
    assert.strictEqual(
      new URL(window.location.href).searchParams.get('hostModeStack'),
      null,
    );
  });

  test('clicking the stack backdrop closes the top card', async function (assert) {
    let hostModeStackValue = encodeURIComponent(
      JSON.stringify([`${testHostModeRealmURL}index`]),
    );
    await visit(`/test/Pet/mango.json?hostModeStack=${hostModeStackValue}`);

    // Wait for stack item to appear
    await waitFor(
      `[data-test-host-mode-stack-item="${testHostModeRealmURL}index"]`,
    );

    // Verify stack item exists
    assert
      .dom(`[data-test-host-mode-stack-item="${testHostModeRealmURL}index"]`)
      .exists();

    // Click outside the stack items (on the stack backdrop area)
    await click('[data-test-host-mode-stack]');

    // Stack item should be removed
    await waitUntil(() => {
      return !document.querySelector(
        `[data-test-host-mode-stack-item="${testHostModeRealmURL}index"]`,
      );
    });
    assert
      .dom(`[data-test-host-mode-stack-item="${testHostModeRealmURL}index"]`)
      .doesNotExist();
  });

  test('clicking on a stack card does not close it', async function (assert) {
    let hostModeStackValue = encodeURIComponent(
      JSON.stringify([`${testHostModeRealmURL}index`]),
    );
    await visit(`/test/Pet/mango.json?hostModeStack=${hostModeStackValue}`);

    let stackSelector = `[data-test-host-mode-stack-item="${testHostModeRealmURL}index"]`;
    assert.dom(stackSelector).exists();

    // Click on the card content itself
    await click(stackSelector);

    // Card should still exist
    assert.dom(stackSelector).exists();
  });

  test('stack does not exist when there are no stacked cards', async function (assert) {
    // Visit card with no stack
    await visit('/test/Pet/mango.json');

    // Stack shouldn't exist when there are no stacked cards
    assert.dom('[data-test-host-mode-stack]').doesNotExist();
  });

  test('scroll position is restored on card container after hydration', async function (assert) {
    // Inject boundary markers and a fake prerendered card container between
    // them, simulating the prerendered HTML served before JS loads. The
    // container has a fixed height so its content overflows and scrollTop can
    // be set non-zero.
    let start = document.createElement('div');
    start.id = 'boxel-isolated-start';
    let end = document.createElement('div');
    end.id = 'boxel-isolated-end';
    let fakeContainer = document.createElement('div');
    fakeContainer.style.cssText = 'height: 200px; overflow-y: auto;';
    fakeContainer.innerHTML = '<div style="height: 2000px;"></div>';
    document.body.appendChild(start);
    document.body.appendChild(fakeContainer);
    document.body.appendChild(end);
    // Must set scrollTop after the element is in the DOM
    fakeContainer.scrollTop = 150;

    // Constrain the Ember-rendered card container so it can also hold a scroll
    // offset (overflow-y: auto is already set; we just need a bounded height)
    let testStyle = document.createElement('style');
    testStyle.setAttribute('data-test-scroll-override', '');
    testStyle.textContent =
      '[data-test-host-mode-card-loaded] { height: 400px !important; max-height: 400px !important; }';
    document.head.appendChild(testStyle);

    try {
      await visit('/test/Whitepaper/index.json');
      await waitFor('[data-test-whitepaper]');

      assert.dom('[data-host-mode-card-scroll-container]').exists();
      let cardContainer = document.querySelector(
        '[data-host-mode-card-scroll-container]',
      ) as HTMLElement;
      assert.strictEqual(
        cardContainer.scrollTop,
        150,
        'scroll position from prerendered container is restored on the hydrated card scroll host',
      );
    } finally {
      document.querySelector('[data-test-scroll-override]')?.remove();
      start.remove();
      end.remove();
      fakeContainer.remove();
    }
  });

  module('with a custom subdomain', function (hooks) {
    hooks.beforeEach(function (this) {
      let owner = getOwner(this)!;
      let ownerWithUnregister = owner as {
        unregister?: (fullName: string) => void;
      };
      ownerWithUnregister.unregister?.('service:host-mode-service');
      owner.register(
        'service:host-mode-service',
        StubCustomSubdomainHostModeService,
      );
    });

    test('visiting a card in host mode', async function (assert) {
      await visit('/Pet/mango.json');

      assert
        .dom(`[data-test-host-mode-card="${testHostModeRealmURL}Pet/mango"]`)
        .exists();
    });
  });
});

function removeTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
