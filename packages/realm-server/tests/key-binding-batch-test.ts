import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { rri } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import {
  realmSecretSeed,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
  type SecretsKeyring,
} from '../lib/secrets-at-rest/index.ts';
import {
  addUserKey,
  mintKeyWriteTicket,
  type KeyWriteAction,
} from '../lib/user-keys.ts';
import { shareKey } from '../lib/key-shares.ts';
import { pipelineAdmission } from '../lib/key-bindings.ts';
import { removeGrant } from '../lib/user-key-grants.ts';

// ============================================================================
// The batch the secure window approves in one confirmation: every `callApi`
// operation on a card definition, in a realm, that needs the caller's
// approval, read through `POST /_key-bindings/batch`, approved through
// `POST /_key-bindings` as the window does, and checked at a pipeline's
// admission. Nothing here is sent anywhere, so the destinations name a port
// nothing listens on.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/key-binding-batch-test/');
const secureOriginURL = new URL('https://secure.batch.test/secure');
const VENDOR = 'http://127.0.0.1:4525';
const OTHER_HOST = 'http://localhost:4525';
const OWNER = '@batch-owner:localhost';
const WRITER = '@batch-writer:localhost';
const REALM_USER = '@node-test_realm:localhost';
const VALUE = 'sk-batch-owner-key-7c20d1';
const INBOX = { module: rri(`${realmURL.href}inbox`), name: 'Inbox' };
const DIGEST = { module: rri(`${realmURL.href}digest`), name: 'Digest' };
const GRAPHQL_OPERATIONS = [
  'listPRs',
  'listIssues',
  'listReviews',
  'listComments',
  'listLabels',
  'listMilestones',
];

function graphqlOperation(name: string, document: string) {
  return `
      @operation static ${name} = {
        base: 'callApi',
        method: 'POST',
        url: '${VENDOR}/graphql',
        headers: { authorization: 'Bearer {{userKey}}' },
        graphql: { document: '${document}' },
      };`;
}

function inboxModule({
  listPRsDocument = 'query { viewer { pullRequests { totalCount } } }',
}: { listPRsDocument?: string } = {}) {
  return `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { operation } from "@cardstack/base/operations";

    export class Inbox extends CardDef {
      @field channel = contains(StringField);
      ${GRAPHQL_OPERATIONS.map((name) =>
        graphqlOperation(
          name,
          name === 'listPRs'
            ? listPRsDocument
            : `query { viewer { ${name} { totalCount } } }`,
        ),
      ).join('\n')}

      @operation static elsewhere = {
        base: 'callApi',
        label: 'Read from the other host',
        url: '${OTHER_HOST}/v1/items',
        headers: { authorization: 'Bearer {{userKey}}' },
      };

      @operation static shared = {
        base: 'callApi',
        url: '${VENDOR}/shared',
        headers: { authorization: 'Bearer {{apiKey}}' },
      };

      @operation static post = {
        base: 'callApi',
        perInstance: true,
        url: '${VENDOR}/post',
        headers: { authorization: 'Bearer {{userKey}}' },
      };

      @operation static ping = {
        base: 'callApi',
        url: '${VENDOR}/ping',
      };
    }
  `;
}

const digestModule = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";

  export class Digest extends CardDef {
    @field title = contains(StringField);
    ${graphqlOperation('summary', 'query { viewer { login } }')}
  }
`;

function card(adoptsFrom: {
  module: string;
  name: string;
}): LooseSingleCardDocument {
  return {
    data: { type: 'card', attributes: {}, meta: { adoptsFrom } },
  };
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let request: SuperTest<Test>;
  let dbAdapter: PgAdapter;
  let keyring: SecretsKeyring;

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
      'digest.gts': digestModule,
      'general.json': card(INBOX),
      'weekly.json': card(DIGEST),
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter;
    },
  });

  async function ticket(
    owner: string,
    action: KeyWriteAction,
    {
      keyId = null,
      realm: realmOf = null,
    }: { keyId?: string | null; realm?: URL | null } = {},
  ) {
    return (
      await mintKeyWriteTicket(dbAdapter, owner, {
        action,
        keyId,
        realmURL: realmOf?.href ?? null,
        shareId: null,
      })
    ).ticket;
  }

  async function addKey(owner = OWNER, name = 'vendor') {
    return await addUserKey(dbAdapter, keyring, {
      owner,
      name,
      value: VALUE,
      ticket: await ticket(owner, 'add'),
    });
  }

  interface Slot {
    slot: string;
    key: string;
    status: string;
    fingerprint: string;
    snapshot: Record<string, string | null>;
    approved?: { snapshot: Record<string, string | null> };
  }
  interface Operation {
    name: string;
    label: string;
    method: string;
    path: string;
    instance: string | null;
    status: string;
    slots: Slot[];
  }
  interface Batch {
    realm: { url: string; name: string };
    card: { name: string; module: string; exportName: string };
    groups: {
      destination: { href: string; host: string; registrableDomain: string };
      operations: Operation[];
    }[];
    keys: { id: string; name: string; covers: string[] }[];
    shares: { id: string; label: string; covers: string[] }[];
  }

  async function batch(
    user: string,
    target: Record<string, string>,
    extra: Record<string, unknown> = {},
  ) {
    return await request
      .post('/_key-bindings/batch')
      .set('Authorization', await secureSessionAuth(dbAdapter, user))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: { type: 'key-binding-batch', attributes: { target, ...extra } },
      });
  }

  function onType(type: { module: string; name: string }) {
    return { kind: 'type', ...type, realm: realmURL.href };
  }

  async function batchOf(
    user: string,
    target: Record<string, string>,
    extra: Record<string, unknown> = {},
  ): Promise<Batch> {
    let response = await batch(user, target, extra);
    if (response.status !== 200) {
      throw new Error(
        `batch answered ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
    return response.body.data.attributes;
  }

  function operationsIn(found: Batch): Operation[] {
    return found.groups.flatMap((g) => g.operations);
  }

  // Approves what the window would: each named operation's slots filled as
  // `fill` says, with the fingerprint the batch showed.
  async function approveFrom(
    user: string,
    found: Batch,
    names: string[],
    fill: (slot: Slot) => Record<string, string>,
    codeRef: { module: string; name: string } = INBOX,
  ) {
    let operations = found.groups.flatMap((group) =>
      group.operations
        .filter((o) => names.includes(o.name))
        .map((o) => ({
          codeRef,
          operation: o.name,
          ...(o.instance ? { instance: o.instance } : {}),
          expectedDestination: group.destination.href,
          slots: Object.fromEntries(
            o.slots.map((s) => [
              s.slot,
              { ...fill(s), expectedFingerprint: s.fingerprint },
            ]),
          ),
        })),
    );
    return await request
      .post('/_key-bindings')
      .set('Authorization', await secureSessionAuth(dbAdapter, user))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-approval',
          attributes: { realm: realmURL.href, operations },
        },
      });
  }

  async function admission(operation: string, payer = OWNER, codeRef = INBOX) {
    return (
      await pipelineAdmission(dbAdapter, {
        core: realm.operationCore,
        realmURL,
        codeRef,
        operation,
        payer,
      })
    )?.error.code;
  }

  async function grantCount(owner = OWNER) {
    let [{ count }] = await dbAdapter.execute(
      `SELECT COUNT(*)::int AS count FROM user_key_grants WHERE owner = '${owner}'`,
    );
    return count as number;
  }

  test('a card with six GraphQL operations is one batch, one approval and one grant', async function (assert) {
    let key = await addKey();
    let found = await batchOf(OWNER, onType(INBOX));

    assert.strictEqual(found.realm.url, realmURL.href);
    assert.strictEqual(found.card.exportName, 'Inbox');
    assert.deepEqual(
      found.groups.map((g) => g.destination.href),
      [`${OTHER_HOST}/v1/`, `${VENDOR}/`],
      'grouped by destination',
    );
    let vendorGroup = found.groups[1]!;
    assert.strictEqual(vendorGroup.destination.host, '127.0.0.1:4525');
    assert.deepEqual(
      vendorGroup.operations.map((o) => o.name).sort(),
      [...GRAPHQL_OPERATIONS].sort(),
      "every GraphQL operation is in the batch; the share slot isn't the caller's to approve, a per-instance one waits for a card, and a keyless one sends nothing",
    );
    let listPRs = vendorGroup.operations.find((o) => o.name === 'listPRs')!;
    assert.strictEqual(listPRs.label, 'List PRs', 'the name split into words');
    assert.strictEqual(listPRs.method, 'POST');
    assert.strictEqual(listPRs.path, '/graphql');
    assert.strictEqual(listPRs.status, 'new');
    assert.deepEqual(
      listPRs.slots.map((s) => [s.slot, s.status, s.snapshot.placement]),
      [['userKey', 'new', 'header']],
    );
    assert.strictEqual(
      found.groups[0]!.operations[0]!.label,
      'Read from the other host',
      'a declared label leads',
    );
    assert.deepEqual(
      found.keys.map((k) => [k.name, k.covers]),
      [['vendor', []]],
      'the key the slot can take, with no grant covering the batch yet',
    );

    let approved = await approveFrom(OWNER, found, GRAPHQL_OPERATIONS, () => ({
      keyId: key.id,
    }));
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    assert.strictEqual(approved.body.data.length, 6, 'a binding per operation');
    assert.strictEqual(
      new Set(
        approved.body.data.map(
          (b: { meta: { grant: { id: string } } }) => b.meta.grant.id,
        ),
      ).size,
      1,
      'one grant serves all six',
    );
    assert.strictEqual(await grantCount(), 1);
    for (let name of GRAPHQL_OPERATIONS) {
      assert.strictEqual(await admission(name), undefined, `${name} is ready`);
    }

    let after = await batchOf(OWNER, onType(INBOX));
    assert.deepEqual(
      operationsIn(after).map((o) => o.name),
      ['elsewhere'],
      'only what is still unapproved is asked again',
    );
    assert.deepEqual(
      after.keys.map((k) => [k.name, k.covers]),
      [['vendor', []]],
      "the key's grant doesn't cover the other host",
    );
  });

  test('an operation left out of the confirmation stays unapproved', async function (assert) {
    let key = await addKey();
    let found = await batchOf(OWNER, onType(INBOX));
    let ticked = GRAPHQL_OPERATIONS.filter((n) => n !== 'listLabels');
    let approved = await approveFrom(OWNER, found, ticked, () => ({
      keyId: key.id,
    }));
    assert.strictEqual(approved.status, 201);

    assert.strictEqual(
      await admission('listLabels'),
      'binding-not-approved',
      'the unticked operation is refused',
    );
    assert.strictEqual(await admission('listPRs'), undefined);
    let after = await batchOf(OWNER, onType(INBOX));
    assert.deepEqual(
      operationsIn(after)
        .map((o) => [o.name, o.status])
        .sort(),
      [
        ['elsewhere', 'new'],
        ['listLabels', 'new'],
      ],
    );
    assert.deepEqual(
      after.keys.map((k) => k.covers),
      [[`${VENDOR}/`]],
      "the key's grant now covers the vendor's group",
    );
  });

  test('editing one operation puts only that one in the review batch, with what was approved', async function (assert) {
    let key = await addKey();
    let found = await batchOf(OWNER, onType(INBOX));
    await approveFrom(OWNER, found, GRAPHQL_OPERATIONS, () => ({
      keyId: key.id,
    }));

    await realm.write(
      'inbox.gts',
      inboxModule({
        listPRsDocument:
          'query { viewer { pullRequests { nodes { title } } } }',
      }),
    );
    await realm.indexing();

    let review = await batchOf(OWNER, onType(INBOX), { review: true });
    let operations = operationsIn(review);
    assert.deepEqual(
      operations.map((o) => [o.name, o.status]),
      [['listPRs', 'changed']],
      'only the edited operation is reviewed',
    );
    let [slot] = operations[0]!.slots;
    assert.strictEqual(slot!.status, 'changed');
    assert.true(
      slot!.approved!.snapshot.bodyTemplate!.includes('totalCount'),
      'the approved request is given to diff against',
    );
    assert.true(
      slot!.snapshot.bodyTemplate!.includes('nodes'),
      'beside the request now',
    );
    assert.strictEqual(
      slot!.approved!.snapshot.headersTemplate,
      slot!.snapshot.headersTemplate,
      'fields that did not change compare equal',
    );

    let reapproved = await approveFrom(OWNER, review, ['listPRs'], () => ({
      keyId: key.id,
    }));
    assert.strictEqual(reapproved.status, 201);
    assert.strictEqual(await admission('listPRs'), undefined);
    assert.deepEqual(
      operationsIn(await batchOf(OWNER, onType(INBOX), { review: true })),
      [],
      'nothing is left to review',
    );
  });

  test('a second card calling the same host reuses the grant and is a batch of its own', async function (assert) {
    let key = await addKey();
    await approveFrom(
      OWNER,
      await batchOf(OWNER, onType(INBOX)),
      GRAPHQL_OPERATIONS,
      () => ({ keyId: key.id }),
    );

    let digest = await batchOf(OWNER, onType(DIGEST));
    assert.strictEqual(digest.card.exportName, 'Digest');
    assert.deepEqual(
      operationsIn(digest).map((o) => o.name),
      ['summary'],
      "the batch is the card's own, never another card's",
    );
    assert.deepEqual(
      digest.keys.map((k) => [k.id, k.covers]),
      [[key.id, [`${VENDOR}/`]]],
      'the key is offered with the grant that already covers the host',
    );
    let approved = await approveFrom(
      OWNER,
      digest,
      ['summary'],
      () => ({ keyId: key.id }),
      DIGEST,
    );
    assert.strictEqual(approved.status, 201);
    assert.false(
      approved.body.data[0].meta.grant.created,
      'the grant is reused',
    );
    assert.strictEqual(await grantCount(), 1);
    assert.strictEqual(await admission('summary', OWNER, DIGEST), undefined);
  });

  test('removing the grant returns its operations to the batch', async function (assert) {
    let key = await addKey();
    let approved = await approveFrom(
      OWNER,
      await batchOf(OWNER, onType(INBOX)),
      GRAPHQL_OPERATIONS,
      () => ({ keyId: key.id }),
    );
    let grantId = approved.body.data[0].meta.grant.id;
    await removeGrant(dbAdapter, { owner: OWNER, grantId, via: 'window' });

    for (let name of GRAPHQL_OPERATIONS) {
      assert.strictEqual(await admission(name), 'binding-not-approved');
    }
    let after = await batchOf(OWNER, onType(INBOX));
    assert.strictEqual(
      operationsIn(after).filter((o) => GRAPHQL_OPERATIONS.includes(o.name))
        .length,
      6,
      'every operation that used the grant is asked again',
    );
  });

  test('a batch opened for a card takes in its per-instance operations, for that card', async function (assert) {
    let found = await batchOf(OWNER, {
      kind: 'instance',
      url: `${realmURL.href}general`,
    });
    let post = operationsIn(found).find((o) => o.name === 'post');
    assert.strictEqual(post?.instance, `${realmURL.href}general`);
  });

  test("a share slot is in the batch of the share key's owner", async function (assert) {
    let key = await addKey(WRITER, 'shared-vendor');
    await shareKey(dbAdapter, {
      owner: WRITER,
      keyId: key.id,
      realm: realmURL.href,
      label: 'vendor',
      ticket: await ticket(WRITER, 'share', { keyId: key.id, realm: realmURL }),
    });
    let found = await batchOf(WRITER, onType(INBOX));
    let shared = operationsIn(found).find((o) => o.name === 'shared');
    assert.deepEqual(
      shared?.slots.map((s) => [s.slot, s.key]),
      [['apiKey', 'apiKey']],
    );
    assert.deepEqual(
      found.shares.map((s) => s.label),
      ['vendor'],
    );
    let approved = await approveFrom(WRITER, found, ['shared'], () => ({
      shareId: found.shares[0]!.id,
    }));
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    assert.notOk(
      operationsIn(await batchOf(OWNER, onType(INBOX))).find(
        (o) => o.name === 'shared',
      ),
      "another user's batch never asks about the realm's share",
    );
  });

  test('the batch is asked with the secure window’s own session, about what the user can read', async function (assert) {
    let appSession = await request
      .post('/_key-bindings/batch')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: OWNER, sessionRoom: 'test-session' },
          realmSecretSeed,
        )}`,
      )
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-batch',
          attributes: { target: onType(INBOX) },
        },
      });
    assert.strictEqual(appSession.status, 403, 'not with the app’s session');

    let stranger = await batch('@stranger:localhost', onType(INBOX));
    assert.strictEqual(
      stranger.status,
      404,
      'a realm they cannot read is none',
    );

    let extra = await batch(OWNER, onType(INBOX), { destination: VENDOR });
    assert.strictEqual(extra.status, 400, 'a batch takes no destination');
  });

  test("a key is set up for a card from the key's own page: the workspaces the user reads and the cards there that send their key", async function (assert) {
    let auth = await secureSessionAuth(dbAdapter, OWNER);
    let realms = await request
      .get('/_secure-window/realms?access=read')
      .set('Authorization', auth)
      .set('Origin', secureOriginURL.origin);
    assert.strictEqual(realms.status, 200);
    assert.true(
      realms.body.data.some((r: { id: string }) => r.id === realmURL.href),
      'a realm the user reads by a permission of their own',
    );

    let cards = await request
      .post('/_secure-window/cards')
      .set('Authorization', auth)
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'secure-window-cards',
          attributes: { realm: realmURL.href },
        },
      });
    assert.strictEqual(cards.status, 200, JSON.stringify(cards.body));
    assert.deepEqual(
      cards.body.data
        .map((c: { attributes: { name: string } }) => c.attributes.name)
        .sort(),
      ['Digest', 'Inbox'],
      "the realm's cards' types that send the user's own key",
    );

    let stranger = await request
      .post('/_secure-window/cards')
      .set(
        'Authorization',
        await secureSessionAuth(dbAdapter, '@stranger:localhost'),
      )
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'secure-window-cards',
          attributes: { realm: realmURL.href },
        },
      });
    assert.strictEqual(
      stranger.status,
      404,
      'a realm they cannot read is none',
    );
  });
});
