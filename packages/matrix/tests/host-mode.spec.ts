import { expect, test } from './fixtures';
import { createRealm, createSubscribedUserAndLogin, logout } from '../helpers';
import { appURL } from '../helpers/isolated-realm-server';
import { randomUUID } from 'crypto';

test.skip('Host mode', () => {
  let publishedRealmURL: string;
  let publishedCardURL: string;
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
    connectRouteURL = `http://localhost:4205/connect/${encodeURIComponent(
      publishedRealmURL,
    )}`;

    await logout(page);
  });

  test('card in a published realm renders in host mode with a connect button', async ({
    page,
  }) => {
    await page.goto(publishedCardURL);

    await expect(
      page.locator(`[data-test-card="${publishedRealmURL}index"]`),
    ).toBeVisible();

    let connectIframe = page.frameLocator('iframe');
    await expect(connectIframe.locator('[data-test-connect]')).toBeVisible();
  });

  test('clicking connect button logs in on main site and redirects back to host mode', async ({
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
});
