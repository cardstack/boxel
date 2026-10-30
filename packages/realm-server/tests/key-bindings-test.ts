import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  DefinitionLookup,
  LooseSingleCardDocument,
  Realm,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import { createJWT, setupPermissionedRealmCached } from './helpers/index.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { realmSecretSeed } from './helpers/index.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
  type SecretsKeyring,
} from '../lib/secrets-at-rest/index.ts';
import {
  addUserKey,
  deleteUserKey,
  mintKeyWriteTicket,
  type KeyWriteAction,
} from '../lib/user-keys.ts';
import { shareKey, swapKeyIntoShare } from '../lib/key-shares.ts';
import {
  bindingSnapshot,
  fillSlots,
  fingerprintOf,
  listOwnBindings,
  pipelineAdmission,
} from '../lib/key-bindings.ts';
import { bindingNames } from '../lib/key-binding-batch.ts';
import { removeGrant } from '../lib/user-key-grants.ts';

// ============================================================================
// Bindings end to end: an owner approves a card's `callApi` operations in a
// realm from the secure origin, and a pipeline the realm server runs invokes
// them against the stub vendor, each slot filled from its binding's grant.
//
// The vendor's URL is written into the card module before anything starts,
// so it listens on a fixed port. Its other loopback name is another host.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/key-bindings-test/');
const secureOriginURL = new URL('https://secure.bindings.test/secure');
const VENDOR_PORT = 4523;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const OTHER_HOST = `http://localhost:${VENDOR_PORT}`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const OWNER = '@binding-owner:localhost';
const WRITER = '@binding-writer:localhost';
const REALM_USER = '@node-test_realm:localhost';
const VALUE = 'sk-binding-owner-key-4f19c2';
const OTHER_VALUE = 'sk-binding-writer-key-81d3aa';
const INBOX = { module: rri(`${realmURL.href}inbox`), name: 'Inbox' };

interface Declarations {
  listUrl?: string;
  listHeader?: string;
  listLabel?: string;
  listOutput?: string;
  noteBody?: string;
}

function inboxModule({
  listUrl = `${VENDOR}/echo/list`,
  listHeader = 'authorization',
  listLabel = 'List your items',
  listOutput = '',
  noteBody = `{ note: params('note') }`,
}: Declarations = {}) {
  return `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { operation, params, bxl } from "@cardstack/base/operations";

    export class Inbox extends CardDef {
      static displayName = 'Team inbox';
      @field channel = contains(StringField);

      @operation static list = {
        base: 'callApi',
        label: '${listLabel}',
        url: '${listUrl}',
        headers: { '${listHeader}': 'Bearer {{userKey}}' },
        ${listOutput ? `output: bxl\`${listOutput}\`,` : ''}
      };

      @operation static note = {
        base: 'callApi',
        params: { note: StringField },
        url: '${VENDOR}/echo/note',
        headers: { authorization: 'Bearer {{userKey}}' },
        json: ${noteBody},
      };

      @operation static elsewhere = {
        base: 'callApi',
        url: '${OTHER_HOST}/echo/elsewhere',
        headers: { authorization: 'Bearer {{userKey}}' },
      };

      @operation static shared = {
        base: 'callApi',
        url: '${VENDOR}/echo/shared',
        headers: { authorization: 'Basic {{apiKey|basic}}' },
      };

      @operation static ping = {
        base: 'callApi',
        url: '${VENDOR}/echo/ping',
      };

      @operation static post = {
        base: 'callApi',
        perInstance: true,
        url: '${VENDOR}/echo/post',
        query: { token: '{{apiKey:hook}}' },
      };
    }
  `;
}

function card(channel: string): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: { channel },
      meta: { adoptsFrom: INBOX },
    },
  };
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let request: SuperTest<Test>;
  let dbAdapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  let keyring: SecretsKeyring;
  let vendor: StubVendor;

  hooks.before(async function () {
    vendor = await startStubVendor({ port: VENDOR_PORT });
  });
  hooks.after(async function () {
    await vendor.close();
  });

  hooks.beforeEach(async function () {
    keyring = installSecretsKeyring(
      await new LocalKeyProvider().loadDataKeys(),
    );
    configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
  });
  hooks.afterEach(function () {
    resetOutbound();
    resetSecretsAtRest();
  });

  setupPermissionedRealmCached(hooks, {
    realmURL,
    secureOriginURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [WRITER]: ['read', 'write'],
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'inbox.gts': inboxModule(),
      'general.json': card('general'),
      'alerts.json': card('alerts'),
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter;
      virtualNetwork = args.virtualNetwork;
      vendor.requests.length = 0;
    },
  });

  async function ticket(
    owner: string,
    action: KeyWriteAction,
    {
      keyId = null,
      realm: realmOf = null,
      shareId = null,
    }: {
      keyId?: string | null;
      realm?: URL | null;
      shareId?: string | null;
    } = {},
  ) {
    return (
      await mintKeyWriteTicket(dbAdapter, owner, {
        action,
        keyId,
        realmURL: realmOf?.href ?? null,
        shareId,
      })
    ).ticket;
  }

  async function addKey(owner = OWNER, value = VALUE, name = 'vendor') {
    return await addUserKey(dbAdapter, keyring, {
      owner,
      name,
      value,
      ticket: await ticket(owner, 'add'),
    });
  }

  function destinationOf(operation: string) {
    return {
      list: `${VENDOR}/echo/`,
      note: `${VENDOR}/echo/`,
      elsewhere: `${OTHER_HOST}/echo/`,
      shared: `${VENDOR}/echo/`,
      post: `${VENDOR}/echo/`,
    }[operation]!;
  }

  function approval(
    operation: string,
    slots: Record<
      string,
      { keyId?: string; shareId?: string; expectedFingerprint?: string }
    >,
    extra: Record<string, unknown> = {},
  ) {
    return {
      codeRef: INBOX,
      operation,
      expectedDestination: destinationOf(operation),
      slots,
      ...extra,
    };
  }

  // What the approval screen shows for an operation, by slot.
  async function preview(user: string, operation: string) {
    return await request
      .get('/_key-bindings/preview')
      .query({
        realm: realmURL.href,
        module: INBOX.module,
        name: INBOX.name,
        operation,
      })
      .set('Authorization', await secureSessionAuth(dbAdapter, user));
  }

  // Approves as `user`, naming for each slot the fingerprint the preview shows
  // now unless the approval names one itself.
  async function approve(
    user: string,
    operations: ReturnType<typeof approval>[],
    {
      authorization,
      origin = secureOriginURL.origin,
      attributes = {},
    }: {
      authorization?: string;
      origin?: string;
      attributes?: Record<string, unknown>;
    } = {},
  ) {
    for (let operation of operations) {
      let shown = (await preview(user, operation.operation)).body.data
        ?.attributes;
      for (let [slot, fill] of Object.entries(operation.slots)) {
        fill.expectedFingerprint ??= shown?.slots.find(
          (s: { slot: string }) => s.slot === slot,
        )?.fingerprint;
      }
    }
    return await request
      .post('/_key-bindings')
      .set(
        'Authorization',
        authorization ?? (await secureSessionAuth(dbAdapter, user)),
      )
      .set('Origin', origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-approval',
          attributes: { realm: realmURL.href, operations, ...attributes },
        },
      });
  }

  function envelope(
    name: string,
    rest: { href?: string; data?: unknown } = {},
  ) {
    return JSON.stringify({
      'boxel:operations': [{ op: 'invoke', 'boxel:name': name, ...rest }],
    });
  }

  function onType(name: string) {
    return envelope(name, { data: { meta: { adoptsFrom: INBOX } } });
  }

  // Invokes as a pipeline the realm server runs as `user`.
  async function runAsPipeline(user: string, body: string) {
    let response = (await realm.handlePipeline(
      new Request(`${realmURL.href}_operations`, {
        method: 'POST',
        headers: {
          Accept: OPERATIONS,
          'Content-Type': OPERATIONS,
          Authorization: `Bearer ${createJWT(realm, user, ['read', 'write'])}`,
        },
        body,
      }),
    ))!;
    return {
      status: response.status,
      body: JSON.parse(await response.text()),
    };
  }

  async function invokeList(user = OWNER) {
    return await runAsPipeline(user, envelope('list', { href: '/general' }));
  }

  function lastVendorRequest() {
    return vendor.requests[vendor.requests.length - 1];
  }

  async function edit(declarations: Declarations) {
    await realm.write('inbox.gts', inboxModule(declarations));
    await realm.indexing();
  }

  test('approving then invoking from a pipeline sends the key in the place the operation declares', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, [
      approval('list', { userKey: { keyId: key.id } }),
    ]);
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    let [binding] = approved.body.data;
    assert.strictEqual(binding.attributes.slot, 'userKey');
    assert.strictEqual(binding.attributes.state, 'active');
    assert.false(binding.attributes.interactive, 'pipelines only');
    assert.strictEqual(binding.meta.request.placement, 'header');
    assert.strictEqual(binding.meta.request.placementName, 'authorization');
    assert.true(binding.meta.grant.created, 'the approval made a grant');
    assert.strictEqual(binding.meta.grant.destination, `${VENDOR}/echo/`);

    let response = await invokeList();
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(vendor.requests.length, 1);
    assert.strictEqual(
      lastVendorRequest().headers.authorization,
      `Bearer ${VALUE}`,
      'the key arrives in the header the declaration names',
    );
    assert.notOk(
      JSON.stringify(response.body).includes(VALUE),
      'and the echo of it is scrubbed from the answer',
    );
  });

  test('a transform is applied, and a share fills an apiKey slot for every caller', async function (assert) {
    let key = await addKey(OWNER, 'user:pass');
    let share = await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId: key.id,
      label: 'Vendor',
      ticket: await ticket(OWNER, 'share', { keyId: key.id, realm: realmURL }),
    });
    let approved = await approve(OWNER, [
      approval('shared', { apiKey: { shareId: share.id } }),
    ]);
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));

    let response = await runAsPipeline(WRITER, onType('shared'));
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(
      lastVendorRequest().headers.authorization,
      `Basic ${Buffer.from('user:pass').toString('base64')}`,
    );
  });

  test('a second operation under a covered destination reuses the grant; one at another host makes a second grant on the same key', async function (assert) {
    let key = await addKey();
    let first = await approve(OWNER, [
      approval('list', { userKey: { keyId: key.id } }),
    ]);
    let grantId = first.body.data[0].meta.grant.id;
    let batch = await approve(OWNER, [
      approval('note', { userKey: { keyId: key.id } }),
      approval('elsewhere', { userKey: { keyId: key.id } }),
    ]);
    assert.strictEqual(batch.status, 201, JSON.stringify(batch.body));
    let [note, elsewhere] = batch.body.data;
    assert.false(note.meta.grant.created);
    assert.strictEqual(note.meta.grant.id, grantId, 'the same grant');
    assert.true(elsewhere.meta.grant.created);
    assert.notStrictEqual(elsewhere.meta.grant.id, grantId);
    assert.strictEqual(elsewhere.meta.grant.keyId, key.id, 'of the same key');
    assert.strictEqual(elsewhere.meta.grant.destination, `${OTHER_HOST}/echo/`);

    let rows = await dbAdapter.execute(
      `SELECT DISTINCT batch_id FROM key_binding_approvals WHERE binding_id = ANY($1::uuid[])`,
      { bind: [[note.id, elsewhere.id]] },
    );
    assert.strictEqual(rows.length, 1, 'one confirmation is one batch');
    assert.strictEqual(rows[0].batch_id, batch.body.meta.batchId);

    let sent = await runAsPipeline(
      OWNER,
      envelope('elsewhere', { href: '/general' }),
    );
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.body));
    assert.strictEqual(
      lastVendorRequest().headers.authorization,
      `Bearer ${VALUE}`,
    );
  });

  test('a binding serves only the realm it was approved in', async function (assert) {
    let key = await addKey();
    await approve(OWNER, [approval('list', { userKey: { keyId: key.id } })]);
    let definition =
      (await realm.operationCore.definitionLookup.lookupDefinition(INBOX))!
        .operations!.list;
    let lookup = {
      type: { module: String(INBOX.module), name: INBOX.name },
      operation: 'list',
      caller: OWNER,
      mode: 'pipeline' as const,
      request: definition.callApi!,
    };
    let filled = await fillSlots(dbAdapter, () => keyring, {
      ...lookup,
      realmURL: realmURL.href,
    });
    assert.strictEqual(filled[0].value, VALUE);
    await assert.rejects(
      fillSlots(dbAdapter, () => keyring, {
        ...lookup,
        realmURL: 'http://127.0.0.1:4444/another-realm/',
      }),
      (e: any) => e.error?.code === 'binding-not-approved',
    );
  });

  test('a userKey binding serves only the user who approved it', async function (assert) {
    let key = await addKey();
    await approve(OWNER, [approval('list', { userKey: { keyId: key.id } })]);
    let response = await invokeList(WRITER);
    assert.strictEqual(response.status, 409);
    assert.strictEqual(response.body.errors[0].code, 'binding-not-approved');
    assert.strictEqual(vendor.requests.length, 0, 'nothing was sent');

    let theirs = await addKey(WRITER, OTHER_VALUE);
    await approve(WRITER, [
      approval('list', { userKey: { keyId: theirs.id } }),
    ]);
    await invokeList(WRITER);
    await invokeList(OWNER);
    assert.deepEqual(
      vendor.requests.map((r) => r.headers.authorization),
      [`Bearer ${OTHER_VALUE}`, `Bearer ${VALUE}`],
      "each caller's own key",
    );
  });

  test('an interactive invocation is refused, and nothing is sent', async function (assert) {
    let key = await addKey();
    await approve(OWNER, [approval('list', { userKey: { keyId: key.id } })]);
    let response = await request
      .post(`/key-bindings-test/_operations`)
      .set('Accept', OPERATIONS)
      .set('Content-Type', OPERATIONS)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, OWNER, ['read', 'write'])}`,
      )
      .send(envelope('list', { href: '/general' }));
    assert.strictEqual(response.status, 403, JSON.stringify(response.body));
    assert.strictEqual(
      response.body.errors[0].code,
      'interactive-use-not-approved',
    );
    assert.strictEqual(vendor.requests.length, 0, 'nothing was sent');

    let interactive = await approve(
      OWNER,
      [approval('list', { userKey: { keyId: key.id } })],
      { attributes: { interactive: true } },
    );
    assert.strictEqual(interactive.status, 403, 'nor can one be approved');
  });

  test('approving takes a session signed in on the secure origin, never the app session', async function (assert) {
    let key = await addKey();
    let appSession = `Bearer ${createRealmServerJWT(
      { user: OWNER, sessionRoom: 'test-session' },
      realmSecretSeed,
    )}`;
    let fromApp = await approve(
      OWNER,
      [approval('list', { userKey: { keyId: key.id } })],
      { authorization: appSession },
    );
    assert.strictEqual(fromApp.status, 403, 'the app session is refused');
    let fromAppOrigin = await approve(
      OWNER,
      [approval('list', { userKey: { keyId: key.id } })],
      { origin: 'http://localhost:4200' },
    );
    assert.strictEqual(
      fromAppOrigin.status,
      403,
      "a secure session from the app's origin is refused",
    );
    let [{ count }] = await dbAdapter.execute(
      `SELECT (SELECT COUNT(*) FROM key_bindings) + (SELECT COUNT(*) FROM user_key_grants) AS count`,
    );
    assert.strictEqual(Number(count), 0, 'no binding or grant is written');
  });

  test('editing what the operation sends needs re-approval; editing its label or response mapping does not', async function (assert) {
    let key = await addKey();
    await approve(OWNER, [
      approval('list', { userKey: { keyId: key.id } }),
      approval('note', { userKey: { keyId: key.id } }),
    ]);

    await edit({ listLabel: 'Your items', listOutput: '{status: .status}' });
    let unchanged = await invokeList();
    assert.strictEqual(unchanged.status, 200, JSON.stringify(unchanged.body));

    for (let [what, declarations] of [
      ['its placement', { listHeader: 'x-api-key' }],
      ['its body', { noteBody: `{ note: params('note'), extra: true }` }],
    ] as const) {
      await edit(declarations);
      let name = what === 'its body' ? 'note' : 'list';
      vendor.requests.length = 0;
      let response = await runAsPipeline(
        OWNER,
        envelope(name, { href: '/general', data: { note: 'hi' } }),
      );
      assert.strictEqual(response.status, 409, what);
      assert.strictEqual(
        response.body.errors[0].code,
        'binding-needs-reapproval',
        `editing ${what} suspends the binding`,
      );
      assert.strictEqual(vendor.requests.length, 0, 'nothing was sent');
      await edit({});
    }

    let notices = await dbAdapter.execute(
      `SELECT owner, reason FROM key_binding_notices`,
    );
    assert.deepEqual(
      notices,
      [
        { owner: OWNER, reason: 'needs-reapproval' },
        { owner: OWNER, reason: 'needs-reapproval' },
      ],
      'one notice for each binding that changed',
    );
    let again = await invokeList();
    assert.strictEqual(
      again.body.errors[0].code,
      'binding-needs-reapproval',
      'reverting the edit does not approve it again',
    );
    assert.strictEqual(
      (
        await dbAdapter.execute(
          `SELECT COUNT(*)::int AS n FROM key_binding_notices`,
        )
      )[0].n,
      2,
      'and the owner is notified once',
    );

    let reapproved = await approve(OWNER, [
      approval('list', { userKey: { keyId: key.id } }),
    ]);
    assert.strictEqual(reapproved.status, 201);
    let history = await dbAdapter.execute(
      `SELECT action FROM key_binding_approvals WHERE binding_id = $1 ORDER BY at`,
      { bind: [reapproved.body.data[0].id] },
    );
    assert.deepEqual(
      history.map((r) => r.action),
      ['approved', 're-approved'],
    );
    assert.strictEqual((await invokeList()).status, 200, 'served again');
  });

  test('after a destination edit, nothing is sent to the new destination before re-approval', async function (assert) {
    let key = await addKey();
    await approve(OWNER, [approval('list', { userKey: { keyId: key.id } })]);
    await edit({ listUrl: `${OTHER_HOST}/echo/list` });
    let response = await invokeList();
    assert.strictEqual(
      response.body.errors[0].code,
      'binding-needs-reapproval',
    );
    assert.strictEqual(vendor.requests.length, 0, 'nothing reached any host');

    let admission = await pipelineAdmission(dbAdapter, {
      core: realm.operationCore,
      realmURL,
      codeRef: INBOX,
      operation: 'list',
      payer: OWNER,
    });
    assert.strictEqual(
      admission?.error.code,
      'binding-needs-reapproval',
      'a pipeline is stopped at admission too',
    );
  });

  test('removing a grant revokes its bindings, each recorded, and refuses them binding-not-approved', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, [
      approval('list', { userKey: { keyId: key.id } }),
      approval('note', { userKey: { keyId: key.id } }),
    ]);
    let grantId = approved.body.data[0].meta.grant.id;
    let { revokedBindings } = await removeGrant(dbAdapter, {
      owner: OWNER,
      grantId,
      via: 'window',
    });
    assert.deepEqual(
      revokedBindings,
      approved.body.data.map((b: { id: string }) => b.id).sort(),
    );
    let revoked = await dbAdapter.execute(
      `SELECT binding_id, operation_name, destination FROM key_binding_approvals WHERE action = 'revoked' ORDER BY operation_name`,
    );
    assert.deepEqual(
      revoked.map((r) => [r.operation_name, r.destination]),
      [
        ['list', `${VENDOR}/echo/`],
        ['note', `${VENDOR}/echo/`],
      ],
      'an approval row each, naming what was revoked',
    );
    let response = await invokeList();
    assert.strictEqual(response.body.errors[0].code, 'binding-not-approved');
    assert.strictEqual(vendor.requests.length, 0);
  });

  test("a binding whose grant belongs to another key is refused binding-not-approved, and that grant's probe is left unclaimed", async function (assert) {
    let key = await addKey();
    let other = await addKey(OWNER, 'another-secret', 'other vendor key');
    let approved = await approve(OWNER, [
      approval('list', { userKey: { keyId: key.id } }),
    ]);
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    let otherApproved = await approve(OWNER, [
      approval('note', { userKey: { keyId: other.id } }),
    ]);
    assert.strictEqual(
      otherApproved.status,
      201,
      JSON.stringify(otherApproved.body),
    );
    let otherGrant = otherApproved.body.data[0].meta.grant.id;
    // A hand-written binding row naming a grant of a key it doesn't hold,
    // rejected by the vendor with its probe due.
    await dbAdapter.execute(
      `UPDATE key_bindings SET grant_id = $1 WHERE id = $2`,
      { bind: [otherGrant, approved.body.data[0].id] },
    );
    await dbAdapter.execute(
      `UPDATE user_key_grants SET state = 'rejected', rejected_at = NOW(), last_probe_at = NOW() - interval '1 day' WHERE id = $1`,
      { bind: [otherGrant] },
    );
    let [before] = await dbAdapter.execute(
      `SELECT last_probe_at FROM user_key_grants WHERE id = $1`,
      { bind: [otherGrant] },
    );

    let response = await invokeList();
    assert.strictEqual(response.status, 409, JSON.stringify(response.body));
    assert.strictEqual(response.body.errors[0].code, 'binding-not-approved');
    assert.strictEqual(vendor.requests.length, 0, 'nothing is sent');
    let [after] = await dbAdapter.execute(
      `SELECT last_probe_at FROM user_key_grants WHERE id = $1`,
      { bind: [otherGrant] },
    );
    assert.strictEqual(
      String(after.last_probe_at),
      String(before.last_probe_at),
      "the other key's grant keeps its probe",
    );
  });

  test('revoking a binding leaves its grant; deleting the key revokes its bindings', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, [
      approval('list', { userKey: { keyId: key.id } }),
      approval('note', { userKey: { keyId: key.id } }),
    ]);
    let [list, note] = approved.body.data;
    let revoke = await request
      .delete(`/_key-bindings/${list.id}`)
      .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
      .set('Origin', secureOriginURL.origin);
    assert.strictEqual(revoke.status, 204);
    let [{ n }] = await dbAdapter.execute(
      `SELECT COUNT(*)::int AS n FROM user_key_grants`,
    );
    assert.strictEqual(n, 1, 'the grant stays');
    assert.strictEqual(
      (await invokeList()).body.errors[0].code,
      'binding-not-approved',
    );

    await deleteUserKey(dbAdapter, {
      owner: OWNER,
      id: key.id,
      ticket: await ticket(OWNER, 'delete', { keyId: key.id }),
    });
    let remaining = await dbAdapter.execute(`SELECT id FROM key_bindings`);
    assert.deepEqual(remaining, [], 'the key took its bindings with it');
    let [last] = await dbAdapter.execute(
      `SELECT action, actor, via FROM key_binding_approvals WHERE binding_id = $1 ORDER BY at DESC LIMIT 1`,
      { bind: [note.id] },
    );
    assert.deepEqual(last, { action: 'revoked', actor: OWNER, via: null });
  });

  test("a suspended share's bindings are refused share-suspended, and a swap moves them to the new key's grants", async function (assert) {
    let key = await addKey();
    let share = await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId: key.id,
      label: 'Vendor',
      ticket: await ticket(OWNER, 'share', { keyId: key.id, realm: realmURL }),
    });
    let approved = await approve(OWNER, [
      approval('shared', { apiKey: { shareId: share.id } }),
    ]);
    let bindingId = approved.body.data[0].id;
    let listed = await request
      .get(`/_key-shares?realm=${encodeURIComponent(realmURL.href)}`)
      .set('Authorization', await secureSessionAuth(dbAdapter, WRITER));
    assert.deepEqual(
      listed.body.data[0].attributes.operations,
      [
        {
          bindingId,
          type: { module: String(INBOX.module), name: INBOX.name },
          operation: 'shared',
          instance: null,
          slot: 'apiKey',
          state: 'active',
        },
      ],
      "the realm's writers see what the share is approved for",
    );

    await dbAdapter.execute(
      `UPDATE realm_user_permissions SET write = false WHERE realm_url = $1 AND username = $2`,
      { bind: [realmURL.href, OWNER] },
    );
    let suspended = await runAsPipeline(WRITER, onType('shared'));
    assert.strictEqual(suspended.status, 409);
    assert.strictEqual(suspended.body.errors[0].code, 'share-suspended');
    let [{ state }] = await dbAdapter.execute(
      `SELECT state FROM key_bindings WHERE id = $1`,
      { bind: [bindingId] },
    );
    assert.strictEqual(state, 'suspended', 'the binding follows its share');

    let theirs = await addKey(WRITER, OTHER_VALUE);
    let swapTicket = await ticket(WRITER, 'swap', {
      keyId: theirs.id,
      shareId: share.id,
    });
    await assert.rejects(
      swapKeyIntoShare(dbAdapter, keyring, {
        user: WRITER,
        shareId: share.id,
        keyId: theirs.id,
        ticket: swapTicket,
        via: undefined,
      }),
      /secure window or the CLI/,
      'a swap that moves bindings needs a secure-origin session',
    );
    let { reapprovedBindings } = await swapKeyIntoShare(dbAdapter, keyring, {
      user: WRITER,
      shareId: share.id,
      keyId: theirs.id,
      ticket: swapTicket,
      via: 'window',
    });
    assert.deepEqual(reapprovedBindings, [bindingId]);
    let [moved] = await dbAdapter.execute(
      `SELECT b.state, b.approved_by, g.key_id, g.destination FROM key_bindings b JOIN user_key_grants g ON g.id = b.grant_id WHERE b.id = $1`,
      { bind: [bindingId] },
    );
    assert.deepEqual(moved, {
      state: 'active',
      approved_by: WRITER,
      key_id: theirs.id,
      destination: `${VENDOR}/echo/`,
    });
    let [last] = await dbAdapter.execute(
      `SELECT action, actor FROM key_binding_approvals WHERE binding_id = $1 ORDER BY at DESC LIMIT 1`,
      { bind: [bindingId] },
    );
    assert.deepEqual(last, { action: 're-approved', actor: WRITER });

    let response = await runAsPipeline(WRITER, onType('shared'));
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(
      lastVendorRequest().headers.authorization,
      `Basic ${Buffer.from(OTHER_VALUE).toString('base64')}`,
      "the new key, under the new key's grant",
    );
  });

  test("a realm's share listing names each operation's type and card in RRI form, as the bindings listing does", async function (assert) {
    let key = await addKey();
    let share = await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId: key.id,
      label: 'Vendor',
      ticket: await ticket(OWNER, 'share', { keyId: key.id, realm: realmURL }),
    });
    await approve(OWNER, [
      approval('shared', { apiKey: { shareId: share.id } }),
    ]);
    let prefix = '@test/key-bindings/';
    virtualNetwork.addRealmMapping(prefix, realmURL.href);
    try {
      let shares = await request
        .get(`/_key-shares?realm=${encodeURIComponent(realmURL.href)}`)
        .set('Authorization', await secureSessionAuth(dbAdapter, WRITER));
      let bindings = await request
        .get('/_key-bindings')
        .set('Authorization', await secureSessionAuth(dbAdapter, OWNER));
      let [operation] = shares.body.data[0].attributes.operations;
      assert.strictEqual(
        operation.type.module,
        `${prefix}inbox`,
        'the module is named by its prefix',
      );
      assert.deepEqual(
        operation.type,
        bindings.body.data[0].attributes.type,
        'both listings spell the type the same way',
      );
    } finally {
      virtualNetwork.removeRealmMapping(prefix);
    }
  });

  test('the bindings listing names each by its operation label and card display name, and by names alone once the owner can no longer read the card', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, [
      approval('list', { userKey: { keyId: key.id } }),
      approval('note', { userKey: { keyId: key.id } }),
    ]);
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    async function listed() {
      let response = await request
        .get('/_key-bindings')
        .set('Authorization', await secureSessionAuth(dbAdapter, OWNER));
      assert.strictEqual(response.status, 200);
      return response.body.data.map(
        ({
          attributes: { operation, operationLabel, cardName },
        }: {
          attributes: Record<string, string>;
        }) => [operation, operationLabel, cardName],
      );
    }

    assert.deepEqual(
      await listed(),
      [
        ['list', 'List your items', 'Team inbox'],
        ['note', 'Note', 'Team inbox'],
      ],
      'a declared label and the display name; an operation with no label by its name in words',
    );

    // The card's module is in this realm, so taking the owner's read on the
    // realm takes it on the module too.
    await dbAdapter.execute(
      `UPDATE realm_user_permissions SET read = false, write = false WHERE realm_url = $1 AND username = $2`,
      { bind: [realmURL.href, OWNER] },
    );
    assert.deepEqual(
      await listed(),
      [
        ['list', 'List', 'Inbox'],
        ['note', 'Note', 'Inbox'],
      ],
      "a card the owner can't read is named by its export name, and its operations by their names in words",
    );
  });

  test('a type whose realm fails to mount is named from its binding row, and the listing still answers', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, [
      approval('list', { userKey: { keyId: key.id } }),
    ]);
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    let bindings = await listOwnBindings(dbAdapter, OWNER);

    // Finding a realm mounts it, so a mount that fails surfaces here, as an
    // error that isn't a not-found.
    let names = await bindingNames(
      {
        dbAdapter,
        findRealm: async () => {
          throw new Error('the realm failed to start');
        },
        definitionLookup: {
          forRealm() {
            throw new Error('a definition is never read for this type');
          },
        } as unknown as DefinitionLookup,
        virtualNetwork,
      },
      OWNER,
      bindings,
    );
    assert.deepEqual(names, [{ operationLabel: 'List', cardName: 'Inbox' }]);
  });

  test('an operation approved per instance serves only the card it was approved for', async function (assert) {
    let key = await addKey();
    let share = await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId: key.id,
      label: 'Hooks',
      ticket: await ticket(OWNER, 'share', { keyId: key.id, realm: realmURL }),
    });
    let withoutInstance = await approve(OWNER, [
      approval('post', { 'apiKey:hook': { shareId: share.id } }),
    ]);
    assert.strictEqual(withoutInstance.status, 400, 'it names its card');
    let approved = await approve(OWNER, [
      approval(
        'post',
        { 'apiKey:hook': { shareId: share.id } },
        { instance: `${realmURL.href}general.json` },
      ),
    ]);
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    assert.strictEqual(
      approved.body.data[0].attributes.instance,
      `${realmURL.href}general`,
      'the card is recorded as invocations address it',
    );

    let general = await runAsPipeline(
      WRITER,
      envelope('post', { href: '/general' }),
    );
    assert.strictEqual(general.status, 200, JSON.stringify(general.body));
    assert.strictEqual(lastVendorRequest().path, `/echo/post?token=${VALUE}`);

    let alerts = await runAsPipeline(
      WRITER,
      envelope('post', { href: '/alerts' }),
    );
    assert.strictEqual(alerts.body.errors[0].code, 'binding-not-approved');
    assert.strictEqual(vendor.requests.length, 1, 'nothing more was sent');
  });

  test('approving refuses a destination or a request other than the one shown', async function (assert) {
    let key = await addKey();
    let moved = await approve(OWNER, [
      {
        ...approval('list', { userKey: { keyId: key.id } }),
        expectedDestination: `${OTHER_HOST}/echo/`,
      },
    ]);
    assert.strictEqual(moved.status, 409);
    let wrongSlot = await approve(OWNER, [
      approval('list', { apiKey: { keyId: key.id } }),
    ]);
    assert.strictEqual(wrongSlot.status, 400);

    let shown = (await preview(OWNER, 'list')).body.data.attributes;
    assert.strictEqual(shown.destination, `${VENDOR}/echo/`);
    assert.strictEqual(shown.slots[0].snapshot.placementName, 'authorization');
    await edit({ listHeader: 'x-api-key' });
    let edited = await approve(OWNER, [
      approval('list', {
        userKey: {
          keyId: key.id,
          expectedFingerprint: shown.slots[0].fingerprint,
        },
      }),
    ]);
    assert.strictEqual(
      edited.status,
      409,
      'the key moved since the request was shown, at the same destination',
    );

    let listed = await request
      .get('/_key-bindings')
      .set('Authorization', await secureSessionAuth(dbAdapter, OWNER));
    assert.deepEqual(listed.body.data, [], 'nothing was approved');
  });

  test("a share is approved only by its key's owner, and only while it is active", async function (assert) {
    let key = await addKey();
    let share = await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId: key.id,
      label: 'Vendor',
      ticket: await ticket(OWNER, 'share', { keyId: key.id, realm: realmURL }),
    });
    let byWriter = await approve(WRITER, [
      approval('shared', { apiKey: { shareId: share.id } }),
    ]);
    assert.strictEqual(byWriter.status, 404, "another writer can't approve it");

    await dbAdapter.execute(
      `UPDATE realm_user_permissions SET write = false WHERE realm_url = $1 AND username = $2`,
      { bind: [realmURL.href, OWNER] },
    );
    let suspended = await approve(OWNER, [
      approval('shared', { apiKey: { shareId: share.id } }),
    ]);
    assert.strictEqual(suspended.status, 409, 'nor its owner while suspended');
    let [{ n }] = await dbAdapter.execute(
      `SELECT COUNT(*)::int AS n FROM key_bindings`,
    );
    assert.strictEqual(n, 0);
  });

  test('a keyless operation is sent from an interactive and a pipeline invocation alike, with no binding', async function (assert) {
    let interactive = await request
      .post(`/key-bindings-test/_operations`)
      .set('Accept', OPERATIONS)
      .set('Content-Type', OPERATIONS)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, OWNER, ['read', 'write'])}`,
      )
      .send(envelope('ping', { href: '/general' }));
    assert.strictEqual(
      interactive.status,
      200,
      JSON.stringify(interactive.body),
    );
    let pipeline = await runAsPipeline(
      OWNER,
      envelope('ping', { href: '/general' }),
    );
    assert.strictEqual(pipeline.status, 200, JSON.stringify(pipeline.body));
    assert.deepEqual(
      vendor.requests.map((r) => r.path),
      ['/echo/ping', '/echo/ping'],
    );
  });

  test('the fingerprint is a fixed encoding of what reaches the vendor, whatever order members are written in', async function (assert) {
    let slot = {
      name: 'userKey',
      key: 'userKey' as const,
      placement: 'header' as const,
      at: 'headers.authorization',
    };
    let request = {
      method: 'POST' as const,
      url: 'https://api.example.com/v1/repos/{owner}/issues',
      destination: 'https://api.example.com/v1/repos/',
      path: { owner: { $ref: 'params', key: 'owner' } },
      query: { state: 'open' },
      headers: {
        authorization: 'Bearer {{userKey}}',
        accept: 'application/json',
      },
      body: {
        kind: 'json' as const,
        value: { title: { $ref: 'params', key: 'title' }, labels: ['bug'] },
      },
      slots: [slot],
    };
    // Changing this value changes every stored binding's fingerprint, and so
    // asks every owner to approve again. Change the encoding's version tag
    // with it, deliberately.
    assert.strictEqual(
      fingerprintOf(bindingSnapshot(request as never, slot)),
      'fc056eab8001f8eaabc7a318aa9c28e61bd951d2ca44d76cd5596ac3753e9f57',
    );
    let reordered = {
      ...request,
      headers: {
        accept: 'application/json',
        authorization: 'Bearer {{userKey}}',
      },
      body: {
        value: { labels: ['bug'], title: { key: 'title', $ref: 'params' } },
        kind: 'json' as const,
      },
    };
    assert.strictEqual(
      fingerprintOf(bindingSnapshot(reordered as never, slot)),
      fingerprintOf(bindingSnapshot(request as never, slot)),
      'member order does not change it',
    );
    assert.notStrictEqual(
      fingerprintOf(
        bindingSnapshot(
          { ...request, query: { state: 'closed' } } as never,
          slot,
        ),
      ),
      fingerprintOf(bindingSnapshot(request as never, slot)),
      'a query value does',
    );
  });
});
