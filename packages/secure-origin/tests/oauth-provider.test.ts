import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  authorizeRequest,
  cancelURL,
  finishURL,
  isInteractionId,
  readConsentDetails,
} from '../src/security/oauth-provider.ts';

const CONFIG = {
  realmServerURL: new URL('https://realm-server.example.test/'),
};

describe("the authorize page's address", () => {
  test('names a flow by an interaction ID of the shape the library gives', () => {
    assert.deepEqual(authorizeRequest('?interaction=Abc_123-xyz'), {
      kind: 'consent',
      interaction: 'Abc_123-xyz',
    });
  });

  test("refuses an interaction ID that isn't one", () => {
    for (let value of [
      '',
      '../_secure-session',
      'a/b',
      'a%2Fb',
      'a b',
      'a.b',
      'x'.repeat(65),
    ]) {
      assert.equal(isInteractionId(value), false, JSON.stringify(value));
      assert.deepEqual(
        authorizeRequest(`?${new URLSearchParams({ interaction: value })}`),
        { kind: 'none' },
        JSON.stringify(value),
      );
    }
    assert.deepEqual(authorizeRequest(''), { kind: 'none' });
  });

  test('an error wins over an interaction, so a refused flow never shows consent', () => {
    assert.deepEqual(authorizeRequest('?interaction=abc&error=expired'), {
      kind: 'error',
    });
    assert.deepEqual(authorizeRequest('?error=some-reference'), {
      kind: 'error',
    });
  });
});

describe('where the page sends the browser', () => {
  test('finishes a flow with its ticket, beneath the interaction route', () => {
    assert.equal(
      finishURL(CONFIG, 'abc', 'the-ticket'),
      'https://realm-server.example.test/_oauth-provider/interaction/abc/finish?ticket=the-ticket',
    );
  });

  test('cancels a flow without a session', () => {
    assert.equal(
      cancelURL(CONFIG, 'abc'),
      'https://realm-server.example.test/_oauth-provider/interaction/abc/finish?cancel=1',
    );
  });

  test("never builds an address from an interaction ID that isn't one", () => {
    assert.throws(() => finishURL(CONFIG, '../../x', 'ticket'));
    assert.throws(() => cancelURL(CONFIG, '../../x'));
  });
});

describe("a flow's consent details", () => {
  const DETAILS = {
    app: {
      kind: 'dynamic',
      shown: 'an app on this computer',
      verified: false,
      claimedName: 'Example AI app',
    },
    outsideApp: true,
    resources: [
      {
        id: 'https://realm-server.example.test/mcp',
        name: 'Boxel workspaces',
        description: 'Lets the app find, read and change cards and files.',
        coverage: 'This covers every workspace you can open.',
        scopes: [
          {
            name: 'boxel:read',
            description: 'See the cards and files in your workspaces.',
            label: 'Read',
            caution: false,
          },
        ],
      },
    ],
    account: { email: 'person@example.test' },
    renewalOffered: true,
  };

  test('keeps the fields the page shows', () => {
    assert.deepEqual(readConsentDetails(DETAILS), DETAILS);
  });

  test('drops anything else the response carries', () => {
    let details = readConsentDetails({
      ...DETAILS,
      logo_uri: 'https://evil.example.test/logo.png',
      app: {
        ...DETAILS.app,
        client_uri: 'https://evil.example.test',
        logo_uri: 'https://evil.example.test/logo.png',
      },
      resources: [
        {
          ...DETAILS.resources[0],
          extra: 'x',
          scopes: [{ ...DETAILS.resources[0]!.scopes[0], extra: 'x' }],
        },
      ],
    });
    assert.deepEqual(details, DETAILS);
  });

  test("keeps where Boxel's own app runs, and a confirmation code of its form", () => {
    let own = {
      ...DETAILS,
      app: {
        kind: 'pre-registered',
        shown: 'Boxel CLI',
        verified: true,
        place: 'this-computer',
      },
      outsideApp: false,
      confirmationCode: 'WDJB-MJHT',
    };
    assert.deepEqual(readConsentDetails(own), own);
    for (let code of ['wdjb-mjht', 'WDJB-MJHA', 'WDJBMJHT', '<b>WDJB</b>', 7]) {
      assert.ok(
        !(
          'confirmationCode' in
          readConsentDetails({ ...own, confirmationCode: code })
        ),
        `drops ${String(code)}`,
      );
    }
    assert.ok(
      !(
        'place' in
        readConsentDetails({
          ...DETAILS,
          app: { ...DETAILS.app, place: 'this-computer' },
        }).app
      ),
      "an outside app's place is dropped",
    );
  });

  test('refuses a response without what the page needs', () => {
    assert.throws(() => readConsentDetails({ ...DETAILS, resources: [] }));
    assert.throws(() =>
      readConsentDetails({ ...DETAILS, app: { ...DETAILS.app, kind: 'x' } }),
    );
    assert.throws(() => readConsentDetails(null));
  });
});
