import {
  click,
  fillIn,
  find,
  render,
  settled,
  waitFor,
} from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';

import { navigation } from '../../src/shell/navigation.js';
import AuthorizePage from '../../src/shell/authorize/authorize-page.gts';
import GoogleCallback from '../../src/shell/sign-in/google-callback.gts';
import {
  REALM_SERVER_URL,
  secureSession,
  setupMockServers,
  setupPageAddress,
  type Answer,
} from '../helpers/mock-servers.ts';
import {
  setupTelemetrySecretsCheck,
  stringsIn,
} from '../helpers/telemetry-secrets.ts';

const STORAGE_KEY = 'boxel-secure-session';
const GOOGLE_SIGN_IN_KEY = 'boxel-secure-google-sign-in';
const INTERACTION = 'flow-interaction-1';
const CONSENT = `_oauth-provider/consent/${INTERACTION}`;
const FINISH = `${REALM_SERVER_URL}_oauth-provider/interaction/${INTERACTION}/finish`;
const TICKET = 'single-use-consent-ticket';
const SESSION = {
  token: 'window-session-token',
  user: '@person:example.test',
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const EMAIL = 'person@example.test';
const CLAIMED_NAME = 'Example AI app';

const READ = {
  name: 'boxel:read',
  description: 'See the cards and files in your workspaces.',
  label: 'Read',
  caution: false,
};
const WRITE = {
  name: 'boxel:write',
  description:
    'Create and change cards and files, create workspaces, and archive the ones you own.',
  label: 'Change',
  caution: true,
};
const WORKSPACES = {
  id: 'https://realm-server.example.test/mcp',
  name: 'Boxel workspaces',
  description:
    'Lets the app find, read and change cards and files in your workspaces.',
  coverage:
    'This covers every workspace you can open, including shared ones and ones you create later.',
  scopes: [READ, WRITE],
};

// A client identified by its metadata document, which Boxel names by its
// domain (§10, state 2).
function cimdDetails(overrides: Record<string, unknown> = {}) {
  return {
    app: { kind: 'metadata-document', shown: 'example.com', verified: true },
    outsideApp: true,
    resources: [WORKSPACES],
    account: { email: EMAIL },
    renewalOffered: true,
    ...overrides,
  };
}

// A client that registered itself, with a loopback redirect (§10, state 3).
function dcrDetails(overrides: Record<string, unknown> = {}) {
  return cimdDetails({
    app: {
      kind: 'dynamic',
      shown: 'an app on this computer',
      verified: false,
      claimedName: CLAIMED_NAME,
    },
    ...overrides,
  });
}

module('Integration | authorize', function (hooks) {
  setupRenderingTest(hooks);
  setupPageAddress(hooks);
  let servers = setupMockServers(hooks);
  let moves: { how: 'assign' | 'replace'; url: string }[] = [];
  let original = { ...navigation };

  hooks.beforeEach(function () {
    moves = [];
    navigation.assign = (url: string) => {
      moves.push({ how: 'assign', url });
    };
    navigation.replace = (url: string) => {
      moves.push({ how: 'replace', url });
    };
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(GOOGLE_SIGN_IN_KEY);
  });

  hooks.afterEach(function () {
    Object.assign(navigation, original);
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(GOOGLE_SIGN_IN_KEY);
  });

  setupTelemetrySecretsCheck(hooks, () => [
    // What the page sent and was answered: bodies and credentials, not the
    // method and path a label is made from.
    ...stringsIn(
      servers.requests('realm-server').map((r) => [r.body, r.authorization]),
    ),
    INTERACTION,
    TICKET,
    SESSION.token,
    EMAIL,
    CLAIMED_NAME,
    'a-password',
  ]);

  function at(query: string, path = '/secure/authorize') {
    history.replaceState(null, '', `${path}${query}`);
  }

  function signedIn() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SESSION));
    servers.realmServer('GET _secure-session', () => ({}));
  }

  function shows(details: Record<string, unknown>) {
    servers.realmServer(`GET ${CONSENT}`, () => details);
  }

  async function open(query = `?interaction=${INTERACTION}`) {
    at(query);
    await render(AuthorizePage);
    await settled();
  }

  function consentRequests() {
    return servers.requests('realm-server', `GET ${CONSENT}`);
  }

  function decisions() {
    return servers.requests('realm-server', `POST ${CONSENT}`);
  }

  module('sign-in', function () {
    test('without a session, signs in on the page without naming the app', async function (assert) {
      await open();
      assert
        .dom('[data-test-secure-sign-in-title]')
        .hasText('Sign in to Boxel to connect an app');
      assert
        .dom('[data-test-authorize-sign-in-intro]')
        .hasText('You’ll see which app and what it can do on the next step.');
      assert.dom('[data-test-secure-username]').exists();
      assert.dom('[data-test-secure-sign-in-cancel]').hasText('Cancel');
      assert
        .dom('[data-test-secure-forgot-password]')
        .doesNotExist('nothing that leaves the flow is offered');
      assert.dom('[data-test-secure-register]').doesNotExist();
      assert.strictEqual(consentRequests().length, 0, 'no details are read');
    });

    test('Cancel ends the flow as denied, with no session to answer with', async function (assert) {
      await open();
      await click('[data-test-secure-sign-in-cancel]');
      assert.deepEqual(moves, [{ how: 'replace', url: `${FINISH}?cancel=1` }]);
    });

    test('signing in goes on to the consent of the same flow', async function (assert) {
      servers.realmServer('POST _secure-session', () =>
        secureSession(SESSION.user, SESSION.token),
      );
      shows(cimdDetails());
      await open();
      await fillIn('[data-test-secure-username]', 'person');
      await fillIn('[data-test-secure-password]', 'a-password');
      await click('[data-test-secure-password-submit]');
      await waitFor('[data-test-authorize-consent]');
      assert
        .dom('[data-test-authorize-heading]')
        .hasText('Connect example.com to Boxel workspaces?');
      assert.dom('[data-test-authorize-heading]').isFocused();
      assert.strictEqual(
        consentRequests()[0]?.authorization,
        `Bearer ${SESSION.token}`,
        'the details are read under the session just signed in',
      );
    });

    test('a Google sign-in started here comes back to the same flow', async function (assert) {
      servers.realmServer('GET _secure-session/google', () => ({
        data: {
          attributes: {
            authorizationEndpoint: 'https://accounts.google.test/o/oauth2/auth',
            clientId: 'google-client-id',
            redirectURI: 'https://secure.test/google-callback',
          },
        },
      }));
      await open();
      await click('[data-test-secure-google]');
      assert.strictEqual(moves[0]?.how, 'assign', 'goes to Google');
      let pending = JSON.parse(sessionStorage.getItem(GOOGLE_SIGN_IN_KEY)!);
      assert.strictEqual(pending.resume.interaction, INTERACTION);

      servers.realmServer('POST _secure-session/google', () =>
        secureSession(SESSION.user, SESSION.token),
      );
      moves.length = 0;
      at(`?state=${pending.state}&code=a-code`, '/secure/google-callback');
      await render(GoogleCallback);
      await settled();
      assert.deepEqual(moves, [
        {
          how: 'replace',
          url: `/secure/authorize?interaction=${INTERACTION}`,
        },
      ]);
      assert.strictEqual(
        JSON.parse(localStorage.getItem(STORAGE_KEY)!).token,
        SESSION.token,
        'the window keeps the session',
      );
    });
  });

  module('consent', function () {
    test('an app with a metadata document is named by its domain (state 2)', async function (assert) {
      signedIn();
      shows(cimdDetails());
      await open();
      assert
        .dom('[data-test-authorize-heading]')
        .hasText('Connect example.com to Boxel workspaces?');
      assert.dom('[data-test-authorize-heading]').isFocused();
      assert.dom('[data-test-authorize-account]').hasText(EMAIL);
      assert.dom('[data-test-authorize-sign-out]').hasText('Not you? Sign out');
      assert.dom('[data-test-authorize-app-icon]').exists();
      assert.dom('[data-test-authorize-unverified]').doesNotExist();
      assert
        .dom('[data-test-authorize-scope="boxel:read"]')
        .hasText('See the cards and files in your workspaces.')
        .hasAttribute('data-test-authorize-caution', 'false');
      assert
        .dom('[data-test-authorize-scope="boxel:write"]')
        .hasText(`Caution: ${WRITE.description}`)
        .hasAttribute('data-test-authorize-caution', 'true');
      assert.dom('[data-test-authorize-coverage]').hasText(WORKSPACES.coverage);
      assert
        .dom('[data-test-authorize-terms]')
        .hasText(
          'Once shared, example.com’s use of your data is governed by its own terms and privacy policy, not Boxel’s.',
        );
      assert
        .dom('[data-test-authorize-renew] input')
        .isChecked('keeping the connection for 30 days is the default');
      assert.dom('[data-test-authorize-expiry]').doesNotExist();
    });

    test('an app that registered itself is shown as unverified (state 3)', async function (assert) {
      signedIn();
      shows(dcrDetails());
      await open();
      assert
        .dom('[data-test-authorize-heading]')
        .hasText(`Connect “${CLAIMED_NAME}” to Boxel workspaces?`);
      assert
        .dom('[data-test-authorize-unverified]')
        .hasText(
          `Unverified This app named itself “${CLAIMED_NAME}”. Boxel can’t confirm who made it. It will return to: an app on this computer`,
        );
      assert
        .dom('[data-test-authorize-terms]')
        .includesText(`“${CLAIMED_NAME}”’s use of your data`);
    });

    test('an app that registered itself without a name is named by where it returns', async function (assert) {
      signedIn();
      shows(
        dcrDetails({
          app: {
            kind: 'dynamic',
            shown: 'an app on this computer',
            verified: false,
          },
        }),
      );
      await open();
      assert
        .dom('[data-test-authorize-heading]')
        .hasText('Connect an app on this computer to Boxel workspaces?');
      assert
        .dom('[data-test-authorize-unverified]')
        .includesText(
          'Boxel can’t confirm who made this app. It will return to: an app on this computer',
        );
    });

    test("Boxel's own app has no app icon and no line about another's terms (state 2b)", async function (assert) {
      signedIn();
      shows(
        cimdDetails({
          app: { kind: 'pre-registered', shown: 'Boxel CLI', verified: true },
          outsideApp: false,
        }),
      );
      await open();
      assert
        .dom('[data-test-authorize-heading]')
        .hasText('Connect Boxel CLI to Boxel workspaces?');
      assert.dom('[data-test-authorize-own-app]').hasText('Boxel’s own app.');
      assert.dom('[data-test-authorize-app-icon]').doesNotExist();
      assert.dom('[data-test-authorize-terms]').doesNotExist();
    });

    test('unchecking renewal says the connection ends after 60 minutes (state 4)', async function (assert) {
      signedIn();
      shows(cimdDetails());
      servers.realmServer(`POST ${CONSENT}`, () => ({
        status: 201,
        body: { ticket: TICKET },
      }));
      await open();
      await click('[data-test-authorize-renew] input');
      assert
        .dom('[data-test-authorize-expiry]')
        .hasText(
          'The connection ends 60 minutes after you allow it. You’ll need to connect again after that.',
        );
      await click('[data-test-authorize-allow]');
      assert.deepEqual(decisions()[0]?.body, {
        decision: 'allow',
        renew: false,
      });
    });

    test('an app that may not renew gets no checkbox, and is told the connection ends', async function (assert) {
      signedIn();
      shows(cimdDetails({ renewalOffered: false }));
      await open();
      assert.dom('[data-test-authorize-renew]').doesNotExist();
      assert
        .dom('[data-test-authorize-expiry]')
        .includesText('ends 60 minutes after you allow it');
    });

    test('a flow naming two resources lists each (state 4a)', async function (assert) {
      signedIn();
      shows(
        cimdDetails({
          resources: [
            WORKSPACES,
            {
              id: 'https://realm-server.example.test/billing',
              name: 'Boxel billing',
              description: "Lets the app read your account's usage.",
              coverage: 'This covers your account.',
              scopes: [
                {
                  name: 'billing:read',
                  description: "Read your account's usage.",
                  label: 'Read',
                  caution: false,
                },
              ],
            },
          ],
        }),
      );
      await open();
      assert
        .dom('[data-test-authorize-heading]')
        .hasText('Connect example.com to Boxel?');
      assert.dom('[data-test-authorize-resource]').exists({ count: 2 });
      assert
        .dom(
          '[data-test-authorize-resource="https://realm-server.example.test/billing"] h2',
        )
        .hasText('Boxel billing');
      assert
        .dom('[data-test-authorize-scope="billing:read"]')
        .hasText("Read your account's usage.");
    });

    test('shows only the details the provider answers, whatever else the response carries', async function (assert) {
      signedIn();
      shows({
        ...cimdDetails(),
        logo_uri: 'https://logo.example.test/a.png',
        client_uri: 'https://client-site.example.test/',
        app: {
          kind: 'metadata-document',
          shown: 'example.com',
          verified: true,
          logo_uri: 'https://logo.example.test/a.png',
          client_name: 'A name the client chose',
        },
      });
      await open();
      let page = find('[data-test-authorize-consent]')!;
      assert.notOk(page.textContent!.includes('logo.example.test'));
      assert.notOk(page.textContent!.includes('client-site.example.test'));
      assert.notOk(page.textContent!.includes('A name the client chose'));
      assert.dom('img', page).doesNotExist('no image is loaded');
    });

    test('focus never starts on Allow, and Enter anywhere can submit nothing', async function (assert) {
      signedIn();
      shows(cimdDetails());
      await open();
      assert.dom('[data-test-authorize-heading]').isFocused();
      let allow = find('[data-test-authorize-allow]') as HTMLButtonElement;
      assert.strictEqual(allow.type, 'button', 'Allow is not a submit button');
      assert.strictEqual(allow.form, null, 'Allow is in no form');
      assert.dom('[data-test-authorize-consent] form').doesNotExist();
    });
  });

  module('the answer', function () {
    test('Allow records the answer, then finishes the flow with its ticket (state 7)', async function (assert) {
      signedIn();
      shows(cimdDetails());
      servers.realmServer(`POST ${CONSENT}`, () => ({
        status: 201,
        body: { ticket: TICKET },
      }));
      await open();
      await click('[data-test-authorize-allow]');
      let [decision] = decisions();
      assert.deepEqual(decision?.body, { decision: 'allow', renew: true });
      assert.strictEqual(decision?.authorization, `Bearer ${SESSION.token}`);
      assert.deepEqual(moves, [
        { how: 'replace', url: `${FINISH}?ticket=${TICKET}` },
      ]);
      assert
        .dom('[data-test-authorize-outcome="allowed"]')
        .hasText('Returning you to example.com…');
    });

    test('Deny records the answer, and the app is told no (state 5)', async function (assert) {
      signedIn();
      shows(dcrDetails());
      servers.realmServer(`POST ${CONSENT}`, () => ({
        status: 201,
        body: { ticket: TICKET },
      }));
      await open();
      await click('[data-test-authorize-deny]');
      assert.deepEqual(decisions()[0]?.body, {
        decision: 'deny',
        renew: false,
      });
      assert.deepEqual(moves, [
        { how: 'replace', url: `${FINISH}?ticket=${TICKET}` },
      ]);
      assert
        .dom('[data-test-authorize-outcome="denied"]')
        .hasText(
          `“${CLAIMED_NAME}” was not connected Nothing was shared. Returning you to an app on this computer…`,
        );
    });

    test('a second click while the answer is recorded sends nothing more', async function (assert) {
      signedIn();
      shows(cimdDetails());
      let answer!: (value: Answer) => void;
      servers.realmServer(
        `POST ${CONSENT}`,
        () => new Promise<Answer>((resolve) => (answer = resolve)),
      );
      await open();
      click('[data-test-authorize-allow]');
      await waitFor('[data-test-authorize-allow][disabled]');
      assert.dom('[data-test-authorize-deny]').isDisabled();
      answer({ status: 201, body: { ticket: TICKET } });
      await settled();
      assert.strictEqual(decisions().length, 1);
    });

    test("an answer that isn't recorded can be given again", async function (assert) {
      signedIn();
      shows(cimdDetails());
      servers.realmServer(`POST ${CONSENT}`, () => ({
        status: 500,
        body: { error: 'whatever' },
      }));
      await open();
      await click('[data-test-authorize-allow]');
      assert
        .dom('[data-test-authorize-error]')
        .includesText('Boxel couldn’t record your answer.');
      assert.dom('[data-test-authorize-allow]').isNotDisabled();
      assert.deepEqual(moves, []);
    });

    test('a flow answered meanwhile ends without finishing', async function (assert) {
      signedIn();
      shows(cimdDetails());
      servers.realmServer(`POST ${CONSENT}`, () => ({
        status: 409,
        body: { error: 'decided' },
      }));
      await open();
      await click('[data-test-authorize-allow]');
      assert.dom('[data-test-authorize-ended]').exists();
      assert.deepEqual(moves, []);
    });

    test('"Not you?" signs out and asks for a sign-in in the same flow', async function (assert) {
      signedIn();
      shows(cimdDetails());
      servers.realmServer('DELETE _secure-session', () => ({
        network: 'down',
      }));
      await open();
      await click('[data-test-authorize-sign-out]');
      assert
        .dom('[data-test-secure-sign-in-title]')
        .hasText('Sign in to Boxel to connect an app');
      assert.strictEqual(
        localStorage.getItem(STORAGE_KEY),
        null,
        'the session is forgotten even when the server cannot be reached',
      );
      assert.strictEqual(
        servers.requests('realm-server', 'DELETE _secure-session').length,
        1,
      );
    });
  });

  module("a request that can't go on", function () {
    test('an error from the provider shows no consent, and asks nothing', async function (assert) {
      signedIn();
      await open(`?interaction=${INTERACTION}&error=expired`);
      assert.dom('[data-test-authorize-ended]').exists();
      assert.dom('[data-test-authorize-consent]').doesNotExist();
      assert.strictEqual(servers.requests('realm-server').length, 0);
    });

    test("an interaction ID that isn't one asks nothing", async function (assert) {
      signedIn();
      await open('?interaction=..%2F_secure-session');
      assert.dom('[data-test-authorize-ended]').exists();
      assert.strictEqual(servers.requests('realm-server').length, 0);
    });

    test('an expired or answered flow ends', async function (assert) {
      signedIn();
      servers.realmServer(`GET ${CONSENT}`, () => ({
        status: 409,
        body: { error: 'decided' },
      }));
      await open();
      assert
        .dom('[data-test-authorize-ended]')
        .includesText('This request can’t continue');
    });

    test('Boxel not answering offers to try again', async function (assert) {
      signedIn();
      servers.realmServer(`GET ${CONSENT}`, () => ({
        status: 503,
        body: { error: 'unavailable' },
      }));
      await open();
      assert.dom('[data-test-authorize-unavailable]').exists();
      shows(cimdDetails());
      await click('[data-test-authorize-retry]');
      await waitFor('[data-test-authorize-consent]');
      assert.dom('[data-test-authorize-heading]').isFocused();
    });

    test('a session the server has ended asks for a sign-in', async function (assert) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SESSION));
      let checks = 0;
      servers.realmServer('GET _secure-session', () =>
        checks++ === 0 ? {} : { status: 401, body: {} },
      );
      servers.realmServer('POST _secure-session/renewal', () => ({
        status: 401,
        body: {},
      }));
      servers.realmServer(`GET ${CONSENT}`, () => ({
        status: 401,
        body: { error: 'signed-out' },
      }));
      await open();
      assert
        .dom('[data-test-secure-sign-in-title]')
        .hasText('Sign in to Boxel to connect an app');
    });

    test('a page brought back from the browser cache asks again', async function (assert) {
      signedIn();
      shows(cimdDetails());
      await open();
      assert.dom('[data-test-authorize-consent]').exists();
      servers.realmServer(`GET ${CONSENT}`, () => ({
        status: 409,
        body: { error: 'decided' },
      }));
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      );
      await settled();
      assert.dom('[data-test-authorize-ended]').exists();
    });
  });
});
