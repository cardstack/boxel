import {
  click,
  fillIn,
  find,
  render,
  settled,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';
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
    openToAnonymous: false,
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

// The batch as the realm server answers it, with `fillers` naming which keys
// and shares fill each slot. A batch that doesn't name them has every key
// fill each `userKey` slot and every share each `apiKey` one, for either use.
function withFillers(attributes: Record<string, any>) {
  if (attributes.fillers) {
    return attributes;
  }
  let fill: Record<string, string[]> = {};
  for (let group of attributes.groups ?? []) {
    for (let operation of group.operations) {
      for (let slot of operation.slots) {
        fill[slot.slot] = (
          slot.key === 'userKey' ? attributes.keys : attributes.shares
        ).map((k: { id: string }) => k.id);
      }
    }
  }
  return { ...attributes, fillers: { interactive: fill, pipelines: fill } };
}

// The same slots filled the same way for either use.
function filledBy(slot: string, ids: string[]) {
  return { interactive: { [slot]: ids }, pipelines: { [slot]: ids } };
}

function context() {
  return json(200, {
    data: {
      type: 'secure-window-context',
      attributes: {
        realm: {
          url: REALM,
          name: 'Team Workspace',
          directWriter: true,
          opensToAnonymous: false,
        },
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
        json(200, {
          data: { type: 'key-binding-batch', attributes: withFillers(batch()) },
        }),
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
      {
        target: { kind: 'instance', url: CARD },
        review: false,
        interactive: true,
      },
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
        'Approving lets Boxel make the calls above, and send GitHub token to uploads.github.com for the first time.',
        'the one confirmation sums up what it approves',
      );
    assert.dom('[data-test-approve-save]').hasText('Approve 4 calls');
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
    assert.dom('[data-test-approve-save]').hasText('Approve 2 calls');
    await click('[data-test-approve-save]');
    await settled();
    assert.deepEqual(
      approvals()[0].operations.map((o: { operation: string }) => o.operation),
      ['listComments', 'listPRs'],
    );
  });

  test('opened by the CLI, only the operations it named start ticked, and the CLI is told once they are approved', async function (assert) {
    let submitted: { action: string; fields: [string, string][] }[] = [];
    let submit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
      submitted.push({
        action: this.action,
        fields: [...new FormData(this).entries()] as [string, string][],
      });
    };
    try {
      visitShell(
        `approve#${new URLSearchParams({
          module: MODULE,
          name: 'Inbox',
          realm: REALM,
          operation: 'upload',
          key: 'key-other',
          operations: 'upload,listPRs',
          cli_port: '51234',
          cli_state: 'c'.repeat(32),
        })}`,
      );
      await render(<template><ApprovePage /></template>);
      await waitFor('[data-test-approve-form]');
      assert
        .dom('[data-test-approve-key="Another token"] input')
        .isChecked('the key the CLI named starts chosen');
      assert
        .dom('[data-test-radio-choice="pipelines"] input')
        .isChecked('without --interactive the CLI approves for pipelines only');
      assert.dom('[data-test-approve-save]').hasText('Approve 2 calls');
      assert.deepEqual(submitted, [], 'nothing leaves before the user says');

      await click('[data-test-approve-save]');
      await settled();
      assert.deepEqual(
        approvals()[0].operations.map(
          (o: { operation: string }) => o.operation,
        ),
        ['listPRs', 'upload'],
        'the window approves with its own session what it showed',
      );
      assert.deepEqual(submitted, [
        {
          action: 'http://127.0.0.1:51234/callback',
          fields: [
            ['state', 'c'.repeat(32)],
            ['window_outcome', 'done'],
          ],
        },
      ]);
      assert.deepEqual(
        navigations,
        [],
        'the window goes to the CLI instead of closing',
      );

      await click('[data-test-keys-close]');
      assert.strictEqual(
        submitted.length,
        1,
        'closing once the approval is made tells the CLI nothing more',
      );
    } finally {
      HTMLFormElement.prototype.submit = submit;
    }
  });

  test('opened by the CLI with --interactive, the choice starts on interactive use', async function (assert) {
    visitShell(
      `approve#${new URLSearchParams({
        card: CARD,
        operation: 'listPRs',
        interactive: '1',
        cli_port: '51234',
        cli_state: 'c'.repeat(32),
      })}`,
    );
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    assert.dom('[data-test-radio-choice="interactive"] input').isChecked();
  });

  module('opened by the CLI, ended before approving', function (hooks) {
    let submitted: { action: string; fields: [string, string][] }[];
    let submit = HTMLFormElement.prototype.submit;
    const CLI_STATE = 'c'.repeat(32);
    const CANCELLED = [
      {
        action: 'http://127.0.0.1:51234/callback',
        fields: [
          ['state', CLI_STATE],
          ['window_outcome', 'cancelled'],
        ] as [string, string][],
      },
    ];

    hooks.beforeEach(function () {
      submitted = [];
      HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
        submitted.push({
          action: this.action,
          fields: [...new FormData(this).entries()] as [string, string][],
        });
      };
      visitShell(
        `approve#${new URLSearchParams({
          module: MODULE,
          name: 'Inbox',
          realm: REALM,
          operation: 'upload',
          key: 'key-other',
          operations: 'upload',
          cli_port: '51234',
          cli_state: CLI_STATE,
        })}`,
      );
    });

    hooks.afterEach(function () {
      HTMLFormElement.prototype.submit = submit;
    });

    test('Cancel tells the CLI the approval was cancelled, and approves nothing', async function (assert) {
      await render(<template><ApprovePage /></template>);
      await waitFor('[data-test-approve-form]');
      await click('[data-test-keys-cancel]');
      assert.deepEqual(submitted, CANCELLED);
      assert.deepEqual(approvals(), [], 'nothing is approved');
      assert.deepEqual(
        navigations,
        [],
        'the window goes to the CLI instead of closing',
      );

      await click('[data-test-keys-close]');
      assert.strictEqual(submitted.length, 1, 'the CLI is told once');
    });

    test('closing while the approval is being saved waits, and tells the CLI only that it was made', async function (assert) {
      let release!: () => void;
      let held = new Promise<void>((resolve) => (release = resolve));
      serve({
        'POST _key-bindings': async () => {
          await held;
          return json(201, { data: [], meta: { batchId: 'b' } });
        },
      });
      await render(<template><ApprovePage /></template>);
      await waitFor('[data-test-approve-form]');
      click('[data-test-approve-save]');
      await waitUntil(() => approvals().length === 1);
      await click('[data-test-keys-close]');
      assert.deepEqual(submitted, [], 'nothing is told while the save runs');
      release();
      await settled();
      assert.deepEqual(submitted, [
        {
          ...CANCELLED[0]!,
          fields: [
            ['state', CLI_STATE],
            ['window_outcome', 'done'],
          ],
        },
      ]);
      assert.deepEqual(navigations, [], 'the window goes to the CLI');
    });

    test('closing while an approval that then fails is being saved tells the CLI it was cancelled', async function (assert) {
      let release!: () => void;
      let held = new Promise<void>((resolve) => (release = resolve));
      serve({
        'POST _key-bindings': async () => {
          await held;
          return refusal(500, 'Something broke');
        },
      });
      await render(<template><ApprovePage /></template>);
      await waitFor('[data-test-approve-form]');
      click('[data-test-approve-save]');
      await waitUntil(() => approvals().length === 1);
      await click('[data-test-keys-close]');
      assert.deepEqual(submitted, [], 'nothing is told while the save runs');
      release();
      await settled();
      assert.deepEqual(submitted, CANCELLED);
    });

    test('with nothing to approve, the CLI is told at once', async function (assert) {
      serve({
        'POST _key-bindings/batch': () =>
          json(200, {
            data: {
              type: 'key-binding-batch',
              attributes: withFillers(batch({ groups: [] })),
            },
          }),
      });
      await render(<template><ApprovePage /></template>);
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(submitted, [
        {
          ...CANCELLED[0]!,
          fields: [
            ['state', CLI_STATE],
            ['window_outcome', 'done'],
          ],
        },
      ]);
    });

    test('the review-changes page tells the CLI too', async function (assert) {
      visitShell(`review-changes${window.location.hash}`);
      await render(<template><ReviewChangesPage /></template>);
      await waitFor('[data-test-approve-form]');
      await click('[data-test-keys-close]');
      assert.deepEqual(submitted, CANCELLED);
    });

    test('closing the window tells the CLI the approval was cancelled', async function (assert) {
      await render(<template><ApprovePage /></template>);
      await waitFor('[data-test-approve-form]');
      await click('[data-test-keys-close]');
      assert.deepEqual(submitted, CANCELLED);
      assert.deepEqual(approvals(), [], 'nothing is approved');
    });

    test('closing a window that has no session tells the CLI the approval was cancelled', async function (assert) {
      forgetSession();
      await render(<template><ApprovePage /></template>);
      await waitFor('[data-test-keys-signed-out]');
      await click('[data-test-keys-signed-out-close]');
      assert.deepEqual(submitted, CANCELLED);
    });

    test('closing a window that couldn’t load the batch tells the CLI the approval was cancelled', async function (assert) {
      serve({
        'POST _key-bindings/batch': () => refusal(500, 'Something broke'),
      });
      await render(<template><ApprovePage /></template>);
      await waitFor('[data-test-keys-load-failed]');
      await click('[data-test-keys-close]');
      assert.deepEqual(submitted, CANCELLED);
    });
  });

  test('opened without the CLI, the page offers no Cancel, and Close closes the window', async function (assert) {
    let submit = HTMLFormElement.prototype.submit;
    let submitted = 0;
    HTMLFormElement.prototype.submit = () => submitted++;
    try {
      visitShell(opened);
      await render(<template><ApprovePage /></template>);
      await waitFor('[data-test-approve-form]');
      assert.dom('[data-test-keys-cancel]').doesNotExist();
      await click('[data-test-keys-close]');
      assert.deepEqual(navigations, [{ how: 'close' }]);
      assert.strictEqual(submitted, 0, 'nothing is handed anywhere');
    } finally {
      HTMLFormElement.prototype.submit = submit;
    }
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
        'send Another token to api.github.com, uploads.github.com for the first time',
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
            attributes: withFillers(
              batch({
                review: true,
                groups: [{ ...batch().groups[0], operations: [changed] }],
              }),
            ),
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
    assert.dom('[data-test-keys-heading]').hasText('Review changes');
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
            attributes: withFillers(batch({ remaining: 3 })),
          },
        }),
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    assert
      .dom('[data-test-approve-remaining]')
      .includesText('This card has 3 more calls to approve');
  });

  test('a batch with nothing in it says so', async function (assert) {
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: {
            type: 'key-binding-batch',
            attributes: withFillers(batch({ groups: [] })),
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
          data: { type: 'key-binding-batch', attributes: withFillers(batch()) },
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

  test('a slot offers only the keys the realm server names as filling it', async function (assert) {
    let declared = batch();
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: {
            type: 'key-binding-batch',
            attributes: withFillers({
              ...declared,
              keys: [
                ...declared.keys,
                {
                  id: 'key-conn',
                  name: 'GitHub account',
                  kind: 'oauth-connection',
                  state: 'active',
                  covers: [],
                },
              ],
              fillers: filledBy('userKey', ['key-conn']),
            }),
          },
        }),
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    assert
      .dom('[data-test-approve-key]')
      .exists({ count: 1 }, 'a key that fills no slot is not offered');
    assert
      .dom('[data-test-approve-key="GitHub account"] input')
      .isChecked('the only key that fits starts chosen');
    assert.dom('[data-test-approve-key="GitHub token"]').doesNotExist();
  });

  test('a key chosen for pipelines that interactive use no longer offers gives way to one it does', async function (assert) {
    let mixed = batch({
      keys: [
        {
          id: 'key-gh',
          name: 'GitHub token',
          kind: 'static',
          state: 'active',
          covers: [GRAPHQL],
        },
        {
          id: 'key-api-only',
          name: 'GitHub API account',
          kind: 'oauth-connection',
          state: 'active',
          covers: [],
        },
      ],
      // The account reaches only the GraphQL API, so it fills the slot only
      // without the upload, which pipelines don't approve again.
      fillers: {
        interactive: { userKey: ['key-gh'] },
        pipelines: { userKey: ['key-gh', 'key-api-only'] },
      },
    });
    let [, uploads] = mixed.groups as { operations: any[] }[];
    uploads!.operations = uploads!.operations.map((o) => ({
      ...o,
      status: 'pipelines-only',
      slots: o.slots.map((slot: object) => ({
        ...slot,
        status: 'pipelines-only',
        approved: {
          snapshot: snapshot('null', UPLOADS),
          keyId: 'key-gh',
          shareId: null,
          interactive: false,
        },
      })),
    }));
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: { type: 'key-binding-batch', attributes: withFillers(mixed) },
        }),
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    assert.dom('[data-test-approve-key="GitHub API account"]').doesNotExist();

    await click('[data-test-radio-choice="pipelines"] input');
    await click('[data-test-approve-key="GitHub API account"] input');
    assert
      .dom('[data-test-approve-key="GitHub API account"] input')
      .isChecked();

    await click('[data-test-radio-choice="interactive"] input');
    assert
      .dom('[data-test-approve-key="GitHub API account"]')
      .doesNotExist('the upload it can’t reach is back in the batch');
    assert
      .dom('[data-test-approve-key="GitHub token"] input')
      .isChecked('the key the slot starts on is chosen in its place');
  });

  test('a share slot offers only the shares the realm server names as filling it', async function (assert) {
    let shared = batch({
      groups: [
        {
          destination: {
            href: GRAPHQL,
            host: 'api.github.com',
            path: '/graphql/',
            registrableDomain: 'github.com',
          },
          operations: [
            {
              ...operation('listPRs', 'List your open pull requests'),
              slots: [
                {
                  slot: 'apiKey',
                  key: 'apiKey',
                  kinds: ['static', 'oauth'],
                  status: 'new',
                  snapshot: snapshot('{"query":"listPRs"}'),
                  fingerprint: 'fp-listPRs',
                },
              ],
            },
          ],
        },
      ],
      keys: [],
      shares: [
        {
          id: 'share-bot',
          label: 'GitHub bot',
          keyId: 'key-bot',
          keyName: 'GitHub bot client',
          keyKind: 'oauth-client',
          covers: [],
          interactive: false,
          dailyBudget: 100,
          anonymous: false,
          anonymousDailyCap: null,
          anonymousMonthlyCap: null,
        },
        {
          id: 'share-slack',
          label: 'Slack bot',
          keyId: 'key-slack',
          keyName: 'Slack bot client',
          keyKind: 'oauth-client',
          covers: [],
          interactive: false,
          dailyBudget: 100,
          anonymous: false,
          anonymousDailyCap: null,
          anonymousMonthlyCap: null,
        },
      ],
      fillers: filledBy('apiKey', ['share-bot']),
    });
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: { type: 'key-binding-batch', attributes: withFillers(shared) },
        }),
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    assert.dom('[data-test-approve-key]').exists({ count: 1 });
    assert
      .dom('[data-test-approve-key="GitHub bot"] input')
      .isChecked('the only share that fits starts chosen');
    assert.dom('[data-test-approve-key="Slack bot"]').doesNotExist();
  });

  test('with shares in the workspace but none that fit, the page says none can be used here', async function (assert) {
    let unfit = batch({
      groups: [
        {
          destination: {
            href: GRAPHQL,
            host: 'api.github.com',
            path: '/graphql/',
            registrableDomain: 'github.com',
          },
          operations: [
            {
              ...operation('listPRs', 'List your open pull requests'),
              slots: [
                {
                  slot: 'apiKey',
                  key: 'apiKey',
                  kinds: ['static', 'oauth'],
                  status: 'new',
                  snapshot: snapshot('{"query":"listPRs"}'),
                  fingerprint: 'fp-listPRs',
                },
              ],
            },
          ],
        },
      ],
      keys: [],
      shares: [
        {
          id: 'share-slack',
          label: 'Slack bot',
          keyId: 'key-slack',
          keyName: 'Slack bot client',
          keyKind: 'oauth-client',
          covers: [],
          interactive: false,
          dailyBudget: 100,
          anonymous: false,
          anonymousDailyCap: null,
          anonymousMonthlyCap: null,
        },
      ],
      fillers: filledBy('apiKey', []),
    });
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: { type: 'key-binding-batch', attributes: withFillers(unfit) },
        }),
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    assert
      .dom('[data-test-approve-no-keys]')
      .hasText(
        'None of your keys shared with this workspace can be used here.',
      );
  });

  test('a key the service rejected is offered, marked, and never chosen for the user', async function (assert) {
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: {
            type: 'key-binding-batch',
            attributes: withFillers(
              batch({
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
            ),
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

  test("the key page lists each key's grants with the approvals that use them, collapsed to a count, and removing one lists those first", async function (assert) {
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
                        {
                          id: 'grant-2',
                          destination: UPLOADS,
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

    let graphql = '[data-test-key-grant="api.github.com/graphql/"]';
    let count = `${graphql} [data-test-key-grant-count]`;
    let list = `${graphql} [data-test-key-grant-bindings]`;
    assert.dom(count).hasText('2 approvals');
    assert
      .dom(count)
      .hasAttribute('aria-expanded', 'false', 'the approvals start collapsed');
    let describedBy = document
      .querySelector(count)
      ?.getAttribute('aria-describedby');
    assert
      .dom(`#${describedBy}`)
      .hasText('api.github.com/graphql/', 'the count names its grant');
    assert.dom(list).isNotVisible();

    let uploadsCount =
      '[data-test-key-grant="uploads.github.com/"] [data-test-key-grant-count]';
    assert.dom(uploadsCount).hasText('0 approvals');
    assert
      .dom(uploadsCount)
      .doesNotHaveAttribute('aria-expanded', 'a grant with none has no toggle');

    await click(count);
    assert.dom(count).hasAttribute('aria-expanded', 'true');
    assert.dom(list).isVisible();
    assert
      .dom('[data-test-key-grant-binding="listPRs"]')
      .hasText(
        'List your open pull requests on Pull request inbox in realm-server.test/someone/workspace/',
      );

    await click(count);
    assert.dom(list).isNotVisible();

    await click(`${graphql} [data-test-key-grant-remove]`);
    assert
      .dom('[data-test-key-grant-remove-panel]')
      .includesText('revokes the approvals above');
    assert.dom(list).isVisible('the approvals the removal revokes are listed');
    assert
      .dom(count)
      .isDisabled('the list stays open while the removal is confirmed');

    await click('[data-test-key-grant-remove-cancel]');
    assert
      .dom(list)
      .isNotVisible('cancelling leaves the list as the user left it');
    assert.dom(count).isNotDisabled();

    await click(`${graphql} [data-test-key-grant-remove]`);
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
    assert.deepEqual(
      requests.find((r) => r.path === '_secure-window/cards')?.body.data
        .attributes,
      { realm: REALM, key: 'key-gh' },
      'the cards there that this key can fill',
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
        back: 'keys/key-gh/use',
      },
      'the approve page is opened for the card type in that workspace, with this key, and its trail leads back here',
    );
  });

  test('a workspace with no card this key works for says so about this key', async function (assert) {
    serve({
      'GET _user-keys': () =>
        json(200, {
          data: [
            {
              type: 'user-key',
              id: 'key-sa',
              attributes: {
                name: 'Service account',
                kind: 'google-service-account',
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
      'POST _secure-window/cards': () => json(200, { data: [] }),
    });
    visitShell('keys/key-sa/use');
    await render(<template><UseKeyPage @keyId='key-sa' /></template>);
    await waitFor('[data-test-use-key-no-cards]');
    assert
      .dom('[data-test-use-key-no-cards]')
      .hasText(
        'No card in this workspace makes a request this key works for.',
        'the empty list is about this key, not every key of the user’s',
      );
    assert.dom('[data-test-use-key-next]').isDisabled();
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
  // An operation approved, unchanged, for pipelines only: in the batch only
  // for interactive use.
  function pipelinesOnly(name: string, label: string) {
    let base = operation(name, label);
    return {
      ...base,
      status: 'pipelines-only',
      slots: base.slots.map((s) => ({
        ...s,
        status: 'pipelines-only',
        approved: {
          snapshot: s.snapshot,
          keyId: 'key-gh',
          shareId: null,
          interactive: false,
        },
      })),
    };
  }

  test('requests start on interactive use, offered first, which shows what it allows, once, and approves it', async function (assert) {
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: {
            type: 'key-binding-batch',
            attributes: withFillers(
              batch({
                groups: [
                  {
                    destination: {
                      href: GRAPHQL,
                      host: 'api.github.com',
                      path: '/graphql/',
                      registrableDomain: 'github.com',
                    },
                    operations: [
                      operation('listPRs', 'List your open pull requests'),
                      pipelinesOnly('listReviews', 'List reviews'),
                    ],
                  },
                ],
              }),
            ),
          },
        }),
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    assert.true(
      requests.find((r) => r.path === '_key-bindings/batch')?.body.data
        .attributes.interactive,
      'the batch also answers what is approved for pipelines only',
    );
    assert.deepEqual(
      [...document.querySelectorAll('[data-test-radio-choice]')].map((choice) =>
        choice.getAttribute('data-test-radio-choice'),
      ),
      ['interactive', 'pipelines'],
      'interactive use is the first choice',
    );
    assert
      .dom('[data-test-radio-choice="interactive"] input')
      .isChecked('interactive use is where the choice starts');
    assert.dom('[data-test-approve-operation="listReviews"]').exists();

    await click('[data-test-radio-choice="pipelines"] input');
    assert
      .dom('[data-test-approve-operation="listReviews"]')
      .doesNotExist('one approved for pipelines already needs nothing more');
    assert.dom('[data-test-approve-interactive]').doesNotExist();

    await click('[data-test-radio-choice="interactive"] input');
    assert.dom('[data-test-approve-operation="listReviews"]').exists();
    assert
      .dom('[data-test-approve-confirmation]')
      .exists({ count: 1 })
      .hasText(
        'Any card you open can make these calls as you and read what comes back.',
      );
    assert.dom('[data-test-approve-budget]').doesNotExist();
    assert.dom('[data-test-approve-save]').hasText('Approve 2 calls');

    await click('[data-test-approve-save]');
    await settled();
    let [approval] = approvals();
    assert.true(approval.interactive);
    assert.strictEqual(approval.dailyBudgets, undefined);
    assert.deepEqual(
      approval.operations.map((o: { operation: string }) => o.operation),
      ['listPRs', 'listReviews'],
    );
  });

  test('approving for pipelines only sends no interactive approval', async function (assert) {
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    await click('[data-test-radio-choice="pipelines"] input');
    await click('[data-test-approve-save]');
    await settled();
    let [approval] = approvals();
    assert.strictEqual(approval.interactive, undefined);
    assert.strictEqual(approval.operations.length, 4);
  });

  // A batch of one group holding `operations`.
  function batchOf(operations: unknown[]) {
    return {
      groups: [
        {
          destination: {
            href: GRAPHQL,
            host: 'api.github.com',
            path: '/graphql/',
            registrableDomain: 'github.com',
          },
          operations,
        },
      ],
    };
  }

  // An operation whose request changed since it was last approved, and that
  // approval allowed interactive use.
  function changedInteractive(name: string, label: string) {
    let base = operation(name, label);
    return {
      ...base,
      status: 'changed',
      slots: base.slots.map((s) => ({
        ...s,
        status: 'changed',
        approved: {
          snapshot: s.snapshot,
          keyId: 'key-gh',
          shareId: null,
          interactive: true,
        },
      })),
    };
  }
  // An operation whose request changed since it was last approved, and that
  // approval allowed pipelines only.
  function changedPipelinesOnly(name: string, label: string) {
    let base = changedInteractive(name, label);
    return {
      ...base,
      slots: base.slots.map((s) => ({
        ...s,
        approved: { ...s.approved, interactive: false },
      })),
    };
  }

  async function openWith(operations: unknown[]) {
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: {
            type: 'key-binding-batch',
            attributes: withFillers(batch(batchOf(operations))),
          },
        }),
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
  }

  test('a batch holding only requests approved for pipelines starts on interactive use, each marked', async function (assert) {
    await openWith([pipelinesOnly('listPRs', 'List PRs')]);
    assert.dom('[data-test-radio-choice="interactive"] input').isChecked();
    assert
      .dom(
        '[data-test-approve-operation="listPRs"] [data-test-approve-pipelines-only]',
      )
      .hasText('Approved for the schedule');
  });

  test('a batch whose every request was last approved for interactive use starts on it, so approving again keeps it', async function (assert) {
    await openWith([changedInteractive('listPRs', 'List PRs')]);
    assert.dom('[data-test-radio-choice="interactive"] input').isChecked();
  });

  test('a batch whose every request was last approved for pipelines only starts on it, so approving again keeps it', async function (assert) {
    await openWith([
      changedPipelinesOnly('listPRs', 'List PRs'),
      changedPipelinesOnly('listReviews', 'List reviews'),
    ]);
    assert.dom('[data-test-radio-choice="pipelines"] input').isChecked();
  });

  test('new requests among ones last approved for pipelines only start on interactive use', async function (assert) {
    await openWith([
      changedPipelinesOnly('listPRs', 'List PRs'),
      operation('listReviews', 'List reviews'),
    ]);
    assert.dom('[data-test-radio-choice="interactive"] input').isChecked();
  });

  test('one request approved for interactive use among new ones starts on interactive use', async function (assert) {
    await openWith([
      changedInteractive('listPRs', 'List PRs'),
      operation('listReviews', 'List reviews'),
      pipelinesOnly('listComments', 'List comments'),
    ]);
    assert.dom('[data-test-radio-choice="interactive"] input').isChecked();
    await click('[data-test-radio-choice="pipelines"] input');
    assert
      .dom('[data-test-approve-operation="listComments"]')
      .doesNotExist('one approved for pipelines needs nothing for pipelines');
  });

  test('approving a request last approved for interactive use for pipelines only says it stops running when the card is opened', async function (assert) {
    await openWith([
      changedInteractive('listPRs', 'List PRs'),
      operation('listReviews', 'List reviews'),
    ]);
    assert
      .dom(
        '[data-test-approve-operation="listPRs"] [data-test-approve-open-cards]',
      )
      .hasText('Approved for open cards');
    assert
      .dom(
        '[data-test-approve-operation="listReviews"] [data-test-approve-open-cards]',
      )
      .doesNotExist();
    await click('[data-test-radio-choice="pipelines"] input');
    assert
      .dom('[data-test-approve-demoted]')
      .includesText('stops the calls marked “Approved for open cards”');

    await click('[data-test-approve-tick="listPRs"]');
    assert
      .dom('[data-test-approve-demoted]')
      .doesNotExist('an unticked call is not approved, so keeps its use');
    await click('[data-test-approve-tick="listPRs"]');
    assert.dom('[data-test-approve-demoted]').exists();
    await click('[data-test-radio-choice="interactive"] input');
    assert
      .dom('[data-test-approve-demoted]')
      .doesNotExist('interactive use keeps it');

    await click('[data-test-radio-choice="pipelines"] input');
    await click('[data-test-approve-save]');
    await settled();
    let [approval] = approvals();
    assert.strictEqual(approval.interactive, undefined);
    assert.strictEqual(approval.operations.length, 2);
  });

  test('the intro says which cards the approval covers', async function (assert) {
    await openWith([operation('listPRs', 'List PRs')]);
    assert
      .dom('[data-test-approve]')
      .includesText('the approval covers every card of this kind');

    await openWith([
      operation('listPRs', 'List PRs', { instance: CARD }),
      operation('listReviews', 'List reviews'),
    ]);
    assert
      .dom('[data-test-approve]')
      .includesText(
        'Some cover only this card, and the rest cover every card of this kind',
      );

    await openWith([operation('listPRs', 'List PRs', { instance: CARD })]);
    assert
      .dom('[data-test-approve]')
      .includesText('You approve these calls once, for this card.');
  });

  // Serves a batch of one operation a share fills, approved for open cards
  // for the first time, with the share's daily budget in force at 2400.
  function serveFirstInteractiveShare() {
    let shared = operation('listTeamPRs', 'List the team’s pull requests');
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: {
            type: 'key-binding-batch',
            attributes: withFillers(
              batch({
                groups: [
                  {
                    destination: {
                      href: GRAPHQL,
                      host: 'api.github.com',
                      path: '/graphql/',
                      registrableDomain: 'github.com',
                    },
                    operations: [
                      {
                        ...shared,
                        slots: shared.slots.map((s) => ({
                          ...s,
                          slot: 'apiKey',
                          key: 'apiKey',
                        })),
                      },
                    ],
                  },
                ],
                keys: [],
                shares: [
                  {
                    id: 'share-team',
                    label: 'Team GitHub',
                    keyId: 'key-gh',
                    keyName: 'GitHub token',
                    covers: [GRAPHQL],
                    interactive: false,
                    dailyBudget: 2400,
                    anonymous: false,
                    anonymousDailyCap: null,
                    anonymousMonthlyCap: null,
                  },
                ],
              }),
            ),
          },
        }),
    });
  }

  test("a share's first interactive approval asks for its daily budget, starting from the one in force", async function (assert) {
    serveFirstInteractiveShare();
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    await click('[data-test-radio-choice="interactive"] input');
    assert
      .dom('[data-test-approve-confirmation]')
      .exists({ count: 1 })
      .includesText('Any card a reader of this realm opens, from any realm');
    assert
      .dom('[data-test-approve-budget="Team GitHub"] input')
      .hasValue('2400');
    let input = find('[data-test-approve-budget="Team GitHub"] input')!;
    let name = input
      .getAttribute('aria-labelledby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .join(' ');
    assert.strictEqual(
      name,
      'Daily budget for Team GitHub',
      'the field is named by its label alone',
    );
    assert
      .dom(document.getElementById(input.getAttribute('aria-describedby')!))
      .includesText('in total across everyone', 'its note describes it');

    assert
      .dom('[data-test-approve-budget-more]')
      .includesText('how fast each person can make calls')
      .includesText(
        'how many calls this share makes in a month, in total across everyone',
      );
    assert
      .dom(
        '[data-test-approve-budget="Team GitHub"] [data-test-approve-budget-limits-link]',
      )
      .hasText(
        'Open the limits for Team GitHub in a new tab',
        'the link names the share it opens, and that it opens a tab',
      );
    let link = find(
      '[data-test-approve-budget="Team GitHub"] [data-test-approve-budget-limits-link]',
    ) as HTMLAnchorElement;
    assert.strictEqual(
      link.target,
      '_blank',
      'it opens in a tab of its own, leaving the batch as it is',
    );
    assert.strictEqual(link.rel, 'noopener noreferrer');
    let limitsURL = new URL(link.href);
    assert.strictEqual(limitsURL.origin, window.location.origin);
    assert.strictEqual(limitsURL.pathname, '/secure/share-limits');
    let limitsFragment = new URLSearchParams(limitsURL.hash.slice(1));
    assert.strictEqual(limitsFragment.get('realm'), REALM);
    assert.strictEqual(limitsFragment.get('share'), 'share-team');

    await fillIn('[data-test-approve-budget="Team GitHub"] input', 'lots');
    assert
      .dom('[data-test-approve-save]')
      .isDisabled('a budget that is not a whole number is not sent');
    await fillIn('[data-test-approve-budget="Team GitHub"] input', '500');
    await click('[data-test-approve-save]');
    await settled();
    let [approval] = approvals();
    assert.true(approval.interactive);
    assert.deepEqual(approval.dailyBudgets, { 'share-team': 500 });
  });

  test('coming back to the window takes a daily budget changed on the limits page', async function (assert) {
    serveFirstInteractiveShare();
    let inForce = 2400;
    serve({
      'GET _key-shares/share-team/usage': () =>
        json(200, {
          data: {
            type: 'key-usage',
            id: 'share-team',
            attributes: {
              limits: {
                rateBurst: 25,
                rateRefillPerMinute: 15,
                dailyBudget: inForce,
                monthlyBudget: 72000,
              },
            },
          },
        }),
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    await click('[data-test-radio-choice="interactive"] input');
    assert
      .dom('[data-test-approve-budget="Team GitHub"] input')
      .hasValue('2400');

    // The owner lowers the budget on the share's limits page, in another
    // tab, and comes back to this window.
    inForce = 300;
    window.dispatchEvent(new Event('focus'));
    await settled();
    assert
      .dom('[data-test-approve-budget="Team GitHub"] input')
      .hasValue('300', 'the field takes the budget in force');
    await click('[data-test-approve-save]');
    await settled();
    let [approval] = approvals();
    assert.deepEqual(
      approval.dailyBudgets,
      { 'share-team': 300 },
      'approving keeps the budget set on the limits page',
    );
  });

  test('coming back to the window by clicking Approve approves the daily budget in force', async function (assert) {
    serveFirstInteractiveShare();
    let answer!: () => void;
    let answered = new Promise<void>((resolve) => (answer = resolve));
    serve({
      'GET _key-shares/share-team/usage': async () => {
        await answered;
        return json(200, {
          data: {
            type: 'key-usage',
            id: 'share-team',
            attributes: {
              limits: {
                rateBurst: 25,
                rateRefillPerMinute: 15,
                dailyBudget: 300,
                monthlyBudget: 72000,
              },
            },
          },
        });
      },
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    await click('[data-test-radio-choice="interactive"] input');

    // The click that brings the window back starts the re-read, and the
    // approval goes out while it is still under way.
    window.dispatchEvent(new Event('focus'));
    let approving = click('[data-test-approve-save]');
    answer();
    await approving;
    await settled();
    let [approval] = approvals();
    assert.deepEqual(
      approval.dailyBudgets,
      { 'share-team': 300 },
      'the approval waits for the budget in force',
    );
  });

  test('a daily budget typed on the approve page stays when the window comes back into view', async function (assert) {
    serveFirstInteractiveShare();
    serve({
      'GET _key-shares/share-team/usage': () =>
        json(200, {
          data: {
            type: 'key-usage',
            id: 'share-team',
            attributes: {
              limits: {
                rateBurst: 25,
                rateRefillPerMinute: 15,
                dailyBudget: 300,
                monthlyBudget: 72000,
              },
            },
          },
        }),
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    await click('[data-test-radio-choice="interactive"] input');
    await fillIn('[data-test-approve-budget="Team GitHub"] input', '800');
    window.dispatchEvent(new Event('focus'));
    await settled();
    assert
      .dom('[data-test-approve-budget="Team GitHub"] input')
      .hasValue('800', 'what the user typed is what is approved');
    assert.false(
      requests.some((r) => r.path === '_key-shares/share-team/usage'),
      'a typed field asks nothing',
    );
    await click('[data-test-approve-save]');
    await settled();
    let [approval] = approvals();
    assert.deepEqual(approval.dailyBudgets, { 'share-team': 800 });
  });

  // Serves a batch of two operations a share fills, in a realm whose policy
  // does or doesn't open the first to people who aren't signed in; it never
  // opens the second.
  function serveShareBatch({
    opensToAnonymous,
    share,
  }: {
    opensToAnonymous: boolean;
    share: Record<string, unknown>;
  }) {
    let asShared = (o: ReturnType<typeof operation>) => ({
      ...o,
      slots: o.slots.map((s) => ({ ...s, slot: 'apiKey', key: 'apiKey' })),
    });
    serve({
      'POST _key-bindings/batch': () =>
        json(200, {
          data: {
            type: 'key-binding-batch',
            attributes: withFillers(
              batch({
                groups: [
                  {
                    destination: {
                      href: GRAPHQL,
                      host: 'api.github.com',
                      path: '/graphql/',
                      registrableDomain: 'github.com',
                    },
                    operations: [
                      asShared(
                        operation('listTeamIssues', 'List the team’s issues'),
                      ),
                      asShared(
                        operation(
                          'listTeamPRs',
                          'List the team’s pull requests',
                          {
                            openToAnonymous: opensToAnonymous,
                          },
                        ),
                      ),
                    ],
                  },
                ],
                keys: [],
                shares: [
                  {
                    id: 'share-team',
                    label: 'Team GitHub',
                    keyId: 'key-gh',
                    keyName: 'GitHub token',
                    covers: [GRAPHQL],
                    interactive: false,
                    dailyBudget: 2400,
                    anonymous: false,
                    anonymousDailyCap: null,
                    anonymousMonthlyCap: null,
                    ...share,
                  },
                ],
              }),
            ),
          },
        }),
    });
  }

  test('opened for one of the user’s shares, the approve page starts on that share', async function (assert) {
    serveShareBatch({ opensToAnonymous: false, share: {} });
    let served = routes['POST _key-bindings/batch']!;
    serve({
      'POST _key-bindings/batch': async (request) => {
        let answer = await served(request);
        let attributes = (answer.body as any).data.attributes;
        attributes.shares = [
          ...attributes.shares,
          {
            ...attributes.shares[0],
            id: 'share-other',
            label: 'Other GitHub',
          },
        ];
        // The card's own-key call beside its shared ones.
        attributes.groups[0].operations.push(
          operation('listPRs', 'List your open pull requests'),
        );
        attributes.keys = [
          {
            id: 'key-gh',
            name: 'GitHub token',
            kind: 'static',
            state: 'active',
            covers: [GRAPHQL],
          },
        ];
        (answer.body as any).data.attributes = withFillers({
          ...attributes,
          fillers: undefined,
        });
        return answer;
      },
    });
    visitShell(
      `approve#${new URLSearchParams({ module: MODULE, name: 'Inbox', realm: REALM, share: 'share-other', then: 'keys' })}`,
    );
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    assert
      .dom('[data-test-approve-key="Other GitHub"] input')
      .isChecked('the share the page was opened for');
    assert.dom('[data-test-approve-key="Team GitHub"] input').isNotChecked();
    assert
      .dom('[data-test-approve-tick="listTeamIssues"]')
      .isChecked('the calls that send the workspace’s key start ticked');
    assert.dom('[data-test-approve-tick="listTeamPRs"]').isChecked();
    assert
      .dom('[data-test-approve-tick="listPRs"]')
      .isNotChecked('the call that sends the user’s own key does not');
  });

  test('a key’s share is set up for a card from the key’s use page, opened for that share', async function (assert) {
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
                sharedInto: [
                  {
                    url: REALM,
                    name: 'Team Workspace',
                    shares: [
                      {
                        id: 'share-team',
                        label: 'Team GitHub',
                        state: 'active',
                        approvedCalls: 0,
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }),
      'GET _secure-window/realms': () => json(200, { data: [] }),
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
    visitShell(
      `keys/key-gh/use#${new URLSearchParams({ realm: REALM, share: 'share-team' })}`,
    );
    await render(<template><UseKeyPage @keyId='key-gh' /></template>);
    await waitFor('[data-test-use-key-card]');

    assert
      .dom('[data-test-use-key]')
      .includesText('the key you shared as “Team GitHub”');
    assert
      .dom('[data-test-use-key-share-realm]')
      .includesText('Team Workspace', 'the workspace is the share’s');
    assert.dom('[data-test-use-key-realm]').doesNotExist('nothing to choose');
    assert.deepEqual(
      requests.find((r) => r.path === '_secure-window/cards')?.body.data
        .attributes,
      { realm: REALM, slot: 'apiKey', key: 'key-gh' },
      'the cards that send the workspace’s key, which the shared key can fill',
    );
    await click('[data-test-use-key-next]');
    let url = new URL(navigations[0]!.url!, window.location.href);
    assert.true(url.pathname.endsWith('/approve'));
    assert.deepEqual(
      Object.fromEntries(new URLSearchParams(url.hash.slice(1))),
      {
        module: MODULE,
        name: 'Inbox',
        realm: REALM,
        share: 'share-team',
        then: 'keys',
        back: `keys/key-gh/use#${new URLSearchParams({ realm: REALM, share: 'share-team' })}`,
      },
      'the approve page is opened for the card type, with the share, and its trail leads back here',
    );
  });

  test('the key’s use page opened for a share the key doesn’t have, or a suspended one, says so', async function (assert) {
    let state = 'active';
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
                sharedInto: [
                  {
                    url: REALM,
                    name: 'Team Workspace',
                    shares: [
                      {
                        id: 'share-team',
                        label: 'Team GitHub',
                        state,
                        approvedCalls: 0,
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }),
      'GET _secure-window/realms': () => json(200, { data: [] }),
    });
    visitShell(
      `keys/key-gh/use#${new URLSearchParams({ realm: REALM, share: 'share-gone' })}`,
    );
    await render(<template><UseKeyPage @keyId='key-gh' /></template>);
    await waitFor('[data-test-keys-load-failed]');
    assert
      .dom('[data-test-error-message]')
      .hasText('This key isn’t shared there. The share may have been removed.');
    assert.dom('[data-test-keys-retry]').doesNotExist();

    state = 'suspended';
    visitShell(
      `keys/key-gh/use#${new URLSearchParams({ realm: REALM, share: 'share-team' })}`,
    );
    await render(<template><UseKeyPage @keyId='key-gh' /></template>);
    await waitFor('[data-test-keys-load-failed]');
    assert
      .dom('[data-test-error-message]')
      .hasText('This shared key is suspended, so no card can use it.');
  });

  test('where the workspace lets people who aren’t signed in use a shared key, a share whose key allows them says so, with the key’s anonymous cap', async function (assert) {
    serveShareBatch({
      opensToAnonymous: true,
      share: {
        anonymous: true,
        anonymousDailyCap: 100,
        anonymousMonthlyCap: 1000,
      },
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    await click('[data-test-radio-choice="pipelines"] input');
    assert
      .dom('[data-test-approve-anonymous-note]')
      .doesNotExist('a pipeline serves nobody who opens the card');
    await click('[data-test-radio-choice="interactive"] input');
    assert
      .dom('[data-test-approve-anonymous-note]')
      .hasText(
        'Anyone can use it for requests to github.com (api.github.com/graphql/), including people who aren’t signed in.',
      );
    assert
      .dom('[data-test-approve-anonymous-note] strong')
      .hasText('including people who aren’t signed in');
    assert.dom('[data-test-approve-confirmation]').exists({ count: 2 });
    assert
      .dom('[data-test-approve-interactive]')
      .includesText(
        'Anyone on the internet who opens this card, including people who aren’t signed in, can make these calls with this key, up to 100 calls a day and 1000 a month all together.',
      );
    assert
      .dom('[data-test-approve-budget="Team GitHub"]')
      .doesNotIncludeText(
        'people who aren’t signed in',
        'the cap is the key’s, across every workspace, so the budget isn’t held to it',
      );
    await fillIn('[data-test-approve-budget="Team GitHub"] input', '50');
    assert
      .dom('[data-test-approve-save]')
      .isEnabled('a daily budget below the anonymous cap is sent');

    await click('[data-test-approve-tick="listTeamPRs"]');
    assert
      .dom('[data-test-approve-anonymous-note]')
      .doesNotExist(
        'the operation left ticked is one the policy keeps for signed-in people',
      );
    assert.dom('[data-test-approve-confirmation]').exists({ count: 1 });
    await click('[data-test-approve-tick="listTeamPRs"]');
    await fillIn('[data-test-approve-budget="Team GitHub"] input', '500');
    await click('[data-test-approve-save]');
    await settled();
    let [approval] = approvals();
    assert.true(approval.interactive);
    assert.strictEqual(
      approval.anonymous,
      undefined,
      'the approval itself never asks for anonymous use',
    );
    assert.deepEqual(approval.dailyBudgets, { 'share-team': 500 });
  });

  test('where the workspace lets people who aren’t signed in use a shared key, a share whose key allows signed-in people only says they’re asked to sign in', async function (assert) {
    serveShareBatch({ opensToAnonymous: true, share: {} });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    await click('[data-test-radio-choice="interactive"] input');
    assert.dom('[data-test-approve-anonymous-note]').doesNotExist();
    assert
      .dom('[data-test-approve-signed-in-only-note]')
      .hasText(
        'This workspace lets people who aren’t signed in make these calls, but the key shared as Team GitHub allows signed-in people only, so they’re asked to sign in.',
      );
    assert.dom('[data-test-approve-confirmation]').exists({ count: 1 });
  });

  test('where the workspace lets nobody who isn’t signed in use a shared key, nothing is said of them', async function (assert) {
    serveShareBatch({
      opensToAnonymous: false,
      share: { anonymous: true, anonymousDailyCap: null },
    });
    visitShell(opened);
    await render(<template><ApprovePage /></template>);
    await waitFor('[data-test-approve-form]');
    await click('[data-test-radio-choice="interactive"] input');
    assert.dom('[data-test-approve-anonymous-note]').doesNotExist();
    assert.dom('[data-test-approve-signed-in-only-note]').doesNotExist();
    assert.dom('[data-test-approve-confirmation]').exists({ count: 1 });
  });
});
