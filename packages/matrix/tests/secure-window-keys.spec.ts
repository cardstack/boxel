import { expect, test } from './fixtures.ts';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { appURL, secureOriginURL } from '../support/isolated-realm-server.ts';
import {
  createRealm,
  createSubscribedUser,
  createSubscribedUserAndLogin,
  getSharedSQLExecutor,
  logout,
  postCardSource,
  postNewCard,
} from '../helpers/index.ts';

// The secure window's key pages, driven in a real browser against the real
// realm server: entering a key for a card's operation, the key page, sharing
// a key into a realm, swapping one into a suspended share, and the window
// going inert when the user signs out of the app while it is open. Each step
// is attached as a screenshot.

const STORAGE_KEY = 'boxel-secure-session';
const serverIndexUrl = new URL(appURL).origin;
const realmServer = new URL('/', appURL).href;

const WEATHER_SOURCE = `
  import { CardDef, field, contains, StringField } from '@cardstack/base/card-api';
  import { operation, params } from '@cardstack/base/operations';

  export class Weather extends CardDef {
    static displayName = 'Weather Report';
    @field city = contains(StringField);

    @operation static forecast = {
      base: 'callApi',
      label: 'Get the forecast',
      params: { day: StringField },
      url: 'https://api.weather.co.uk/v3/forecast/{day}',
      path: { day: params('day') },
      headers: { authorization: 'Bearer {{userKey}}' },
    };
  }
`;

async function snapshot(testInfo: TestInfo, page: Page, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

function uniqueRealmName(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function keysURL(mode: string, fragment: Record<string, string> = {}) {
  let hash = new URLSearchParams(fragment).toString();
  return `${secureOriginURL}?mode=${mode}${hash ? `#${hash}` : ''}`;
}

// Opens the secure window from the app page, as the command that opens it
// will: a popup, with no handle back to the page.
async function openFromApp(page: Page, url: string): Promise<Page> {
  let opened = page.context().waitForEvent('page');
  await page.evaluate((url) => {
    window.open(url, '_blank', 'noopener,popup,width=520,height=720');
  }, url);
  let secure = await opened;
  await secure.setViewportSize({ width: 520, height: 720 });
  return secure;
}

// A page of the secure origin the user opens themselves. Script can't close
// such a window, so its last page stays to be seen.
async function openDirectly(
  context: { newPage(): Promise<Page> },
  url: string,
): Promise<Page> {
  let secure = await context.newPage();
  await secure.setViewportSize({ width: 520, height: 720 });
  await secure.goto(url);
  return secure;
}

async function signIn(secure: Page, username: string, password: string) {
  await secure.locator('[data-test-secure-username]').fill(username);
  await secure.locator('[data-test-secure-password]').fill(password);
  await secure.locator('[data-test-secure-password-submit]').click();
}

// Keeps a window open once its change is made, so the page it ends on can be
// seen.
async function keepOpen(secure: Page) {
  await secure.evaluate(() => {
    window.close = () => {};
  });
}

// A request to the realm server with the secure window's own session, made
// from the window as its pages make them.
async function asWindow(
  secure: Page,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  return await secure.evaluate(
    async ({ realmServer, path, init, key }) => {
      let { token } = JSON.parse(localStorage.getItem(key)!);
      let response = await fetch(`${realmServer}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      let text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    { realmServer, path, init, key: STORAGE_KEY },
  );
}

async function ticket(secure: Page, attributes: Record<string, unknown>) {
  let response = await asWindow(secure, '_key-write-tickets', {
    method: 'POST',
    body: { data: { type: 'key-write-ticket', attributes } },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data.attributes.ticket as string;
}

// A user signed in to the app with a realm of their own holding a card whose
// operation sends the user's own key to `api.weather.co.uk`.
async function userWithWeatherCard(page: Page, prefix: string) {
  let user = await createSubscribedUserAndLogin(page, prefix, serverIndexUrl);
  let realmName = uniqueRealmName(prefix);
  await createRealm(page, realmName);
  let realmURL = new URL(`${user.username}/${realmName}/`, serverIndexUrl).href;
  await postCardSource(page, realmURL, 'weather.gts', WEATHER_SOURCE);
  let cardURL = await postNewCard(page, realmURL, {
    data: {
      type: 'card',
      attributes: { city: 'Leeds' },
      meta: { adoptsFrom: { module: `${realmURL}weather`, name: 'Weather' } },
    },
  });
  return { ...user, realmURL, realmName, cardURL };
}

async function secondUser(browser: Browser, prefix: string) {
  let user = await createSubscribedUser(prefix);
  let context = await browser.newContext({ ignoreHTTPSErrors: true });
  return { ...user, context };
}

test.describe('the secure window’s key pages', () => {
  test('enters a key for a card’s operation, then closes, and the app page can’t reach it', async ({
    page,
  }, testInfo) => {
    let { username, password, realmName, cardURL } = await userWithWeatherCard(
      page,
      'keys-enter',
    );

    let secure = await openFromApp(
      page,
      keysURL('enter-key', {
        card: cardURL,
        operation: 'forecast',
        reason: 'Forecasts need your weather service key',
      }),
    );
    // Signed out on this origin, the window signs in first.
    await expect(secure.locator('[data-test-secure-sign-in-title]')).toHaveText(
      'Sign in to manage your keys',
    );
    await snapshot(testInfo, secure, 'enter a key 1: signed out, signing in');

    await signIn(secure, username, password);
    await expect(secure.locator('[data-test-enter-key]')).toBeVisible({
      timeout: 60_000,
    });
    // What the window shows of the card and its operation comes from the
    // realm server.
    await expect(secure.locator('[data-test-opened-for-operation]')).toHaveText(
      'Get the forecast',
    );
    await expect(secure.locator('[data-test-opened-for-card]')).toHaveText(
      'Weather Report',
    );
    await expect(secure.locator('[data-test-opened-for-realm]')).toHaveText(
      realmName,
    );
    await expect(secure.locator('[data-test-destination-domain]')).toHaveText(
      'weather.co.uk',
    );
    await expect(secure.locator('[data-test-destination-host]')).toHaveText(
      'api.weather.co.uk',
    );
    await expect(secure.locator('[data-test-destination-path]')).toHaveText(
      '/v3/forecast/',
    );
    await expect(secure.locator('[data-test-opened-for-reason]')).toContainText(
      'Forecasts need your weather service key',
    );
    await snapshot(testInfo, secure, 'enter a key 2: signed in, the key form');

    await secure.locator('[data-test-key-name]').fill('Weather service');
    await secure.locator('[data-test-key-value]').fill('sk-weather-secret');
    await expect(secure.locator('[data-test-key-value]')).toHaveAttribute(
      'type',
      'password',
    );
    await snapshot(testInfo, secure, 'enter a key 3: the key typed in, masked');

    let token = JSON.parse(
      (await secure.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))!,
    ).token;
    let closed = secure.waitForEvent('close');
    await secure.locator('[data-test-enter-key-save]').click();
    await closed;

    // The app page, where cards run, holds neither the window's session nor
    // the key.
    let appStorage = await page.evaluate(() =>
      Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? ''),
    );
    expect(appStorage.some((value) => value.includes(token))).toBe(false);
    expect(
      appStorage.some((value) => value.includes('sk-weather-secret')),
    ).toBe(false);

    // The key is the user's now: on the key page, by name, with no value.
    let keys = await openDirectly(page.context(), keysURL('keys'));
    await expect(
      keys.locator('[data-test-key-row="Weather service"]'),
    ).toBeVisible();
    expect(await keys.content()).not.toContain('sk-weather-secret');
    await snapshot(testInfo, keys, 'the key page');

    // A window the user opened themselves stays on what it did.
    await keys.locator('[data-test-key-page-add]').click();
    await keys.locator('[data-test-key-name]').fill('Maps');
    await keys.locator('[data-test-key-value]').fill('sk-maps');
    await keys.locator('[data-test-enter-key-save]').click();
    await expect(keys.locator('[data-test-key-row="Maps"]')).toBeVisible();

    let done = await openDirectly(page.context(), keysURL('enter-key'));
    await keepOpen(done);
    await done.locator('[data-test-key-name]').fill('Geocoding');
    await done.locator('[data-test-key-value]').fill('sk-geocoding');
    await done.locator('[data-test-enter-key-save]').click();
    await expect(done.locator('[data-test-keys-done-name]')).toHaveText(
      'Geocoding',
    );
    await snapshot(testInfo, done, 'enter a key 4: done');
  });

  test('a card in the app page can’t read the window it opened', async ({
    page,
  }) => {
    let { username, password } = await createSubscribedUserAndLogin(
      page,
      'keys-isolation',
      serverIndexUrl,
    );
    let opened = page.context().waitForEvent('page');
    // Even opened with a handle, as card code could open it.
    await page.evaluate((url) => {
      (window as any).__secureWindow = window.open(url, '_blank');
    }, keysURL('keys'));
    let secure = await opened;
    await signIn(secure, username, password);
    await expect(secure.locator('[data-test-key-page]')).toBeVisible({
      timeout: 60_000,
    });
    let token = JSON.parse(
      (await secure.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))!,
    ).token;
    expect(
      await page.evaluate(() => {
        let handle = (window as any).__secureWindow;
        try {
          return (
            handle === null ||
            handle.closed === true ||
            handle.document === undefined
          );
        } catch {
          return true;
        }
      }),
      'the app keeps no usable handle to the window',
    ).toBe(true);
    let appStorage = await page.evaluate(() =>
      Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? ''),
    );
    expect(appStorage.some((value) => value.includes(token))).toBe(false);
  });

  test('refuses a key write ticket that is expired, spent, or for another change', async ({
    page,
  }) => {
    let { username, password } = await createSubscribedUserAndLogin(
      page,
      'keys-tickets',
      serverIndexUrl,
    );
    let secure = await openDirectly(page.context(), keysURL('keys'));
    await signIn(secure, username, password);
    await expect(secure.locator('[data-test-key-page]')).toBeVisible({
      timeout: 60_000,
    });

    async function add(name: string, ticket: string) {
      return await asWindow(secure, '_user-keys', {
        method: 'POST',
        body: {
          data: { type: 'user-key', attributes: { name, value: `sk-${name}` } },
          meta: { ticket },
        },
      });
    }
    async function remove(keyId: string, ticket: string) {
      return await asWindow(secure, `_user-keys/${keyId}`, {
        method: 'DELETE',
        body: { meta: { ticket } },
      });
    }

    let addTicket = await ticket(secure, { action: 'add' });
    let first = await add('first', addTicket);
    expect(first.status).toBe(201);
    expect((await add('again', addTicket)).status, 'a spent ticket').toBe(403);
    let second = await add('second', await ticket(secure, { action: 'add' }));
    let firstId = first.body.data.id;
    let secondId = second.body.data.id;

    expect(
      (await remove(firstId, await ticket(secure, { action: 'add' }))).status,
      'a ticket for another action',
    ).toBe(403);
    expect(
      (
        await remove(
          firstId,
          await ticket(secure, { action: 'delete', keyId: secondId }),
        )
      ).status,
      'a ticket for another key',
    ).toBe(403);

    let expiring = await ticket(secure, { action: 'delete', keyId: firstId });
    await getSharedSQLExecutor().executeSQL(
      `UPDATE key_write_tickets SET expires_at = NOW() - interval '1 second'`,
    );
    expect((await remove(firstId, expiring)).status, 'an expired ticket').toBe(
      403,
    );

    expect(
      (
        await remove(
          firstId,
          await ticket(secure, { action: 'delete', keyId: firstId }),
        )
      ).status,
      'the ticket for this change',
    ).toBe(204);
  });

  test('shares a key into a realm; a reader who isn’t a writer is told an administrator must set it up', async ({
    page,
    browser,
  }, testInfo) => {
    let { username, password, realmURL, realmName } = await userWithWeatherCard(
      page,
      'keys-share',
    );

    let secure = await openDirectly(
      page.context(),
      keysURL('share-key', { realm: realmURL }),
    );
    await snapshot(testInfo, secure, 'share a key 1: signed out');
    await signIn(secure, username, password);
    await expect(secure.locator('[data-test-share-key]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(secure.locator('[data-test-opened-for-realm]')).toHaveText(
      realmName,
    );
    // No keys yet: the window offers to add one and share it.
    await expect(secure.locator('[data-test-key-picker-new]')).toBeVisible();
    await secure.locator('[data-test-key-name]').fill('Team weather');
    await secure.locator('[data-test-key-value]').fill('sk-team-weather');
    await secure
      .locator('[data-test-share-label]')
      .fill('Weather for everyone');
    await snapshot(testInfo, secure, 'share a key 2: a new key, shared as');
    await keepOpen(secure);
    await secure.locator('[data-test-share-key-save]').click();
    await expect(secure.locator('[data-test-keys-done-label]')).toHaveText(
      'Weather for everyone',
    );
    await snapshot(testInfo, secure, 'share a key 3: done');

    let shares = await asWindow(
      secure,
      `_key-shares?realm=${encodeURIComponent(realmURL)}`,
    );
    expect(shares.status).toBe(200);
    expect(
      shares.body.data.map((s: any) => [
        s.attributes.label,
        s.attributes.state,
      ]),
    ).toEqual([['Weather for everyone', 'active']]);

    // A reader of the realm who doesn't write it.
    let reader = await secondUser(browser, 'keys-reader');
    await getSharedSQLExecutor().executeSQL(
      `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
       VALUES ('${realmURL}', '${reader.credentials.userId}', true, false, false)`,
    );
    let readerWindow = await openDirectly(
      reader.context,
      keysURL('share-key', { realm: realmURL }),
    );
    await signIn(readerWindow, reader.username, reader.password);
    await expect(
      readerWindow.locator('[data-test-keys-needs-admin] h1'),
    ).toHaveText('An administrator of this realm needs to set this up', {
      timeout: 60_000,
    });
    await expect(readerWindow.locator('input')).toHaveCount(0);
    await snapshot(
      testInfo,
      readerWindow,
      'share a key 4: a reader who isn’t a writer',
    );
    await reader.context.close();
  });

  test('a writer swaps a key of their own into a share suspended when its owner lost write', async ({
    page,
    browser,
  }, testInfo) => {
    let owner = await userWithWeatherCard(page, 'keys-swap-owner');
    let ownerWindow = await openDirectly(
      page.context(),
      keysURL('share-key', { realm: owner.realmURL }),
    );
    await signIn(ownerWindow, owner.username, owner.password);
    await expect(ownerWindow.locator('[data-test-share-key]')).toBeVisible({
      timeout: 60_000,
    });
    await ownerWindow.locator('[data-test-key-name]').fill('Owner weather');
    await ownerWindow.locator('[data-test-key-value]').fill('sk-owner');
    await ownerWindow.locator('[data-test-share-label]').fill('Weather');
    await keepOpen(ownerWindow);
    await ownerWindow.locator('[data-test-share-key-save]').click();
    await expect(ownerWindow.locator('[data-test-keys-done]')).toBeVisible();
    let [share] = (
      await asWindow(
        ownerWindow,
        `_key-shares?realm=${encodeURIComponent(owner.realmURL)}`,
      )
    ).body.data;

    // Another writer of the realm, then the owner loses write, which
    // suspends the share.
    let writer = await secondUser(browser, 'keys-swap-writer');
    let sql = getSharedSQLExecutor();
    await sql.executeSQL(
      `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
       VALUES ('${owner.realmURL}', '${writer.credentials.userId}', true, true, false)`,
    );
    await sql.executeSQL(
      `UPDATE realm_user_permissions SET write = false
        WHERE realm_url = '${owner.realmURL}'
          AND username = '${owner.credentials.userId}'`,
    );

    let swap = await openDirectly(
      writer.context,
      keysURL('swap-key', { realm: owner.realmURL, share: share.id }),
    );
    await signIn(swap, writer.username, writer.password);
    await expect(swap.locator('[data-test-swap-key]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(swap.locator('[data-test-swap-share-label]')).toHaveText(
      'Weather',
    );
    await expect(swap.locator('[data-test-swap-share]')).toContainText(
      'can no longer edit this workspace',
    );
    await swap.locator('[data-test-key-name]').fill('Writer weather');
    await swap.locator('[data-test-key-value]').fill('sk-writer');
    await snapshot(testInfo, swap, 'swap a key 1: a suspended share');
    await keepOpen(swap);
    await swap.locator('[data-test-swap-key-save]').click();
    await expect(swap.locator('[data-test-keys-done-label]')).toHaveText(
      'Weather',
    );
    await snapshot(testInfo, swap, 'swap a key 2: done');

    let after = await asWindow(
      swap,
      `_key-shares?realm=${encodeURIComponent(owner.realmURL)}`,
    );
    expect(
      after.body.data.map((s: any) => [
        s.attributes.label,
        s.attributes.state,
        s.attributes.owner,
      ]),
    ).toEqual([['Weather', 'active', writer.credentials.userId]]);
    await writer.context.close();
  });

  test('signing out of the app while the window is open leaves the window signed out, with no sign-in of its own', async ({
    page,
  }, testInfo) => {
    let { username, password } = await createSubscribedUserAndLogin(
      page,
      'keys-inert',
      serverIndexUrl,
    );
    let secure = await openFromApp(page, keysURL('keys'));
    await signIn(secure, username, password);
    await expect(secure.locator('[data-test-key-page]')).toBeVisible({
      timeout: 60_000,
    });

    await page.bringToFront();
    await logout(page);
    await expect(page.locator('[data-test-login-btn]')).toBeVisible();
    // The app's sign-out ends the window's session on the server. The window
    // asks again when the user comes back to it.
    await expect(async () => {
      await secure.bringToFront();
      await secure.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(secure.locator('[data-test-keys-signed-out]')).toBeVisible({
        timeout: 1000,
      });
    }).toPass({ timeout: 30_000 });
    await expect(secure.locator('[data-test-secure-sign-in-form]')).toHaveCount(
      0,
    );
    await snapshot(testInfo, secure, 'signed out of the app: the window stops');
  });
});
