import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test } from 'supertest';

import {
  DURING_PRERENDER_HEADER,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import {
  setKeyUseSink,
  type KeyUseEvent,
} from '@cardstack/runtime-common/card-operations';
import { configureOutbound, resetOutbound } from '../../lib/outbound/client.ts';
import {
  createJWT,
  setupPermissionedRealmCached,
  testCreatePrerenderAuth,
  withRealmPath,
  type RealmRequest,
} from '../helpers/index.ts';
import { startStubVendor, type StubVendor } from '../helpers/stub-vendor.ts';

// ============================================================================
// `callApi` through the `_operations` endpoint: a request a card declares,
// lowered when its module is indexed and sent by the realm server against the
// stub vendor.
//
// The vendor's URL is written into the card module before anything starts, so
// it listens on a fixed port.
// ============================================================================

const testRealm = new URL('http://127.0.0.1:4474/test/');
const VENDOR_PORT = 4519;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const TESTER = '@tester:localhost';
const READER = '@reader:localhost';
const OWNER = '@node-test_realm:localhost';
const REPO = { module: rri(`${testRealm.href}repo`), name: 'Repo' };

function envelope(...operations: unknown[]) {
  return JSON.stringify({ 'boxel:operations': operations });
}

function invoke(name: string, rest: { href?: string; data?: unknown } = {}) {
  return { op: 'invoke', 'boxel:name': name, ...rest };
}

function makeFileSystem(): Record<string, string | LooseSingleCardDocument> {
  return {
    'repo.gts': `
      import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import { operation, params, instance, actor, bxl } from "@cardstack/base/operations";

      export class Repo extends CardDef {
        @field owner = contains(StringField);
        @field slug = contains(StringField, {
          computeVia: function (this: Repo) {
            return \`\${this.owner}-repo\`;
          },
        });

        @operation static issues = {
          base: 'callApi',
          params: { state: StringField },
          url: '${VENDOR}/repos/{owner}/{slug}/issues',
          path: { owner: instance('owner'), slug: instance('slug') },
          query: { state: params('state') },
        };

        @operation static lookup = {
          base: 'callApi',
          params: { name: StringField },
          url: '${VENDOR}/items/{name}',
          path: { name: params('name') },
        };

        @operation static note = {
          base: 'callApi',
          params: { note: StringField },
          url: '${VENDOR}/echo',
          json: { note: params('note'), by: actor() },
        };

        @operation static failing = {
          base: 'callApi',
          url: '${VENDOR}/status/500',
        };

        @operation static summary = {
          base: 'callApi',
          url: '${VENDOR}/echo',
          output: bxl\`{status: .status, method: .body.method}\`,
        };

        @operation static withKey = {
          base: 'callApi',
          url: '${VENDOR}/echo',
          headers: { authorization: 'Bearer {{userKey}}' },
        };

        @operation static twice = {
          base: 'callApi',
          url: '${VENDOR}/echo',
          headers: { authorization: 'Bearer {{apiKey}}' },
          query: { key: '{{apiKey}}' },
        };

        static isolated = class Isolated extends Component<typeof this> {
          <template><h1><@fields.owner /></h1></template>
        }
      }
    `,
    'repo.json': {
      data: {
        type: 'card',
        attributes: { owner: 'cardstack' },
        meta: { adoptsFrom: REPO },
      },
    },
  };
}

module(`realm-endpoints/${basename(import.meta.filename)}`, function (hooks) {
  let realm: Realm;
  let request: RealmRequest;
  let vendor: StubVendor;
  let keyUse: KeyUseEvent[];

  hooks.before(async function () {
    vendor = await startStubVendor({ port: VENDOR_PORT });
  });
  hooks.after(async function () {
    await vendor.close();
  });

  setupPermissionedRealmCached(hooks, {
    mode: 'before',
    realmURL: testRealm,
    permissions: {
      '*': ['read'],
      [TESTER]: ['read', 'write'],
      [READER]: ['read'],
      [OWNER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: makeFileSystem(),
    onRealmSetup(args) {
      realm = args.testRealm;
      request = withRealmPath(args.request, testRealm);
    },
  });

  hooks.beforeEach(function () {
    vendor.requests.length = 0;
    keyUse = [];
    setKeyUseSink((event) => keyUse.push(event));
    configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
  });
  hooks.afterEach(function () {
    setKeyUseSink(undefined);
    resetOutbound();
  });

  function anonymousPost(body: string): Test {
    return request
      .post('/_operations')
      .set('Accept', OPERATIONS)
      .set('Content-Type', OPERATIONS)
      .send(body);
  }

  function post(body: string): Test {
    return anonymousPost(body).set(
      'Authorization',
      `Bearer ${createJWT(realm, TESTER, ['read', 'write'])}`,
    );
  }

  test("a keyless request on an instance is filled from its indexed fields, and the vendor's 404 is its answer", async function (assert) {
    let response = await post(
      envelope(invoke('issues', { href: '/repo', data: { state: 'open' } })),
    );

    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body['atomic:results'][0], {
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: { error: 'Not found' },
    });
    assert.strictEqual(vendor.requests.length, 1);
    assert.strictEqual(
      vendor.requests[0].path,
      '/repos/cardstack/cardstack-repo/issues?state=open',
      'a stored field and a computed one each fill their segment',
    );
  });

  test('a keyless request on the type is filled from the payload alone, a path value staying one segment', async function (assert) {
    let response = await post(
      envelope(
        invoke('lookup', {
          data: { name: 'a b?#%', meta: { adoptsFrom: REPO } },
        }),
      ),
    );

    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(response.body['atomic:results'][0].status, 404);
    assert.strictEqual(
      vendor.requests[0].path,
      '/items/a%20b%3F%23%25',
      'the value is encoded as one segment, and reaches neither the query nor the fragment',
    );
  });

  for (let name of ['../admin', '..\\admin', 'a/b']) {
    test(`a path value holding a path separator (${JSON.stringify(name)}) is refused before anything is sent`, async function (assert) {
      let response = await post(
        envelope(
          invoke('lookup', { data: { name, meta: { adoptsFrom: REPO } } }),
        ),
      );
      assert.strictEqual(response.status, 400, JSON.stringify(response.body));
      assert.strictEqual(response.body.errors[0].code, 'invalid-params');
      assert.strictEqual(response.body.errors[0].meta.path, 'path.name');
      assert.true(
        response.body.errors[0].detail.includes('path separator'),
        response.body.errors[0].detail,
      );
      assert.strictEqual(vendor.requests.length, 0);
    });
  }

  test('a path value that is not valid Unicode is refused before anything is sent', async function (assert) {
    let response = await post(
      envelope(
        invoke('lookup', {
          data: { name: '\ud800', meta: { adoptsFrom: REPO } },
        }),
      ),
    );
    assert.strictEqual(response.status, 400, JSON.stringify(response.body));
    assert.strictEqual(response.body.errors[0].code, 'invalid-params');
    assert.strictEqual(response.body.errors[0].meta.path, 'path.name');
    assert.strictEqual(vendor.requests.length, 0);
  });

  test('a path value that is a dot segment is refused before anything is sent', async function (assert) {
    let response = await post(
      envelope(
        invoke('lookup', { data: { name: '..', meta: { adoptsFrom: REPO } } }),
      ),
    );
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.errors[0].code, 'invalid-params');
    assert.strictEqual(vendor.requests.length, 0);
  });

  test('an http request to a host the guard does not allowlist is refused guard-refused before anything is sent', async function (assert) {
    configureOutbound({ devAllowlist: ['localhost'] });
    let response = await post(envelope(invoke('failing', { href: '/repo' })));
    assert.strictEqual(response.status, 502, JSON.stringify(response.body));
    assert.strictEqual(response.body.errors[0].code, 'guard-refused');
    assert.strictEqual(response.body.errors[0].meta.reason, 'scheme');
    assert.strictEqual(vendor.requests.length, 0, 'nothing was sent');
  });

  test('an http request to a host the guard allowlists is sent', async function (assert) {
    configureOutbound({ devAllowlist: ['127.0.0.1'] });
    let response = await post(envelope(invoke('failing', { href: '/repo' })));
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(response.body['atomic:results'][0].status, 500);
    assert.strictEqual(vendor.requests.length, 1);
  });

  test("a vendor's 500 is an answer, not a refusal", async function (assert) {
    let response = await post(envelope(invoke('failing', { href: '/repo' })));
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body['atomic:results'][0].status, 500);
  });

  test('a JSON body is filled from the payload and the caller', async function (assert) {
    let response = await post(
      envelope(invoke('note', { href: '/repo', data: { note: 'hello' } })),
    );
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    let received = vendor.requests[0];
    assert.strictEqual(received.method, 'POST');
    assert.deepEqual(JSON.parse(received.body), {
      note: 'hello',
      by: TESTER,
    });
    assert.strictEqual(received.headers['content-type'], 'application/json');
  });

  test('an `output` maps the response', async function (assert) {
    let response = await post(envelope(invoke('summary', { href: '/repo' })));
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body['atomic:results'][0], {
      status: 200,
      method: 'GET',
    });
  });

  test('a request with a credential slot is refused binding-not-approved, and nothing is sent', async function (assert) {
    let response = await post(envelope(invoke('withKey', { href: '/repo' })));
    assert.strictEqual(response.status, 409);
    assert.strictEqual(response.body.errors[0].code, 'binding-not-approved');
    assert.deepEqual(response.body.errors[0].meta.slots, [
      { name: 'userKey', key: 'userKey' },
    ]);
    assert.true(
      response.body.errors[0].detail.includes(
        `the credential slot "userKey" for the invoking user's own key`,
      ),
      `the detail says whose key fills the slot: ${response.body.errors[0].detail}`,
    );
    assert.strictEqual(vendor.requests.length, 0);
  });

  test('a caller only permitted to read the realm is refused, and nothing is sent', async function (assert) {
    let response = await anonymousPost(
      envelope(invoke('failing', { href: '/repo' })),
    ).set('Authorization', `Bearer ${createJWT(realm, READER, ['read'])}`);
    assert.strictEqual(response.status, 403, JSON.stringify(response.body));
    assert.strictEqual(vendor.requests.length, 0);
  });

  test('a request made on the session a render runs under is refused, with or without the prerender mark', async function (assert) {
    let sessions = JSON.parse(
      testCreatePrerenderAuth(
        OWNER,
        { [testRealm.href]: ['read', 'write', 'realm-owner'] },
        { realmAuthority: true },
      ),
    ) as Record<string, string>;
    let response = await anonymousPost(
      envelope(invoke('failing', { href: '/repo' })),
    ).set('Authorization', `Bearer ${sessions[testRealm.href]}`);
    assert.strictEqual(response.status, 403, JSON.stringify(response.body));
    assert.strictEqual(response.body.errors[0].code, 'not-during-render');
    assert.strictEqual(vendor.requests.length, 0);
  });

  test('a request is refused during a render', async function (assert) {
    let response = await post(
      envelope(invoke('failing', { href: '/repo' })),
    ).set(DURING_PRERENDER_HEADER, '1');
    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.body.errors[0].code, 'not-during-render');
    assert.strictEqual(vendor.requests.length, 0);
  });

  test('a request is refused in a read-only batch', async function (assert) {
    let response = await post(
      envelope(invoke('failing', { href: '/repo' })),
    ).set('X-HTTP-Method-Override', 'QUERY');
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.errors[0].code, 'wrong-entry-point');
    assert.strictEqual(vendor.requests.length, 0);
  });

  test('a request travels in a batch of its own', async function (assert) {
    let response = await post(
      envelope(
        invoke('failing', { href: '/repo' }),
        invoke('read', { href: '/repo' }),
      ),
    );
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.errors[0].code, 'invalid-params');
    assert.strictEqual(vendor.requests.length, 0, 'nothing was sent');
  });

  test('a request declaring a slot twice is refused invalid-operation', async function (assert) {
    let response = await post(envelope(invoke('twice', { href: '/repo' })));
    assert.strictEqual(response.status, 422);
    assert.strictEqual(response.body.errors[0].code, 'invalid-operation');
    assert.deepEqual(
      response.body.errors[0].meta.issues.map(
        (issue: { code: string }) => issue.code,
      ),
      ['slot-placed-twice'],
    );
  });

  test('the key-use line records the operation, realm, caller, URL and outcome, and never a value', async function (assert) {
    await post(
      envelope(
        invoke('issues', {
          href: '/repo',
          data: { state: 'private-search-term' },
        }),
      ),
    );
    await post(envelope(invoke('withKey', { href: '/repo' })));

    assert.deepEqual(keyUse, [
      {
        operation: 'issues',
        realm: testRealm.href,
        caller: TESTER,
        url: `${VENDOR}/repos/cardstack/cardstack-repo/issues`,
        outcome: 'sent',
        status: 404,
      },
      {
        operation: 'withKey',
        realm: testRealm.href,
        caller: TESTER,
        url: null,
        outcome: 'refused',
        code: 'binding-not-approved',
      },
    ]);
    assert.false(
      JSON.stringify(keyUse).includes('private-search-term'),
      "the caller's query string is never recorded",
    );
  });
});
