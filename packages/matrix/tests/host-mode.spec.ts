import { expect, test } from './fixtures';
import {
  createRealm,
  createSubscribedUserAndLogin,
  login,
  logout,
  postCardSource,
  waitUntil,
} from '../helpers';
import { appURL } from '../helpers/isolated-realm-server';
import { randomUUID } from 'crypto';

test.describe('Host mode', () => {
  let realmURL: string;
  let publishedRealmURL: string;
  let publishedCardURL: string;
  let publishedWhitePaperCardURL: string;
  let publishedMyCardURL: string;
  let connectRouteURL: string;
  let username: string;
  let password: string;

  test.beforeEach(async ({ page }) => {
    const serverIndexUrl = new URL(appURL).origin;
    const user = await createSubscribedUserAndLogin(
      page,
      'host-mode',
      serverIndexUrl,
    );
    username = user.username;
    password = user.password;

    const realmName = `host-mode-${randomUUID()}`;

    await createRealm(page, realmName);
    realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;

    await page.goto(realmURL);
    await page.locator('[data-test-stack-item-content]').first().waitFor();

    await postCardSource(
      page,
      realmURL,
      'host-mode-isolated-card.gts',
      `
        import { CardDef, Component } from 'https://cardstack.com/base/card-api';

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
        import { CardDef, Component } from 'https://cardstack.com/base/card-api';

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
        import { CardDef, Component } from 'https://cardstack.com/base/card-api';

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

    await page.reload();
    await page.locator('[data-test-host-mode-isolated]').waitFor();

    publishedRealmURL = `https://published.localhost:4205/${username}/${realmName}/`;

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

        return response.json();
      },
      { realmURL, publishedRealmURL },
    );

    publishedCardURL = `${publishedRealmURL}index.json`;
    publishedWhitePaperCardURL = `${publishedRealmURL}white-paper.json`;
    publishedMyCardURL = `${publishedRealmURL}my-card.json`;
    connectRouteURL = `https://localhost:4205/connect/${encodeURIComponent(
      publishedRealmURL,
    )}`;

    await logout(page);
  });

  test('published card response includes isolated template markup', async ({
    page,
  }) => {
    let html = await waitUntil(async () => {
      let response = await page.request.get(publishedCardURL, {
        headers: { Accept: 'text/html' },
      });

      if (!response.ok()) {
        return false;
      }

      let text = await response.text();
      return text.includes('data-test-host-mode-isolated') ? text : false;
    });

    expect(html).toContain('data-test-host-mode-isolated');

    await page.goto(publishedCardURL);
    await expect(page.locator('[data-test-host-mode-isolated]')).toBeVisible();
    await expect(page.locator('body.boxel-ready')).toBeAttached();
  });

  test('printed isolated card produces a stable page count', async ({
    page,
  }) => {
    await page.goto(publishedWhitePaperCardURL);
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
    await page.goto(publishedCardURL);

    await expect(
      page.locator(`[data-test-card="${publishedRealmURL}index"]`),
    ).toBeVisible();

    let connectIframe = page.frameLocator('iframe');
    await expect(connectIframe.locator('[data-test-connect]')).toBeVisible();
  });

  test.skip('clicking connect button logs in on main site and redirects back to host mode', async ({
    page,
  }) => {
    await page.goto(publishedCardURL);

    await expect(page.locator('iframe')).toBeVisible();

    let connectIframe = page.frameLocator('iframe');
    await connectIframe.locator('[data-test-connect]').click();

    await page.locator('[data-test-username-field]').fill(username);
    await page.locator('[data-test-password-field]').fill(password);
    await page.locator('[data-test-login-btn]').click();

    await expect(page).toHaveURL(publishedCardURL);

    await expect(page.locator('iframe')).toBeVisible();
    connectIframe = page.frameLocator('iframe');
    await expect(
      connectIframe.locator(
        `[data-test-profile-icon-userid="@${username}:localhost"]`,
      ),
    ).toBeVisible();
  });

  test('visiting connect route with known origin includes a matching frame-ancestors CSP', async ({
    page,
  }) => {
    let response = await page.goto(connectRouteURL);

    expect(response?.headers()['content-security-policy']).toBe(
      `frame-ancestors ${publishedRealmURL}`,
    );
  });

  test('visiting connect route with origin not in realm_registry returns 404', async ({
    page,
  }) => {
    let response = await page.goto(
      'https://localhost:4205/connect/http%3A%2F%2Fexample.com',
    );

    expect(response?.status()).toBe(404);
    expect(await page.textContent('body')).toContain(
      'No published realm found for origin http://example.com',
    );
  });

  test('page title comes from head format template', async ({ page }) => {
    await page.goto(publishedMyCardURL);
    await page.locator('[data-test-card-with-head-title]').waitFor();

    // Wait for the head template to be injected
    await waitUntil(async () => {
      const title = await page.title();
      return title === 'My Custom Title From Head Template';
    });

    const pageTitle = await page.title();
    expect(pageTitle).toBe('My Custom Title From Head Template');
  });

  // CS-10054 + CS-10055: routing rules in the realm config card resolve a
  // bare path (no .json extension) to a target card and render it in host
  // mode. This test fails until the host-mode request handler reads the
  // routing map from the indexed RealmConfig card and applies it.
  test('routing rule resolves a bare path to its target card', async ({
    page,
  }) => {
    // beforeEach logged out — re-login so we can write to the source realm.
    await login(page, username, password);
    await page.goto(realmURL);
    await page.locator('[data-test-stack-item-content]').first().waitFor();

    // Overwrite realm.json with a routing rule mapping /whitepaper to the
    // existing white-paper card. The auto-generated realm.json from
    // createRealm has no rules; we replace it before re-publishing.
    await postCardSource(
      page,
      realmURL,
      'realm.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            cardInfo: { name: `Routed Realm ${randomUUID()}` },
            hostRoutingRules: [{ path: '/whitepaper' }],
          },
          relationships: {
            'hostRoutingRules.0.instance': {
              links: { self: './white-paper' },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/realm-config',
              name: 'RealmConfig',
            },
          },
        },
      }),
    );

    // Re-publish so the routing rule lands in the published realm.
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

    await logout(page);

    // The _publish-realm POST returns 202 before the published realm has
    // finished re-indexing the new realm.json. Poll the bare URL until the
    // server-rendered HTML contains the target card's marker — that
    // confirms the routing rule is indexed AND the server cardURL rewrite
    // is applying it. Mirrors the waitUntil pattern in the
    // `published card response` test above.
    let routedURL = `${publishedRealmURL}whitepaper`;
    await waitUntil(async () => {
      let response = await page.request.get(routedURL, {
        headers: { Accept: 'text/html' },
      });
      if (!response.ok()) {
        return false;
      }
      let text = await response.text();
      return text.includes('data-test-white-paper');
    });

    await page.goto(routedURL);
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
    await login(page, username, password);
    await page.goto(realmURL);
    await page.locator('[data-test-stack-item-content]').first().waitFor();

    await postCardSource(
      page,
      realmURL,
      'realm.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            cardInfo: { name: `Routed Realm ${randomUUID()}` },
            hostRoutingRules: [{ path: '/' }],
          },
          relationships: {
            'hostRoutingRules.0.instance': {
              links: { self: './white-paper' },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/realm-config',
              name: 'RealmConfig',
            },
          },
        },
      }),
    );

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

    await logout(page);

    // Wait until the SSR HTML at the canonical (trailing-slash) URL
    // contains the routed card's marker, then navigate to the
    // NO-TRAILING-SLASH variant and assert the marker stays visible
    // through hydration. The no-slash navigation is what the
    // canonicalization fix targets.
    await waitUntil(async () => {
      let response = await page.request.get(publishedRealmURL, {
        headers: { Accept: 'text/html' },
      });
      if (!response.ok()) {
        return false;
      }
      let text = await response.text();
      return text.includes('data-test-white-paper');
    });

    let noSlashURL = publishedRealmURL.replace(/\/$/, '');
    await page.goto(noSlashURL);
    await expect(page.locator('[data-test-white-paper]')).toBeVisible();
  });
});
