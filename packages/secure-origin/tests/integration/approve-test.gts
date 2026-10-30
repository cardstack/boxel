import { click, render, settled, waitFor } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';

import { forgetSession, storeSession } from '../../src/security/session.js';
import { navigation } from '../../src/shell/navigation.js';
import {
  ApprovePage,
  ReviewChangesPage,
} from '../../src/shell/keys/approve-page.gts';
import KeyPage from '../../src/shell/keys/key-page.gts';
import UseKeyPage from '../../src/shell/keys/use-key-page.gts';
import {
  setupTelemetrySecretsCheck,
  stringsIn,
} from '../helpers/telemetry-secrets.ts';

// The approve and review-changes pages, the key page's grants, and setting a
// key up for a card from its own page, against a realm server that answers
// the requests they make. The batch is the realm server's: the page shows
// what it answers and names back what it showed.

const REALM_SERVER = 'https://realm-server.test/';
const REALM = 'https://realm-server.test/someone/workspace/';
const CARD = `${REALM}inbox/general`;
const MODULE = `${REALM}inbox`;
const SESSION = {
  token: 'secure-session-token',
  user: '@someone:example.test',
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const GRAPHQL = 'https://api.github.com/graphql/';
const UPLOADS = 'https://uploads.github.com/';

type Answer = { status: number; body?: unknown };
type Route = (request: {
  url: URL;
  method: string;
  body: any;
}) => Answer | Promise<Answer>;

function json(status: number, body: unknown): Answer {
  return { status, body };
}

function refusal(status: number, detail: string) {
  return json(status, { errors: [{ status, detail }] });
}

function snapshot(body: string, destination = GRAPHQL) {
  return {
    destination,
    method: 'POST',
    pathTemplate:
      '{"path":{},"query":{},"url":"https://api.github.com/graphql"}',
    headersTemplate: '{"authorization":"Bearer {{userKey}}"}',
    placement: 'header',
    placementName: 'authorization',
    transform: null,
    bodyTemplate: body,
  };
}

function operation(
  name: string,
  label: string,
  extra: Record<string, unknown> = {},
) {
  return {
    name,
    label,
    method: 'POST',
    path: '/graphql',
    instance: null,
    status: 'new',
    slots: [
      {
        slot: 'userKey',
        key: 'userKey',
        status: 'new',
        snapshot: snapshot(`{"query":"${name}"}`),
        fingerprint: `fp-${name}`,
      },
    ],
    ...extra,
  };
}

function batch(attributes: Record<string, unknown> = {}) {
  return {
    realm: { url: REALM, name: 'Team Workspace' },
    card: { name: 'PR Inbox', module: MODULE, exportName: 'Inbox' },
    instance: null,
    review: false,
    groups: [
      {
        destination: {
          href: GRAPHQL,
          host: 'api.github.com',
          path: '/graphql/',
          registrableDomain: 'github.com',
        },
        operations: [
          operation('listComments', 'List comments'),
          operation('listPRs', 'List your open pull requests'),
          operation('listReviews', 'List reviews'),
        ],
      },
      {
        destination: {
          href: UPLOADS,
          host: 'uploads.github.com',
          path: '/',
          registrableDomain: 'github.com',
        },
        operations: [
          {
            ...operation('upload', 'Upload an attachment'),
            path: '/upload',
            slots: [
              {
                slot: 'userKey',
                key: 'userKey',
                status: 'new',
                snapshot: snapshot('null', UPLOADS),
                fingerprint: 'fp-upload',
              },
            ],
          },
        ],
      },
    ],
    keys: [
      {
        id: 'key-gh',
        name: 'GitHub token',
        kind: 'static',
        state: 'active',
        covers: [GRAPHQL],
      },
      {
        id: 'key-other',
        name: 'Another token',
        kind: 'static',
        state: 'active',
        covers: [],
      },
    ],
    shares: [],
    ...attributes,
  };
}

function context() {
  return json(200, {
    data: {
      type: 'secure-window-context',
      attributes: {
        realm: { url: REALM, name: 'Team Workspace', directWriter: true },
        card: { name: 'PR Inbox', module: MODULE, exportName: 'Inbox' },
        operation: {
          name: 'listPRs',
          label: 'List your open pull requests',
          base: 'callApi',
          method: 'POST',
          slots: [{ name: 'userKey', key: 'userKey' }],
        },
      },
    },
  });
}

module('Integration | approve pages', function (hooks) {
  setupRenderingTest(hooks);

  let requests: { method: string; path: string; url: URL; body: any }[];
  let routes: Record<string, Route>;
  let navigations: { how: string; url?: string }[];
  let originalFetch = window.fetch;
  let originalNavigation = { ...navigation };
  let originalURL: string;
  let meta: HTMLMetaElement;

  function serve(more: Record<string, Route>) {
    Object.assign(routes, more);
  }

  function visitShell(address: string) {
    history.replaceState(null, '', `/secure/${address}`);
  }

  function approvals() {
    return requests
      .filter((r) => r.method === 'POST' && r.path === '_key-bindings')
      .map((r) => r.body.data.attributes);
  }

  hooks.before(function () {
    originalURL = window.location.href;
  });

  hooks.after(function () {
    history.replaceState(null, '', originalURL);
  });

  hooks.beforeEach(function () {
    requests = [];
    navigations = [];
    routes = {
      'GET _secure-session': () => ({ status: 204 }),
      'POST _secure-window/context': () => context(),
      'POST _key-bindings/batch': () =>
        json(200, { data: { type: 'key-binding-batch', attributes: batch() } }),
      'POST _key-bindings': () =>
        json(201, { data: [], meta: { batchId: 'b' } }),
    };
    window.fetch = async (
      input: Parameters<typeof fetch>[0],
      init: Parameters<typeof fetch>[1] = {},
    ) => {
      let url = new URL(String(input));
      let method = init.method ?? 'GET';
      let body = init.body ? JSON.parse(String(init.body)) : undefined;
      let path = url.pathname.replace(/^\//, '');
      requests.push({ method, path, url, body });
      let route = routes[`${method} ${path}`];
      let answer = route
        ? await route({ url, method, body })
        : refusal(404, 'Not found');
      return new Response(
        answer.status === 204 ? null : JSON.stringify(answer.body ?? {}),
        {
          status: answer.status,
          headers: { 'Content-Type': 'application/vnd.api+json' },
        },
      );
    };
    navigation.assign = (url: string) =>
      navigations.push({ how: 'assign', url });
    navigation.replace = (url: string) =>
      navigations.push({ how: 'replace', url });
    navigation.close = () => navigations.push({ how: 'close' });
    meta = document.createElement('meta');
    meta.name = 'boxel-realm-server-url';
    meta.content = REALM_SERVER;
    document.head.append(meta);
    storeSession(SESSION);
    sessionStorage.clear();
  });

  hooks.afterEach(function () {
    window.fetch = originalFetch;
    Object.assign(navigation, originalNavigation);
    meta.remove();
    forgetSession();
    sessionStorage.clear();
  });

  setupTelemetrySecretsCheck(hooks, () => [
    SESSION.token,
    ...stringsIn(requests.map((r) => r.body)),
  ]);

  const opened = `approve#${new URLSearchParams({
    card: CARD,
    operation: 'listPRs',
    reason: 'To list your pull requests',
  })}`;

  test('the batch is shown grouped by destination, one choice per slot, and approved in one confirmation', async function (assert) {
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');

    assert.deepEqual(
      requests.find((r) => r.path === '_key-bindings/batch')?.body.data
        .attributes,
      { target: { kind: 'instance', url: CARD }, review: false },
      'the page asks for the batch of the card it was opened for, never naming its operations',
    );
    assert
      .dom('[data-test-approve-group]')
      .exists({ count: 2 }, 'a group per destination');
    assert
      .dom(
        '[data-test-approve-group="api.github.com"] [data-test-approve-domain]',
      )
      .hasText('github.com', 'the registrable domain once per group');
    assert
      .dom(
        '[data-test-approve-group="api.github.com"] [data-test-approve-where]',
      )
      .hasText('api.github.com/graphql/', 'with the full host and path');
    assert
      .dom(
        '[data-test-approve-group="uploads.github.com"] [data-test-approve-whole-host]',
      )
      .exists('a whole-host destination says so');
    assert
      .dom('[data-test-approve-operation="listPRs"] [data-test-approve-label]')
      .hasText('List your open pull requests');
    assert
      .dom(
        '[data-test-approve-operation="listPRs"] [data-test-approve-summary]',
      )
      .hasText(
        'POST /graphql · key in the Authorization header',
        'method, path and where the key goes',
      );
    assert
      .dom('[data-test-approve-slot]')
      .exists({ count: 1 }, 'one key choice covers the whole batch');
    assert.deepEqual(
      [...document.querySelectorAll('[data-test-approve-key]')].map((e) =>
        e.getAttribute('data-test-approve-key'),
      ),
      ['GitHub token', 'Another token'],
      'the key whose grants already cover the batch comes first',
    );
    assert
      .dom('[data-test-approve-key="GitHub token"] input')
      .isChecked('and is chosen, as the only one that covers a destination');

    assert
      .dom('[data-test-approve-new-grant]')
      .exists({ count: 1 }, 'the destination the key has no grant for is new');
    assert
      .dom('[data-test-approve-new-grant-host]')
      .hasText('uploads.github.com', 'named by its full host');
    assert
      .dom(
        '[data-test-approve-group="uploads.github.com"] [data-test-approve-new-grant]',
      )
      .includesText(
        'GitHub token hasn’t been sent to uploads.github.com before',
        'said in the group it is about',
      );
    assert
      .dom('[data-test-approve-also-sends]')
      .hasText(
        'This approves the requests shown above, including sending GitHub token to uploads.github.com for the first time.',
        'the one confirmation sums up what it approves',
      );
    assert.dom('[data-test-approve-save]').hasText('Approve 4 requests');
    await click('[data-test-approve-save]');
    await settled();

    let [approval] = approvals();
    assert.strictEqual(approval.realm, REALM);
    assert.deepEqual(
      approval.operations.map(
        (o: { operation: string; expectedDestination: string; slots: any }) => [
          o.operation,
          o.expectedDestination,
          o.slots.userKey,
        ],
      ),
      [
        [
          'listComments',
          GRAPHQL,
          { keyId: 'key-gh', expectedFingerprint: 'fp-listComments' },
        ],
        [
          'listPRs',
          GRAPHQL,
          { keyId: 'key-gh', expectedFingerprint: 'fp-listPRs' },
        ],
        [
          'listReviews',
          GRAPHQL,
          { keyId: 'key-gh', expectedFingerprint: 'fp-listReviews' },
        ],
        [
          'upload',
          UPLOADS,
          { keyId: 'key-gh', expectedFingerprint: 'fp-upload' },
        ],
      ],
      'one confirmation names every operation with what it was shown',
    );
    assert.deepEqual(approval.operations[0].codeRef, {
      module: MODULE,
      name: 'Inbox',
    });
    assert.deepEqual(navigations, [{ how: 'close' }], 'the window closes');
  });

  test('an unticked operation is left out, and a group with none ticked asks for no grant', async function (assert) {
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');

    await click('[data-test-approve-tick="upload"]');
    await click('[data-test-approve-tick="listReviews"]');
    assert
      .dom('[data-test-approve-new-grant]')
      .doesNotExist('nothing is sent to uploads.github.com, so no grant');
    assert.dom('[data-test-approve-also-sends]').doesNotExist();
    assert.dom('[data-test-approve-save]').hasText('Approve 2 requests');
    await click('[data-test-approve-save]');
    await settled();
    assert.deepEqual(
      approvals()[0].operations.map((o: { operation: string }) => o.operation),
      ['listComments', 'listPRs'],
    );
  });

  test('choosing a key with no grant at a destination makes it new there', async function (assert) {
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');

    await click('[data-test-approve-key="Another token"] input');
    assert.deepEqual(
      [...document.querySelectorAll('[data-test-approve-new-grant-host]')].map(
        (e) => e.textContent?.trim(),
      ),
      ['api.github.com', 'uploads.github.com'],
      'every destination the chosen key has no grant for, by its host',
    );
    assert
      .dom('[data-test-approve-new-grant="api.github.com"]')
      .includesText('Another token');
    assert
      .dom('[data-test-approve-also-sends]')
      .includesText(
        'sending Another token to api.github.com, uploads.github.com for the first time',
      );
  });

  test('a changed operation is marked, and its review shows what changed field by field', async function (assert) {
    let changed = {
      ...operation('listPRs', 'List your open pull requests'),
      status: 'changed',
      slots: [
        {
          slot: 'userKey',
          key: 'userKey',
          status: 'changed',
          snapshot: snapshot('{"query":"nodes { title }"}'),
          fingerprint: 'fp-new',
          approved: {
            snapshot: snapshot('{"query":"totalCount"}'),
            keyId: 'key-other',
            shareId: null,
          },
        },
      ],
    };
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: {
            type: 'key-binding-batch',
            attributes: batch({
              review: true,
              groups: [{ ...batch().groups[0], operations: [changed] }],
            }),
          },
        }),
    });
    visitShell(
      `review-changes#${new URLSearchParams({ card: CARD, operation: 'listPRs' })}`,
    );
    await render(<template><ReviewChangesPage /></template>);
    await waitFor('[data-test-approve-form]');

    assert.true(
      requests.find((r) => r.path === '_key-bindings/batch')?.body.data
        .attributes.review,
      'review asks for the changed operations only',
    );
    assert.dom('[data-test-keys-heading]').hasText('Review changed requests');
    assert.dom('[data-test-approve-changed]').hasText('Changed');
    assert
      .dom('[data-test-approve-diff-field]')
      .exists({ count: 1 }, 'only the field that changed');
    assert
      .dom('[data-test-approve-diff-field="Body"]')
      .includesText('totalCount')
      .includesText('nodes { title }');
    assert
      .dom('[data-test-approve-key="Another token"] input')
      .isChecked('the key it was last approved with starts chosen');
  });

  test('a batch larger than one confirmation says how many requests come next', async function (assert) {
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: {
            type: 'key-binding-batch',
            attributes: batch({ remaining: 3 }),
          },
        }),
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    assert
      .dom('[data-test-approve-remaining]')
      .includesText('3 more requests on this card need approving');
  });

  test('a batch with nothing in it says so', async function (assert) {
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: {
            type: 'key-binding-batch',
            attributes: batch({ groups: [] }),
          },
        }),
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-keys-done]');
    assert.dom('[data-test-keys-done]').includesText('needs your approval');
  });

  test('a request that changed while shown is shown again', async function (assert) {
    let answered = 0;
    serve({
      'POST _key-bindings': () =>
        refusal(
          409,
          'operation "listPRs" sends another request than the one shown for slot userKey; show it again',
        ),
      'POST _key-bindings/batch': () => {
        answered++;
        return json(200, {
          data: { type: 'key-binding-batch', attributes: batch() },
        });
      },
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    await click('[data-test-approve-tick="listReviews"]');
    await click('[data-test-approve-key="Another token"] input');
    await click('[data-test-approve-save]');
    await waitFor('[data-test-keys-error]');
    assert
      .dom('[data-test-approve-tick="listReviews"]')
      .isNotChecked('an operation the user unticked stays unticked');
    assert
      .dom('[data-test-approve-key="Another token"] input')
      .isChecked('the key the user chose stays chosen');
    assert.strictEqual(answered, 2, 'the batch is read again');
    assert.dom('[data-test-keys-error]').includesText('show it again');
    assert.deepEqual(navigations, [], 'the window stays open');
  });

  test('adding a new key from a batch reached from the key page keeps going back to it', async function (assert) {
    visitShell(
      `approve#${new URLSearchParams({ module: MODULE, name: 'Inbox', realm: REALM, key: 'key-gh', then: 'keys' })}`,
    );
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    await click('[data-test-approve-add-key]');
    let fragment = new URLSearchParams(
      new URL(navigations[0]!.url!, window.location.href).hash.slice(1),
    );
    assert.strictEqual(fragment.get('then'), 'approve');
    assert.strictEqual(
      fragment.get('after'),
      'keys',
      'the key entry page hands the approve page back its way home',
    );
  });

  test('a key the service rejected is offered, marked, and never chosen for the user', async function (assert) {
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: {
            type: 'key-binding-batch',
            attributes: batch({
              keys: [
                {
                  id: 'key-gh',
                  name: 'GitHub token',
                  kind: 'oauth-connection',
                  state: 'rejected',
                  covers: [GRAPHQL, UPLOADS],
                },
              ],
            }),
          },
        }),
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    assert.dom('[data-test-approve-key-rejected]').exists();
    assert
      .dom('[data-test-approve-key="GitHub token"] input')
      .isNotChecked('the user chooses it themselves, if at all');
    assert.dom('[data-test-approve-save]').isDisabled();
  });

  test('adding a new key goes to the key entry page, which comes back to the batch', async function (assert) {
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    await click('[data-test-approve-add-key]');
    let [move] = navigations;
    assert.strictEqual(move?.how, 'assign');
    let url = new URL(move!.url!, window.location.href);
    assert.true(url.pathname.endsWith('/enter-key'));
    let fragment = new URLSearchParams(url.hash.slice(1));
    assert.strictEqual(fragment.get('card'), CARD);
    assert.strictEqual(fragment.get('then'), 'approve');
  });

  test("the key page lists each key's grants with the approvals that use them, and removing one lists those first", async function (assert) {
    let removed: string[] = [];
    let listed = 0;
    serve({
      'GET _user-keys': () => {
        listed++;
        return json(200, {
          data: [
            {
              type: 'user-key',
              id: 'key-gh',
              attributes: {
                name: 'GitHub token',
                kind: 'static',
                state: 'active',
                createdAt: '2026-10-01T12:00:00.000Z',
                updatedAt: '2026-10-01T12:00:00.000Z',
                grants:
                  removed.length > 0
                    ? []
                    : [
                        {
                          id: 'grant-1',
                          destination: GRAPHQL,
                          state: 'active',
                          approvedAt: '2026-10-01T12:00:00.000Z',
                        },
                      ],
                usedWith: removed.length > 0 ? [] : ['github.com'],
                sharedInto: [],
              },
            },
          ],
        });
      },
      'GET _key-bindings': () =>
        json(200, {
          data:
            removed.length > 0
              ? []
              : [
                  ['listPRs', 'List your open pull requests'],
                  ['listReviews', 'List reviews waiting on you'],
                ].map(([operation, operationLabel], i) => ({
                  type: 'key-binding',
                  id: `binding-${i}`,
                  attributes: {
                    realm: REALM,
                    type: { module: MODULE, name: 'Inbox' },
                    operation,
                    operationLabel,
                    cardName: 'Pull request inbox',
                    instance: null,
                    slot: 'userKey',
                    keyId: 'key-gh',
                    shareId: null,
                    grantId: 'grant-1',
                    state: 'active',
                  },
                })),
        }),
      'DELETE _user-key-grants/grant-1': () => {
        removed.push('grant-1');
        return json(200, {
          data: { id: 'grant-1' },
          meta: { revokedBindings: ['binding-0', 'binding-1'] },
        });
      },
    });
    visitShell('keys');
    await render(<template><KeyPage /></template>);
    await waitFor('[data-test-key-grants]');

    assert
      .dom(
        '[data-test-key-grant="api.github.com/graphql/"] [data-test-key-grant-count]',
      )
      .hasText('2 approvals');
    assert
      .dom('[data-test-key-grant-binding="listPRs"]')
      .hasText(
        'List your open pull requests on Pull request inbox in realm-server.test/someone/workspace/',
      );
    await click('[data-test-key-grant-remove]');
    assert
      .dom('[data-test-key-grant-remove-panel]')
      .includesText('revokes the approvals above');
    assert.deepEqual(removed, [], 'nothing is removed before it is confirmed');
    await click('[data-test-key-grant-remove-confirm]');
    await settled();
    assert.deepEqual(removed, ['grant-1']);
    assert.strictEqual(listed, 2, 'the keys are read again');
    assert.dom('[data-test-key-grants]').doesNotExist();
  });

  test('a key is set up for a card from its own page, then approved on the approve page', async function (assert) {
    serve({
      'GET _user-keys': () =>
        json(200, {
          data: [
            {
              type: 'user-key',
              id: 'key-gh',
              attributes: {
                name: 'GitHub token',
                kind: 'static',
                state: 'active',
                createdAt: '2026-10-01T12:00:00.000Z',
                updatedAt: '2026-10-01T12:00:00.000Z',
                grants: [],
                usedWith: [],
                sharedInto: [],
              },
            },
          ],
        }),
      'GET _secure-window/realms': () =>
        json(200, {
          data: [
            {
              type: 'secure-window-realm',
              id: REALM,
              attributes: { name: 'Team Workspace' },
            },
          ],
        }),
      'POST _secure-window/cards': () =>
        json(200, {
          data: [
            {
              type: 'secure-window-card',
              id: `${MODULE}#Inbox`,
              attributes: {
                module: MODULE,
                name: 'Inbox',
                displayName: 'PR Inbox',
              },
            },
          ],
        }),
    });
    visitShell('keys/key-gh/use');
    await render(<template><UseKeyPage @keyId='key-gh' /></template>);
    await waitFor('[data-test-use-key-card]');

    assert.strictEqual(
      requests.find((r) => r.path === '_secure-window/realms')?.url.search,
      '?access=read',
      'the workspaces the user may approve in',
    );
    assert
      .dom('[data-test-use-key-card="Inbox"] input')
      .isChecked('the one card there is chosen');
    await click('[data-test-use-key-next]');
    let url = new URL(navigations[0]!.url!, window.location.href);
    assert.true(url.pathname.endsWith('/approve'));
    let fragment = new URLSearchParams(url.hash.slice(1));
    assert.deepEqual(
      Object.fromEntries(fragment),
      {
        module: MODULE,
        name: 'Inbox',
        realm: REALM,
        key: 'key-gh',
        then: 'keys',
      },
      'the approve page is opened for the card type in that workspace, with this key',
    );
  });

  test('opened from a key, the approve page starts on that key and goes back to the key page', async function (assert) {
    visitShell(
      `approve#${new URLSearchParams({ module: MODULE, name: 'Inbox', realm: REALM, key: 'key-other', then: 'keys' })}`,
    );
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    assert.deepEqual(
      requests.find((r) => r.path === '_key-bindings/batch')?.body.data
        .attributes.target,
      { kind: 'type', module: MODULE, name: 'Inbox', realm: REALM },
    );
    assert.dom('[data-test-approve-key="Another token"] input').isChecked();
    await click('[data-test-approve-save]');
    await waitFor('[data-test-keys-done]');
    await click('[data-test-keys-done-close]');
    assert.deepEqual(
      navigations.map((n) => n.how),
      ['replace'],
      'back to the key page, not closed',
    );
  });
});
