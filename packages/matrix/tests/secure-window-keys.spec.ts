import { expect, test } from './fixtures.ts';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { appURL, secureOriginURL } from '../support/isolated-realm-server.ts';
import {
  createRealm,
  createSubscribedUser,
  createSubscribedUserAndLogin,
  getSharedSQLExecutor,
  assertLoggedOut,
  logout,
  postCardSource,
  postNewCard,
} from '../helpers/index.ts';

// The secure window's key pages, driven in a real browser against the real
// realm server: the key page, entering a key for a card's operation, sharing
// a key into a realm from the key page and from a realm, sharing a key in
// place of a suspended share, and the window having no session. The key
// pages never sign in; the window's session is the one Boxel's own sign-in on
// the secure origin leaves there. Each state is attached as a screenshot.

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
    // Transitions are run to their end, so a button just enabled isn't
    // caught partway through fading in.
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });
}

function uniqueRealmName(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function keysURL(page: string, fragment: Record<string, string> = {}) {
  let hash = new URLSearchParams(fragment).toString();
  return `${secureOriginURL}/${page}${hash ? `#${hash}` : ''}`;
}

// The secure window's size, as the command that opens it must give it (the
// `secure-origin` skill): wide enough that the share page's key names and
// fields sit on one line.
const WINDOW = { width: 640, height: 720 };

// Opens the secure window from the app page, as the command that opens it
// will: a popup, with no handle back to the page.
async function openFromApp(page: Page, url: string): Promise<Page> {
  let opened = page.context().waitForEvent('page');
  await page.evaluate(
    ({ url, width, height }) => {
      window.open(
        url,
        '_blank',
        `noopener,popup,width=${width},height=${height}`,
      );
    },
    { url, ...WINDOW },
  );
  let secure = await opened;
  await secure.setViewportSize(WINDOW);
  return secure;
}

// A page of the secure origin the user opens themselves. Script can't close
// such a window, so its last page stays to be seen.
async function openDirectly(
  context: BrowserContext,
  url: string,
): Promise<Page> {
  let secure = await context.newPage();
  await secure.setViewportSize(WINDOW);
  await secure.goto(url);
  return secure;
}

// Boxel's own sign-in on the secure origin, which leaves the window its
// session there.
async function signInToBoxel(
  context: BrowserContext,
  username: string,
  password: string,
) {
  let page = await openDirectly(context, `${secureOriginURL}/sign-in`);
  await page.locator('[data-test-secure-username]').fill(username);
  await page.locator('[data-test-secure-password]').fill(password);
  await page.locator('[data-test-secure-password-submit]').click();
  await expect(page.locator('[data-test-secure-signed-in]')).toBeVisible({
    timeout: 60_000,
  });
  await page.close();
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

// Adds a key on the key page, which comes back to the key page.
async function addKeyOnKeyPage(keys: Page, name: string, value: string) {
  await keys.locator('[data-test-key-page-add]').click();
  await keys.locator('[data-test-key-name]').fill(name);
  await keys.locator('[data-test-key-value]').fill(value);
  await keys.locator('[data-test-enter-key-save]').click();
  await expect(keys.locator(`[data-test-key-row="${name}"]`)).toBeVisible();
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
  test('without a session, the window says to sign in to Boxel and offers no sign-in of its own', async ({
    page,
  }, testInfo) => {
    let secure = await openDirectly(page.context(), keysURL('keys'));
    await expect(secure.locator('[data-test-keys-heading]')).toHaveText(
      'You’re not signed in',
    );
    await expect(secure.locator('input')).toHaveCount(0);
    await snapshot(testInfo, secure, 'no session: the window says to sign in');
  });

  test('the key page: add, replace and delete a key', async ({
    page,
  }, testInfo) => {
    let { username, password } = await createSubscribedUserAndLogin(
      page,
      'keys-page',
      serverIndexUrl,
    );
    await signInToBoxel(page.context(), username, password);
    let keys = await openDirectly(page.context(), keysURL('keys'));
    await expect(keys.locator('[data-test-key-list-empty]')).toBeVisible({
      timeout: 60_000,
    });
    await snapshot(testInfo, keys, 'your keys: none yet');

    await keys.locator('[data-test-key-page-add]').click();
    await keys.locator('[data-test-key-name]').fill('Weather service');
    await keys.locator('[data-test-key-value]').fill('sk-weather-secret');
    await expect(keys.locator('[data-test-key-value]')).toHaveAttribute(
      'type',
      'password',
    );
    await snapshot(testInfo, keys, 'add a key: the key typed in, masked');
    await keys.locator('[data-test-enter-key-save]').click();
    await addKeyOnKeyPage(keys, 'Maps', 'sk-maps');
    expect(await keys.content()).not.toContain('sk-weather-secret');
    await snapshot(testInfo, keys, 'your keys');

    await keys
      .locator('[data-test-key-row="Maps"] [data-test-key-replace]')
      .click();
    await keys.locator('[data-test-key-value]').fill('sk-maps-new');
    await snapshot(testInfo, keys, 'your keys: replacing a key');
    await keys.locator('[data-test-key-replace-save]').click();
    await expect(keys.locator('[data-test-key-replace-form]')).toHaveCount(0);

    await keys
      .locator('[data-test-key-row="Maps"] [data-test-key-delete]')
      .click();
    await expect(
      keys.locator('[data-test-key-delete-confirm-button]'),
    ).toBeEnabled();
    await snapshot(testInfo, keys, 'your keys: deleting a key');
    await keys.locator('[data-test-key-delete-confirm-button]').click();
    await expect(keys.locator('[data-test-key-row="Maps"]')).toHaveCount(0);
  });

  test('enters a key for a card’s operation, then closes, and the app page can’t reach it', async ({
    page,
  }, testInfo) => {
    let { username, password, realmName, cardURL } = await userWithWeatherCard(
      page,
      'keys-enter',
    );
    await signInToBoxel(page.context(), username, password);

    let secure = await openFromApp(
      page,
      keysURL('enter-key', {
        card: cardURL,
        operation: 'forecast',
        reason: 'Forecasts need your weather service key',
      }),
    );
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
    await secure.locator('[data-test-key-name]').fill('Weather service');
    await secure.locator('[data-test-key-value]').fill('sk-weather-secret');
    await snapshot(
      testInfo,
      secure,
      'enter a key for a card’s operation: what it is for, and the key',
    );

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

    // A window the user opened themselves stays on what it did.
    let done = await openDirectly(page.context(), keysURL('enter-key'));
    await keepOpen(done);
    await done.locator('[data-test-key-name]').fill('Geocoding');
    await done.locator('[data-test-key-value]').fill('sk-geocoding');
    await done.locator('[data-test-enter-key-save]').click();
    await expect(done.locator('[data-test-keys-done-name]')).toHaveText(
      'Geocoding',
    );
    await snapshot(testInfo, done, 'enter a key: done');
  });

  test('a card in the app page can’t read the window it opened', async ({
    page,
  }) => {
    let { username, password } = await createSubscribedUserAndLogin(
      page,
      'keys-isolation',
      serverIndexUrl,
    );
    await signInToBoxel(page.context(), username, password);
    let opened = page.context().waitForEvent('page');
    // Even opened with a handle, as card code could open it.
    await page.evaluate((url) => {
      (window as any).__secureWindow = window.open(url, '_blank');
    }, keysURL('keys'));
    let secure = await opened;
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
    await signInToBoxel(page.context(), username, password);
    let secure = await openDirectly(page.context(), keysURL('keys'));
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

  test('shares a key from the key page into a realm the user writes; a reader opened for that realm is told someone with direct write access must set it up', async ({
    page,
    browser,
  }, testInfo) => {
    let { username, password, realmURL, realmName } = await userWithWeatherCard(
      page,
      'keys-share',
    );
    await signInToBoxel(page.context(), username, password);

    let keys = await openDirectly(page.context(), keysURL('keys'));
    await expect(keys.locator('[data-test-key-page]')).toBeVisible({
      timeout: 60_000,
    });
    await addKeyOnKeyPage(keys, 'Team weather', 'sk-team-weather');
    await keys
      .locator('[data-test-key-row="Team weather"] [data-test-key-share]')
      .click();
    await expect(keys.locator('[data-test-share-key-key]')).toContainText(
      'Team weather',
    );
    expect(new URL(keys.url()).pathname).toMatch(
      /^\/secure\/keys\/[^/]+\/share$/,
    );
    // The share page is beneath the key page: back returns to it, and
    // forward to the share page again.
    await keys.goBack();
    await expect(
      keys.locator('[data-test-key-row="Team weather"]'),
    ).toBeVisible();
    await keys.goForward();
    await expect(keys.locator('[data-test-share-key-key]')).toContainText(
      'Team weather',
    );
    await expect(keys.locator('[data-test-key-value]')).toHaveCount(0);
    await keys.locator('[data-test-workspace-dropdown-trigger]').click();
    await keys
      .locator('[data-test-workspace-dropdown-search]')
      .fill(realmName.slice(0, 8));
    await snapshot(
      testInfo,
      keys,
      'share a key from your keys: choosing the workspace',
    );
    await keys.locator(`[data-test-workspace-option="${realmName}"]`).click();
    await keys.locator('[data-test-share-label]').fill('Weather for everyone');
    await snapshot(testInfo, keys, 'share a key from your keys');
    await keys.locator('[data-test-share-key-save]').click();
    await expect(keys.locator('[data-test-keys-done-label]')).toHaveText(
      'Weather for everyone',
    );
    await snapshot(testInfo, keys, 'share a key: done');

    let shares = await asWindow(
      keys,
      `_key-shares?realm=${encodeURIComponent(realmURL)}`,
    );
    expect(shares.status).toBe(200);
    expect(
      shares.body.data.map((s: any) => [
        s.attributes.label,
        s.attributes.state,
      ]),
    ).toEqual([['Weather for everyone', 'active']]);

    // Opened for the realm, the owner picks one of their keys.
    let forRealm = await openDirectly(
      page.context(),
      keysURL('share-key', { realm: realmURL }),
    );
    await expect(forRealm.locator('[data-test-opened-for-realm]')).toHaveText(
      realmName,
      { timeout: 60_000 },
    );
    // The tile is the choice; its radio button is hidden.
    await forRealm.locator('[data-test-key-choice="Team weather"]').click();
    await forRealm.locator('[data-test-share-label]').fill('Second weather');
    await snapshot(testInfo, forRealm, 'share a key, opened for a workspace');

    // A reader of the realm who doesn't write it.
    let reader = await secondUser(browser, 'keys-reader');
    await getSharedSQLExecutor().executeSQL(
      `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
       VALUES ('${realmURL}', '${reader.credentials.userId}', true, false, false)`,
    );
    await signInToBoxel(reader.context, reader.username, reader.password);
    let readerWindow = await openDirectly(
      reader.context,
      keysURL('share-key', { realm: realmURL }),
    );
    await expect(
      readerWindow.locator('[data-test-keys-needs-admin] h1'),
    ).toHaveText(
      'Someone with direct write access to this workspace needs to set this up',
      {
        timeout: 60_000,
      },
    );
    await expect(readerWindow.locator('input')).toHaveCount(0);
    await snapshot(
      testInfo,
      readerWindow,
      'share a key: a reader who isn’t a writer',
    );
    await reader.context.close();
  });

  test('a writer shares a key of their own in place of a share suspended when its owner lost write', async ({
    page,
    browser,
  }, testInfo) => {
    let owner = await userWithWeatherCard(page, 'keys-swap-owner');
    await signInToBoxel(page.context(), owner.username, owner.password);
    let ownerKeys = await openDirectly(page.context(), keysURL('keys'));
    await expect(ownerKeys.locator('[data-test-key-page]')).toBeVisible({
      timeout: 60_000,
    });
    await addKeyOnKeyPage(ownerKeys, 'Owner weather', 'sk-owner');
    let [ownerKey] = (await asWindow(ownerKeys, '_user-keys')).body.data;
    let shared = await asWindow(ownerKeys, '_key-shares', {
      method: 'POST',
      body: {
        data: {
          type: 'key-share',
          attributes: {
            realm: owner.realmURL,
            keyId: ownerKey.id,
            label: 'Weather',
          },
        },
        meta: {
          ticket: await ticket(ownerKeys, {
            action: 'share',
            keyId: ownerKey.id,
            realm: owner.realmURL,
          }),
        },
      },
    });
    expect(shared.status, JSON.stringify(shared.body)).toBe(201);
    let share = shared.body.data;

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

    await signInToBoxel(writer.context, writer.username, writer.password);
    let writerKeys = await openDirectly(writer.context, keysURL('keys'));
    await expect(writerKeys.locator('[data-test-key-page]')).toBeVisible({
      timeout: 60_000,
    });
    await addKeyOnKeyPage(writerKeys, 'Writer weather', 'sk-writer');

    let swap = await openDirectly(
      writer.context,
      keysURL('swap-key', { realm: owner.realmURL, share: share.id }),
    );
    await expect(swap.locator('[data-test-swap-key]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(swap.locator('[data-test-swap-share-label]')).toHaveText(
      'Weather',
    );
    await expect(swap.locator('[data-test-swap-share]')).toContainText(
      'no longer has direct write access to this workspace',
    );
    await expect(swap.locator('[data-test-key-value]')).toHaveCount(0);
    await snapshot(
      testInfo,
      swap,
      'share your key in place of one that stopped working',
    );
    await keepOpen(swap);
    await swap.locator('[data-test-swap-key-save]').click();
    await expect(swap.locator('[data-test-keys-done-label]')).toHaveText(
      'Weather',
    );
    await expect(swap.locator('[data-test-keys-heading]')).toHaveText(
      'Key shared',
    );
    await snapshot(
      testInfo,
      swap,
      'share your key in place of one that stopped working: done',
    );

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
    await signInToBoxel(page.context(), username, password);
    let secure = await openFromApp(page, keysURL('keys'));
    await expect(secure.locator('[data-test-key-page]')).toBeVisible({
      timeout: 60_000,
    });

    await page.bringToFront();
    await logout(page);
    await assertLoggedOut(page);
    // The app's sign-out ends the window's session on the server. The window
    // asks again when the user comes back to it.
    await expect(async () => {
      await secure.bringToFront();
      await secure.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(secure.locator('[data-test-keys-signed-out]')).toBeVisible({
        timeout: 1000,
      });
    }).toPass({ timeout: 30_000 });
    await expect(secure.locator('[data-test-keys-heading]')).toHaveText(
      'You’re signed out',
    );
    await expect(secure.locator('input')).toHaveCount(0);
    await snapshot(testInfo, secure, 'signed out while open: the window stops');
  });
});
