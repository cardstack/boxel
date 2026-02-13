import { expect, test } from './fixtures';
import {
  createRealm,
  createSubscribedUserAndLogin,
  logout,
  postCardSource,
  waitUntil,
} from '../helpers';
import { appURL } from '../helpers/isolated-realm-server';
import { randomUUID } from 'crypto';

test.describe('Host mode', () => {
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
    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;

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

    publishedRealmURL = `http://published.localhost:4205/${username}/${realmName}/`;

    await page.evaluate(
      async ({ realmURL, publishedRealmURL }) => {
        let sessions = JSON.parse(
          window.localStorage.getItem('boxel-session') ?? '{}',
        );
        let token = sessions[realmURL];
        if (!token) {
          throw new Error(`No session token found for ${realmURL}`);
        }

        let response = await fetch('http://localhost:4205/_publish-realm', {
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
    connectRouteURL = `http://localhost:4205/connect/${encodeURIComponent(
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
    await waitUntil(
      async () =>
        (await page.locator('[data-test-host-loading]').count()) === 0,
    );

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

  test('visiting connect route with origin not in published_realms returns 404', async ({
    page,
  }) => {
    let response = await page.goto(
      'http://localhost:4205/connect/http%3A%2F%2Fexample.com',
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
});
