import { expect, test } from './fixtures.ts';
import {
  createRealm,
  createSubscribedUserAndLogin,
  logout,
  postCardSource,
  setRealmRedirects,
  waitForPublishedMarker,
  waitUntil,
} from '../helpers/index.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import { randomUUID } from 'crypto';
import type { Page } from '@playwright/test';

interface PublishedHostModeRealm {
  username: string;
  password: string;
  realmURL: string;
  publishedRealmURL: string;
  publishedCardURL: string;
  publishedWhitePaperCardURL: string;
  publishedMyCardURL: string;
  connectRouteURL: string;
}

// POST /_publish-realm using the source realm's session token. Returns once
// the server accepts the request; the published realm finishes re-indexing
// asynchronously, so callers must poll the published URL before navigating.
async function publishRealm(
  page: Page,
  realmURL: string,
  publishedRealmURL: string,
) {
  await page.evaluate(
    async ({ realmURL, publishedRealmURL }) => {
      let sessions = JSON.parse(
        window.localStorage.getItem('boxel-session') ?? '{}',
      );
      let token = sessions[realmURL];
      if (!token) {
        throw new Error(`No session token found for ${realmURL}`);
      }

      let response = await fetch('https://localhost:4205/_publish-realm', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: token,
        },
        body: JSON.stringify({
          sourceRealmURL: realmURL,
          publishedRealmURL,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }
    },
    { realmURL, publishedRealmURL },
  );

  // Publishing is 202/async. A published realm's rendered HTML is its
  // deliverable, so wait until its readiness check reports both indexed AND
  // rendered — `awaitPrerenderHtml` holds the readiness response until the
  // prerendered HTML is live, not just the index. This blocks server-side, so
  // one GET with a generous budget resolves when the realm is fully viewable
  // (rather than polling the served URL and racing the HTML job).
  let readinessURL = `${publishedRealmURL}_readiness-check?awaitPrerenderHtml=true`;
  let readiness = await page.request.get(readinessURL, {
    headers: { Accept: 'text/html' },
    timeout: 120_000,
  });
  if (!readiness.ok()) {
    throw new Error(
      `published realm did not become ready: HTTP ${readiness.status()} for ${readinessURL}`,
    );
  }
}

// Create a fresh source realm, seed it with the host-mode fixture cards, and
// publish it. Leaves the page logged out. The `page` must already have realm
// redirects registered (the per-test `page` fixture does this; a hand-rolled
// context page must call `setRealmRedirects` first).
//
// `options.routingRulePath` seeds a `realm.json` host routing rule (mapping
// that path to the white-paper card) BEFORE the single publish — so routing
// tests don't have to publish, rewrite realm.json, and re-publish. Each
// `_publish-realm` POST is the heaviest, contention-prone step in the suite,
// so collapsing two publishes into one is what keeps the routing tests from
// timing out on a first-attempt publish under shard load.
//
// `options.routingRuleTarget` overrides the rule's `instance` link (default
// `./white-paper`). Point it at a card that is never created to exercise a
// dangling routing target.
async function createAndPublishHostModeRealm(
  page: Page,
  options: { routingRulePath?: string; routingRuleTarget?: string } = {},
): Promise<PublishedHostModeRealm> {
  const serverIndexUrl = new URL(appURL).origin;
  const { username, password } = await createSubscribedUserAndLogin(
    page,
    'host-mode',
    serverIndexUrl,
  );

  const realmName = `host-mode-${randomUUID()}`;

  await createRealm(page, realmName);
  const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;

  await page.goto(realmURL, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-test-stack-item-content]').first().waitFor();

  await postCardSource(
    page,
    realmURL,
    'host-mode-isolated-card.gts',
    `
      import { CardDef, Component } from '@cardstack/base/card-api';

      export class HostModeIsolatedCard extends CardDef {
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <p data-test-host-mode-isolated>Host mode isolated</p>
          </template>
        };
      }
    `,
  );

  await postCardSource(
    page,
    realmURL,
    'white-paper-card.gts',
    `
      import { CardDef, Component } from '@cardstack/base/card-api';

      export class WhitePaperCard extends CardDef {
        static prefersWideFormat = true;

        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <article class='white-paper' data-test-white-paper>
              <section class='page-block'>Page 1</section>
              <section class='page-block'>Page 2</section>
              <section class='page-block'>Page 3</section>
            </article>
            <style scoped>
              .white-paper {
                padding: 0;
                margin: 0;
                font-family: serif;
              }

              .page-block {
                height: 9.5in;
                padding: 0.75in;
                box-sizing: border-box;
              }

              @media print {
                .page-block {
                  break-after: page;
                  page-break-after: always;
                }

                .page-block:last-child {
                  break-after: auto;
                  page-break-after: auto;
                }
              }
            </style>
          </template>
        };
      }
    `,
  );

  await postCardSource(
    page,
    realmURL,
    'index.json',
    JSON.stringify({
      data: {
        type: 'card',
        attributes: {},
        meta: {
          adoptsFrom: {
            module: './host-mode-isolated-card.gts',
            name: 'HostModeIsolatedCard',
          },
        },
      },
    }),
  );

  await postCardSource(
    page,
    realmURL,
    'white-paper.json',
    JSON.stringify({
      data: {
        type: 'card',
        attributes: {},
        meta: {
          adoptsFrom: {
            module: './white-paper-card.gts',
            name: 'WhitePaperCard',
          },
        },
      },
    }),
  );

  await postCardSource(
    page,
    realmURL,
    'card-with-head-title.gts',
    `
      import { CardDef, Component } from '@cardstack/base/card-api';

      export class CardWithHeadTitle extends CardDef {
        static displayName = 'Card With Head Title';

        static head = class Head extends Component<typeof this> {
          <template>
            {{! template-lint-disable no-forbidden-elements }}
            <title>My Custom Title From Head Template</title>
            <meta name='description' content='A card with a custom title' />
          </template>
        };

        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <p data-test-card-with-head-title>Card content</p>
          </template>
        };
      }
    `,
  );

  await postCardSource(
    page,
    realmURL,
    'my-card.json',
    JSON.stringify({
      data: {
        type: 'card',
        attributes: {},
        meta: {
          adoptsFrom: {
            module: './card-with-head-title.gts',
            name: 'CardWithHeadTitle',
          },
        },
      },
    }),
  );

  if (options.routingRulePath) {
    // Overwrite the auto-generated realm.json with a host routing rule that
    // maps the given path to the white-paper card posted above. Seeding it
    // here means the rule is present at the initial publish, so the routing
    // tests need only one publish instead of publish-then-republish.
    await postCardSource(
      page,
      realmURL,
      'realm.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            cardInfo: { name: `Routed Realm ${randomUUID()}` },
            hostRoutingRules: [{ path: options.routingRulePath }],
          },
          relationships: {
            'hostRoutingRules.0.instance': {
              links: { self: options.routingRuleTarget ?? './white-paper' },
            },
          },
          meta: {
            adoptsFrom: {
              module: '@cardstack/base/realm-config',
              name: 'RealmConfig',
            },
          },
        },
      }),
    );
  }

  await page.reload();
  await page.locator('[data-test-host-mode-isolated]').waitFor();

  const publishedRealmURL = `https://published.localhost:4205/${username}/${realmName}/`;

  await publishRealm(page, realmURL, publishedRealmURL);

  await logout(page);

  return {
    username,
    password,
    realmURL,
    publishedRealmURL,
    publishedCardURL: `${publishedRealmURL}index.json`,
    publishedWhitePaperCardURL: `${publishedRealmURL}white-paper.json`,
    publishedMyCardURL: `${publishedRealmURL}my-card.json`,
    connectRouteURL: `https://localhost:4205/connect/${encodeURIComponent(
      publishedRealmURL,
    )}`,
  };
}

// Read-only tests share a single published realm created once per worker.
// Publishing fans out a full reindex + prerender; doing it once instead of in
// a per-test `beforeEach` removes the prerender storm that drove the flake.
test.describe('Host mode', () => {
  let realm: PublishedHostModeRealm;

  test.beforeAll(async ({ browser }) => {
    // This shared setup does the work of several tests' setup, and a failure
    // here fails the whole read-only group — so give it a longer budget and
    // retry with a fresh context. Retrying in-hook (rather than leaning on
    // Playwright's hook retry) avoids the failure mode where the hand-rolled
    // context wedges and every subsequent retry times out closing it.
    test.setTimeout(180_000);
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      // `beforeAll` only has access to worker-scoped fixtures, so build a
      // throwaway context by hand. Publishing is server-side state that
      // outlives this context, so we close it once setup is done.
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await setRealmRedirects(page);
        realm = await createAndPublishHostModeRealm(page);
        // Don't let a wedged context's close error mask a successful setup.
        await context.close().catch(() => {});
        return;
      } catch (e) {
        lastError = e;
        console.log(
          `[host-mode beforeAll] setup attempt ${attempt}/3 failed: ${
            (e as Error)?.message
          }`,
        );
        await context.close().catch(() => {});
      }
    }
    throw lastError;
  });

  test('published card response includes isolated template markup', async ({
    page,
  }) => {
    // Same readiness-gate budget as waitForPublishedMarker (not waitUntil's
    // 10s default) — the realm may still be indexing under CI load.
    let html = await waitUntil(async () => {
      let response = await page.request.get(realm.publishedCardURL, {
        headers: { Accept: 'text/html' },
      });

      if (!response.ok()) {
        return false;
      }

      let text = await response.text();
      return text.includes('data-test-host-mode-isolated') ? text : false;
    }, 45_000);

    expect(html).toContain('data-test-host-mode-isolated');

    await page.goto(realm.publishedCardURL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-test-host-mode-isolated]')).toBeVisible();
    await expect(page.locator('body.boxel-ready')).toBeAttached();
  });

  test('printed isolated card produces a stable page count', async ({
    page,
  }) => {
    // Warm up so we only navigate once the published card is render-ready;
    // navigating cold is what previously timed out under load.
    let warmupStart = Date.now();
    await waitForPublishedMarker(
      page,
      realm.publishedWhitePaperCardURL,
      'data-test-white-paper',
    );
    // Diagnostic: if this test ever times out again, the warm-up timing
    // tells us whether the prerender was the slow part (long warm-up) or
    // the navigation itself stalled (short warm-up, then goto hangs).
    console.log(
      `[host-mode print] warm-up ready after ${Date.now() - warmupStart}ms`,
    );

    let gotoStart = Date.now();
    await page.goto(realm.publishedWhitePaperCardURL, {
      waitUntil: 'domcontentloaded',
    });
    console.log(
      `[host-mode print] page.goto resolved after ${Date.now() - gotoStart}ms`,
    );
    await page.locator('[data-test-white-paper]').waitFor();
    await page.locator('[data-test-host-mode-card-loaded]').waitFor();
    await page.emulateMedia({ media: 'print' });
    let pdf = await page.pdf({ format: 'Letter', printBackground: true });
    let pageCount =
      pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;

    expect(pageCount).toBe(3);
  });

  test.skip('card in a published realm renders in host mode with a connect button', async ({
    page,
  }) => {
    await page.goto(realm.publishedCardURL, { waitUntil: 'domcontentloaded' });

    await expect(
      page.locator(`[data-test-card="${realm.publishedRealmURL}index"]`),
    ).toBeVisible();

    let connectIframe = page.frameLocator('iframe');
    await expect(connectIframe.locator('[data-test-connect]')).toBeVisible();
  });

  test.skip('clicking connect button logs in on main site and redirects back to host mode', async ({
    page,
  }) => {
    await page.goto(realm.publishedCardURL, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('iframe')).toBeVisible();

    let connectIframe = page.frameLocator('iframe');
    await connectIframe.locator('[data-test-connect]').click();

    await page.locator('[data-test-username-field]').fill(realm.username);
    await page.locator('[data-test-password-field]').fill(realm.password);
    await page.locator('[data-test-login-btn]').click();

    await expect(page).toHaveURL(realm.publishedCardURL);

    await expect(page.locator('iframe')).toBeVisible();
    connectIframe = page.frameLocator('iframe');
    await expect(
      connectIframe.locator(
        `[data-test-profile-icon-userid="@${realm.username}:localhost"]`,
      ),
    ).toBeVisible();
  });

  test('visiting connect route with known origin includes a matching frame-ancestors CSP', async ({
    page,
  }) => {
    let response = await page.goto(realm.connectRouteURL, {
      waitUntil: 'domcontentloaded',
    });

    expect(response?.headers()['content-security-policy']).toBe(
      `frame-ancestors ${realm.publishedRealmURL}`,
    );
  });

  test('visiting connect route with origin not in realm_registry returns 404', async ({
    page,
  }) => {
    let response = await page.goto(
      'https://localhost:4205/connect/http%3A%2F%2Fexample.com',
      { waitUntil: 'domcontentloaded' },
    );

    expect(response?.status()).toBe(404);
    expect(await page.textContent('body')).toContain(
      'No published realm found for origin http://example.com',
    );
  });

  test('page title comes from head format template', async ({ page }) => {
    // Warm up before the cold navigation (see `waitForPublishedMarker`).
    await waitForPublishedMarker(
      page,
      realm.publishedMyCardURL,
      'data-test-card-with-head-title',
    );

    await page.goto(realm.publishedMyCardURL, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('[data-test-card-with-head-title]').waitFor();

    // Wait for the head template to be injected
    await waitUntil(async () => {
      const title = await page.title();
      return title === 'My Custom Title From Head Template';
    });

    const pageTitle = await page.title();
    expect(pageTitle).toBe('My Custom Title From Head Template');
  });
});

// Each test gets its own realm, published once with the routing rule already
// seeded into realm.json (see `createAndPublishHostModeRealm`) — no
// rewrite-and-republish, which is what made these the suite's heaviest,
// flakiest tests.
test.describe('Host mode routing rules', () => {
  // CS-10054 + CS-10055: routing rules in the realm config card resolve a
  // bare path (no .json extension) to a target card and render it in host
  // mode. This test fails until the host-mode request handler reads the
  // routing map from the indexed RealmConfig card and applies it.
  test('routing rule resolves a bare path to its target card', async ({
    page,
  }) => {
    let realm = await createAndPublishHostModeRealm(page, {
      routingRulePath: '/whitepaper',
    });

    // Poll the bare URL until the server-rendered HTML contains the target
    // card's marker — that confirms the routing rule is indexed in the
    // published realm AND the server cardURL rewrite is applying it.
    let routedURL = `${realm.publishedRealmURL}whitepaper`;
    await waitForPublishedMarker(page, routedURL, 'data-test-white-paper');

    await page.goto(routedURL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-test-white-paper]')).toBeVisible();
  });

  test('routing rule for `/` resolves when realm root is visited without a trailing slash', async ({
    page,
  }) => {
    // The realm publishes at e.g. `https://published.localhost:4205/<user>/<realm>/`
    // (with trailing slash). When a visitor types the URL without the
    // trailing slash, the server-rendered HTML is correct (the SSR
    // path-in-realm computation handles the missing slash), but the
    // Ember SPA's catch-all `/*path` strips the trailing slash from
    // the URL on the client side. Without canonicalization the
    // injected map key `/<user>/<realm>/` for the `/` rule wouldn't
    // match the client's `params.path === '<user>/<realm>'`, and
    // hydration would replace the SSR'd card with the bare-shell
    // fallback. This test pins the canonicalized comparator.
    let realm = await createAndPublishHostModeRealm(page, {
      routingRulePath: '/',
    });

    // Wait until the SSR HTML at the canonical (trailing-slash) URL
    // contains the routed card's marker, then navigate to the
    // NO-TRAILING-SLASH variant and assert the marker stays visible
    // through hydration. The no-slash navigation is what the
    // canonicalization fix targets.
    await waitForPublishedMarker(
      page,
      realm.publishedRealmURL,
      'data-test-white-paper',
    );

    let noSlashURL = realm.publishedRealmURL.replace(/\/$/, '');
    // The no-slash URL is a distinct server-render path from the
    // trailing-slash one gated above; warm it on its own before
    // navigating so `page.goto` doesn't race a cold render of this
    // variant under prerender-pool load (a cold no-slash render that
    // outruns the 60s test timeout is the flake this gate closes).
    await waitForPublishedMarker(page, noSlashURL, 'data-test-white-paper');
    await page.goto(noSlashURL, { waitUntil: 'domcontentloaded' });
    // `[data-test-host-mode-card="<id>"]` is set by the host SPA's
    // CardRenderer — that attribute exists ONLY post-hydration (it's
    // not in the SSR'd isolated_html). Pinning it to the rule's target
    // id means:
    //   (a) `toBeVisible` implicitly waits for hydration to finish,
    //       so it can't pass on the brief SSR flash before the SPA
    //       replaces it; and
    //   (b) if the resolveRoutedPath miss makes the SPA fall back to
    //       the realm index card, the attribute value is `…/index`
    //       (or similar) and this assertion fails with a clear diff
    //       instead of silently catching the SSR'd marker.
    let expectedRoutedCardId = `${realm.publishedRealmURL}white-paper`;
    await expect(
      page.locator(`[data-test-host-mode-card="${expectedRoutedCardId}"]`),
    ).toBeVisible();
  });

  // A routing rule whose target card no longer exists must degrade
  // gracefully: the realm config keeps the rule (the read path only filters
  // cross-realm targets, not missing ones), so serve-index rewrites the root
  // to the dead card and the SPA's first store fetch for it 404s. Rather than
  // taking the whole published site down with a raw card error, the host
  // renders a friendly 404 placeholder for that path.
  test('dangling `/` routing rule target renders a 404 placeholder', async ({
    page,
  }) => {
    let realm = await createAndPublishHostModeRealm(page, {
      routingRulePath: '/',
      // Never created in the helper, so the rule dangles.
      routingRuleTarget: './dangling-target',
    });

    // The usual card-marker gate can't be used here: the target 404s, so
    // no isolated HTML is ever served at the root. Gate instead on the
    // dead target's id appearing in serve-index's injected hostRoutingMap
    // — that confirms the RealmConfig card is indexed and the rewrite is
    // live (the base config ships an empty hostRoutingMap, so the slug
    // only shows up once the rule is active).
    await waitForPublishedMarker(
      page,
      realm.publishedRealmURL,
      'dangling-target',
    );

    await page.goto(realm.publishedRealmURL, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.locator('[data-test-host-mode-404]')).toBeVisible();
  });
});
