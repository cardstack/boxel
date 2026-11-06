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
import { listOwnSharedRealms, shareKey } from '../lib/key-shares.ts';
import { addOAuthClient } from '../lib/oauth.ts';
import { pipelineAdmission } from '../lib/key-bindings.ts';
import { withinSlotLimit, type BatchGroup } from '../lib/key-binding-batch.ts';
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
const PR_INBOX = { module: rri(`${realmURL.href}pr-inbox`), name: 'PRInbox' };
const CHANNEL = { module: rri(`${realmURL.href}channel`), name: 'Channel' };
const GRAPHQL_OPERATIONS = [
  'listPRs',
  'listIssues',
  'listReviews',
  'listComments',
  'listLabels',
  'listMilestones',
];

function graphqlOperation(name: string, document: string, keyKind?: string) {
  return `
      @operation static ${name} = {
        base: 'callApi',
        method: 'POST',
        url: '${VENDOR}/graphql',
        headers: { authorization: 'Bearer {{userKey}}' },
        graphql: { document: '${document}' },${
          keyKind
            ? `
        keyKind: '${keyKind}',`
            : ''
        }
      };`;
}

function inboxModule({
  listPRsDocument = 'query { viewer { pullRequests { totalCount } } }',
  listPRsKeyKind,
}: { listPRsDocument?: string; listPRsKeyKind?: string } = {}) {
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
          name === 'listPRs' ? listPRsKeyKind : undefined,
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

// The PR Inbox exactly as the `api-integrations` card-author skill writes it,
// but for GitHub's address, which is the stub's here.
const prInboxModule = `import { CardDef, contains, field, linksToMany } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import {
  bxl,
  instance,
  operation,
  type OperationDeclaration,
} from '@cardstack/base/operations';

export class PullRequest extends CardDef {
  static displayName = 'Pull Request';
  @field title = contains(StringField);
  @field url = contains(StringField);
  @field updatedAt = contains(StringField);
}

const GITHUB = '${VENDOR}/graphql';
const AUTH = { authorization: 'Bearer {{userKey}}' };

export class PRInbox extends CardDef {
  static displayName = 'PR Inbox';
  @field login = contains(StringField);
  // Written by the pipeline, read by everyone who opens the inbox.
  @field pullRequests = linksToMany(PullRequest);

  @operation static listPRs = {
    base: 'callApi',
    label: 'List your open pull requests',
    url: GITHUB,
    headers: AUTH,
    graphql: {
      document:
        'query($login: String!) { user(login: $login) { pullRequests(states: OPEN, first: 50) { nodes { title url updatedAt } } } }',
      variables: { login: instance('login') },
    },
    output: bxl\`{status: .status, nodes: .body.data.user.pullRequests.nodes}\`,
  } satisfies OperationDeclaration;

  @operation static listReviewRequests = {
    base: 'callApi',
    label: 'List pull requests waiting for your review',
    url: GITHUB,
    headers: AUTH,
    graphql: {
      document:
        'query($q: String!) { search(type: ISSUE, query: $q, first: 50) { nodes { ... on PullRequest { title url updatedAt } } } }',
      variables: { q: 'is:pr is:open review-requested:@me' },
    },
    output: bxl\`{status: .status, nodes: .body.data.search.nodes}\`,
  } satisfies OperationDeclaration;
}
`;

// A card whose one keyed request is approved for each card on its own.
const channelModule = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";

  export class Channel extends CardDef {
    @field name = contains(StringField);

    @operation static post = {
      base: 'callApi',
      perInstance: true,
      url: '${VENDOR}/post',
      headers: { authorization: 'Bearer {{userKey}}' },
    };
  }
`;

function card(adoptsFrom: typeof INBOX): LooseSingleCardDocument {
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
      'pr-inbox.gts': prInboxModule,
      'channel.gts': channelModule,
      'general.json': card(INBOX),
      'weekly.json': card(DIGEST),
      'team-channel.json': card(CHANNEL),
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
    fillers: Record<'interactive' | 'pipelines', Record<string, string[]>>;
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
      [`${VENDOR}/`, `${OTHER_HOST}/v1/`],
      'grouped by destination',
    );
    let vendorGroup = found.groups[0]!;
    assert.strictEqual(vendorGroup.destination.host, '127.0.0.1:4525');
    assert.deepEqual(
      vendorGroup.operations.map((o) => o.name).sort(),
      [...GRAPHQL_OPERATIONS].sort(),
      "every GraphQL operation is in the batch; the share slot isn't the caller's to approve, and a keyless one sends nothing",
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
      found.groups[1]!.operations[0]!.label,
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

  test('a slot that declares its kind of key takes only a key of that kind, and one approved before asks to be approved again', async function (assert) {
    let key = await addKey();
    await approveFrom(
      OWNER,
      await batchOf(OWNER, onType(INBOX)),
      GRAPHQL_OPERATIONS,
      () => ({ keyId: key.id }),
    );
    assert.strictEqual(await admission('listPRs'), undefined);

    await realm.write(
      'inbox.gts',
      inboxModule({ listPRsKeyKind: 'google-service-account' }),
    );
    await realm.indexing();
    assert.strictEqual(
      await admission('listPRs'),
      'binding-needs-reapproval',
      'the pasted key no longer fills a slot that takes a service account',
    );
    assert.strictEqual(
      await admission('listIssues'),
      undefined,
      'a slot that declares no kind still takes it',
    );
    let review = await batchOf(OWNER, onType(INBOX), { review: true });
    let operations = operationsIn(review);
    assert.deepEqual(
      operations.map((o) => [o.name, o.status]),
      [['listPRs', 'changed']],
      'the slot is reviewed',
    );
    assert.notOk(
      review.fillers.interactive['userKey']!.includes(key.id),
      'and the pasted key is not offered for a slot that takes a service account',
    );

    let refused = await approveFrom(OWNER, review, ['listPRs'], () => ({
      keyId: key.id,
    }));
    assert.strictEqual(refused.status, 400, JSON.stringify(refused.body));
    assert.deepEqual(refused.body.errors, [
      'operation "listPRs" takes a Google service account in slot userKey, and this key is a key or token sent as it is',
    ]);

    await realm.write('inbox.gts', inboxModule({ listPRsKeyKind: 'static' }));
    await realm.indexing();
    let again = await batchOf(OWNER, onType(INBOX), { review: true });
    assert.deepEqual(
      operationsIn(again).map((o) => o.name),
      ['listPRs'],
      'a binding asked to be approved again stays so until it is',
    );
    assert.deepEqual(
      again.fillers.interactive['userKey'],
      [key.id],
      'and the pasted key is offered for it again',
    );
    let reapproved = await approveFrom(OWNER, again, ['listPRs'], () => ({
      keyId: key.id,
    }));
    assert.strictEqual(reapproved.status, 201, JSON.stringify(reapproved.body));
    assert.strictEqual(
      await admission('listPRs'),
      undefined,
      'a pasted key fills a slot that declares one',
    );
  });

  test('each slot names the keys that fill it in every operation sending it', async function (assert) {
    let pasted = await addKey(OWNER, 'pasted');
    let robot = await addOAuthClient(dbAdapter, keyring, {
      owner: OWNER,
      name: 'vendor robot',
      value: 'robot-secret',
      oauth: {
        clientId: 'robot',
        grantType: 'client_credentials',
        tokenUrl: `${VENDOR}/token`,
        apiHosts: [`${VENDOR}/`],
      },
      ticket: await ticket(OWNER, 'add'),
    });
    await addOAuthClient(dbAdapter, keyring, {
      owner: OWNER,
      name: 'hostless robot',
      value: 'hostless-secret',
      oauth: {
        clientId: 'hostless',
        grantType: 'client_credentials',
        tokenUrl: `${VENDOR}/token`,
      },
      ticket: await ticket(OWNER, 'add'),
    });
    let signIn = await addOAuthClient(dbAdapter, keyring, {
      owner: OWNER,
      name: 'other app',
      value: 'app-secret',
      oauth: {
        clientId: 'app',
        authorizeUrl: `${OTHER_HOST}/authorize`,
        tokenUrl: `${OTHER_HOST}/token`,
        apiHosts: [`${OTHER_HOST}/`],
      },
      ticket: await ticket(OWNER, 'add'),
    });
    // A connection made through the sign-in app, stored as signing in
    // stores one.
    let connection = '3f9a1c2e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
    await dbAdapter.execute(
      `INSERT INTO user_keys
         SELECT (jsonb_populate_record(k, jsonb_build_object('id', $1::text, 'name', 'other account', 'kind', 'oauth-connection'))).*
           FROM user_keys k WHERE k.id = $2`,
      { bind: [connection, robot.id] },
    );
    await dbAdapter.execute(
      `INSERT INTO oauth_connections (key_id, client_kind, client_key_id, token_kind, client_id, token_url)
         VALUES ($1, 'own', $2, 'refresh', 'app', $3)`,
      { bind: [connection, signIn.id, `${OTHER_HOST}/token`] },
    );

    let found = await batchOf(OWNER, onType(INBOX));
    let destinationOf = (operation: string) =>
      found.groups.find((g) => g.operations.some((o) => o.name === operation))!
        .destination.href;
    let vendor = destinationOf('listPRs');
    let other = destinationOf('elsewhere');
    // The names of the keys that fill the user's-key slot for `use`.
    let names = (batch: Batch, use: 'interactive' | 'pipelines') =>
      (batch.fillers[use]['userKey'] ?? [])
        .map((id) => batch.keys.find((k) => k.id === id)!.name)
        .sort();
    assert.deepEqual(
      names(found, 'interactive'),
      ['hostless robot', 'pasted'],
      `the user's-key slot is sent to ${vendor} and ${other}: a pasted key and a client that names no API hosts fill it at both, and neither an OAuth client nor a connection whose client reaches only one of them does`,
    );
    assert.notOk(
      found.keys.some((k) => k.name === 'other app'),
      'a client people only sign in through is never offered',
    );
    assert.deepEqual(
      found.fillers.pipelines,
      found.fillers.interactive,
      'with nothing approved for pipelines only, both uses offer the same keys',
    );

    // Approved for pipelines only, the call to the other host is left out of
    // what pipelines approve, so the slot is then sent only to the vendor.
    let approved = await approveFrom(OWNER, found, ['elsewhere'], () => ({
      keyId: pasted.id,
    }));
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    let both = await batchOf(OWNER, onType(INBOX), { interactive: true });
    assert.strictEqual(
      operationsIn(both).find((o) => o.name === 'elsewhere')!.status,
      'pipelines-only',
    );
    assert.deepEqual(
      names(both, 'interactive'),
      ['hostless robot', 'pasted'],
      'for interactive use every operation sending the slot counts',
    );
    assert.deepEqual(
      names(both, 'pipelines'),
      ['hostless robot', 'pasted', 'vendor robot'],
      "for pipelines only, an OAuth client fills it where its API hosts reach the vendor alone; a connection whose client reaches only the other host doesn't",
    );
  });

  test('a share of an OAuth client people only sign in through is not offered for a share slot', async function (assert) {
    let signIn = await addOAuthClient(dbAdapter, keyring, {
      owner: WRITER,
      name: 'vendor app',
      value: 'app-secret',
      oauth: {
        clientId: 'app',
        authorizeUrl: `${VENDOR}/authorize`,
        tokenUrl: `${VENDOR}/token`,
        apiHosts: [`${VENDOR}/`],
      },
      ticket: await ticket(WRITER, 'add'),
    });
    let robot = await addOAuthClient(dbAdapter, keyring, {
      owner: WRITER,
      name: 'other robot',
      value: 'robot-secret',
      oauth: {
        clientId: 'robot',
        grantType: 'client_credentials',
        tokenUrl: `${OTHER_HOST}/token`,
        apiHosts: [`${OTHER_HOST}/`],
      },
      ticket: await ticket(WRITER, 'add'),
    });
    for (let [key, label] of [
      [signIn, 'sign in here'],
      [robot, 'other robot'],
    ] as const) {
      await shareKey(dbAdapter, {
        owner: WRITER,
        keyId: key.id,
        realm: realmURL.href,
        label,
        ticket: await ticket(WRITER, 'share', {
          keyId: key.id,
          realm: realmURL,
        }),
      });
    }
    let found = await batchOf(WRITER, onType(INBOX));
    let destinationOf = (operation: string) =>
      found.groups.find((g) => g.operations.some((o) => o.name === operation))!
        .destination.href;
    assert.deepEqual(
      found.shares.map((s) => s.label),
      ['other robot'],
      "the sign-in app's share is left out",
    );
    assert.notOk(
      destinationOf('shared').startsWith(OTHER_HOST),
      'the share slot is sent to the vendor',
    );
    assert.deepEqual(
      found.fillers.interactive['apiKey'],
      [],
      "so the robot, whose tokens are good only at the other host, doesn't fill it",
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

  test('a batch opened for a card is the batch of the type the card adopts from', async function (assert) {
    let found = await batchOf(OWNER, {
      kind: 'instance',
      url: `${realmURL.href}general`,
    });
    assert.strictEqual(found.card.exportName, 'Inbox');
    assert.deepEqual(
      operationsIn(found)
        .map((o) => o.name)
        .sort(),
      [...GRAPHQL_OPERATIONS, 'elsewhere'].sort(),
    );
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
    let approvedCalls = async () =>
      (
        await listOwnSharedRealms(dbAdapter, WRITER, {
          keyId: key.id,
          matrixServerName: 'localhost',
        })
      )
        .get(key.id)
        ?.flatMap((realm) => realm.shares.map((s) => s.approvedCalls));
    let cardsForAShare = async () => {
      let response = await request
        .post('/_secure-window/cards')
        .set('Authorization', await secureSessionAuth(dbAdapter, WRITER))
        .set('Origin', secureOriginURL.origin)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'secure-window-cards',
            attributes: { realm: realmURL.href, slot: 'apiKey' },
          },
        });
      assert.strictEqual(response.status, 200, JSON.stringify(response.body));
      return response.body.data.map(
        (c: { attributes: { name: string } }) => c.attributes.name,
      );
    };
    assert.deepEqual(
      await approvedCalls(),
      [0],
      'a share no operation is approved for yet says so',
    );
    assert.deepEqual(
      await cardsForAShare(),
      ['Inbox'],
      "a card whose realm's-key slot no share fills is offered to a share",
    );
    let approved = await approveFrom(WRITER, found, ['shared'], () => ({
      shareId: found.shares[0]!.id,
    }));
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    assert.deepEqual(
      await approvedCalls(),
      [1],
      'the key listing counts the bindings that send the share',
    );
    assert.deepEqual(
      await cardsForAShare(),
      [],
      'once a share fills the slot, the card has nothing for another share',
    );
    assert.notOk(
      operationsIn(await batchOf(OWNER, onType(INBOX))).find(
        (o) => o.name === 'shared',
      ),
      "another user's batch never asks about the realm's share",
    );
  });

  test("the card-author skill's PR Inbox is one batch, approved once and admitted as a pipeline", async function (assert) {
    let key = await addKey();
    let found = await batchOf(OWNER, onType(PR_INBOX));
    assert.deepEqual(
      found.groups.map((g) => g.destination.href),
      [`${VENDOR}/`],
      'every request goes to one destination',
    );
    assert.deepEqual(
      operationsIn(found).map((o) => [o.name, o.label]),
      [
        ['listReviewRequests', 'List pull requests waiting for your review'],
        ['listPRs', 'List your open pull requests'],
      ],
    );
    let approved = await approveFrom(
      OWNER,
      found,
      ['listPRs', 'listReviewRequests'],
      () => ({ keyId: key.id }),
      PR_INBOX,
    );
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    for (let name of ['listPRs', 'listReviewRequests']) {
      assert.strictEqual(await admission(name, OWNER, PR_INBOX), undefined);
    }
  });

  test('an operation approved per instance is in the batch of a window opened for its card, for that card', async function (assert) {
    let forCard = await batchOf(OWNER, {
      kind: 'instance',
      url: `${realmURL.href}team-channel`,
    });
    assert.deepEqual(
      operationsIn(forCard).map((o) => [o.name, o.instance]),
      [['post', `${realmURL.href}team-channel`]],
    );
    let forType = await batchOf(OWNER, onType(CHANNEL));
    assert.deepEqual(
      operationsIn(forType),
      [],
      'a window opened for the type has no card to approve it for',
    );
  });

  test('a batch holds what one confirmation can approve, and says how many operations remain', function (assert) {
    let operation = (name: string, slots: number) => ({
      name,
      label: name,
      method: 'GET',
      path: '/',
      instance: null,
      status: 'new' as const,
      slots: Array.from({ length: slots }, (_, i) => ({
        slot: `apiKey:s${i}`,
        key: 'apiKey' as const,
        status: 'new' as const,
        snapshot:
          {} as BatchGroup['operations'][number]['slots'][number]['snapshot'],
        fingerprint: `${name}-${i}`,
      })),
      openToAnonymous: false,
    });
    let destination = (host: string) => ({
      href: `https://${host}/`,
      host,
      path: '/',
      registrableDomain: host,
    });
    let groups: BatchGroup[] = [
      {
        destination: destination('a.example'),
        operations: [operation('one', 2), operation('two', 2)],
      },
      {
        destination: destination('b.example'),
        operations: [operation('three', 2), operation('four', 1)],
      },
    ];
    let { kept, remaining } = withinSlotLimit(groups, 5);
    assert.deepEqual(
      kept.map((g) => g.operations.map((o) => o.name)),
      [['one', 'two']],
      'operations are kept whole, in order, until the next would pass the limit',
    );
    assert.strictEqual(
      remaining,
      2,
      'the rest are counted for the next confirmation',
    );
    assert.deepEqual(withinSlotLimit(groups, 100).remaining, 0);

    let pipelinesOnly = (name: string, slots: number) => ({
      ...operation(name, slots),
      status: 'pipelines-only' as const,
    });
    let mixed: BatchGroup[] = [
      {
        destination: destination('a.example'),
        operations: [pipelinesOnly('approved', 4), operation('pending', 2)],
      },
      {
        destination: destination('b.example'),
        operations: [pipelinesOnly('alsoApproved', 1)],
      },
    ];
    let capped = withinSlotLimit(mixed, 5);
    assert.deepEqual(
      capped.kept.map((g) => g.operations.map((o) => o.name)),
      [['pending']],
      'the one that needs approving comes first; ones approved for pipelines only fill what is left, in order',
    );
    assert.strictEqual(capped.remaining, 0);
    assert.strictEqual(capped.remainingPipelinesOnly, 2);
    assert.deepEqual(
      withinSlotLimit(mixed, 7).kept.map((g) =>
        g.operations.map((o) => o.name),
      ),
      [['approved', 'pending'], ['alsoApproved']],
      'with room for all, they keep the order the window shows',
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

    let sendingRealmKey = await request
      .post('/_secure-window/cards')
      .set('Authorization', auth)
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'secure-window-cards',
          attributes: { realm: realmURL.href, slot: 'apiKey' },
        },
      });
    assert.strictEqual(
      sendingRealmKey.status,
      200,
      JSON.stringify(sendingRealmKey.body),
    );
    assert.deepEqual(
      sendingRealmKey.body.data.map(
        (c: { attributes: { name: string } }) => c.attributes.name,
      ),
      ['Inbox'],
      "with the `apiKey` slot, the types that send the realm's key, which a share there is approved for",
    );

    let unknownSlot = await request
      .post('/_secure-window/cards')
      .set('Authorization', auth)
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'secure-window-cards',
          attributes: { realm: realmURL.href, slot: 'botKey' },
        },
      });
    assert.strictEqual(unknownSlot.status, 400, 'a slot no request sends');

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

  test('a realm key slot a share already fills for one operation still needs the key to fit that operation', async function (assert) {
    const RELAY = { module: rri(`${realmURL.href}relay`), name: 'Relay' };
    await realm.write(
      'relay.gts',
      `
        import { contains, field, CardDef } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";
        import { operation } from "@cardstack/base/operations";

        export class Relay extends CardDef {
          @field name = contains(StringField);

          @operation static publish = {
            base: 'callApi',
            url: '${VENDOR}/publish',
            headers: { authorization: 'Bearer {{apiKey}}' },
          };

          @operation static forward = {
            base: 'callApi',
            url: '${OTHER_HOST}/forward',
            headers: { authorization: 'Bearer {{apiKey}}' },
          };
        }
      `,
    );
    await realm.write('relay.json', JSON.stringify(card(RELAY)));
    await realm.indexing();

    let pasted = await addKey(OWNER, 'pasted');
    let otherRobot = await addOAuthClient(dbAdapter, keyring, {
      owner: OWNER,
      name: 'other robot',
      value: 'other-secret',
      oauth: {
        clientId: 'other',
        grantType: 'client_credentials',
        tokenUrl: `${OTHER_HOST}/token`,
        apiHosts: [`${OTHER_HOST}/`],
      },
      ticket: await ticket(OWNER, 'add'),
    });
    let share = await shareKey(dbAdapter, {
      owner: OWNER,
      keyId: pasted.id,
      realm: realmURL.href,
      label: 'pasted',
      ticket: await ticket(OWNER, 'share', {
        keyId: pasted.id,
        realm: realmURL,
      }),
    });
    let cardsFor = async (key: string) => {
      let response = await request
        .post('/_secure-window/cards')
        .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
        .set('Origin', secureOriginURL.origin)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'secure-window-cards',
            attributes: { realm: realmURL.href, slot: 'apiKey', key },
          },
        });
      assert.strictEqual(response.status, 200, JSON.stringify(response.body));
      return response.body.data
        .map((c: { attributes: { name: string } }) => c.attributes.name)
        .sort();
    };

    assert.deepEqual(
      await cardsFor(otherRobot.id),
      [],
      "the Relay's realm's-key slot is sent to the vendor too, where the robot's tokens aren't good",
    );

    let found = await batchOf(OWNER, onType(RELAY));
    let approved = await approveFrom(
      OWNER,
      found,
      ['publish'],
      () => ({ shareId: share.id }),
      RELAY,
    );
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    assert.deepEqual(
      await cardsFor(otherRobot.id),
      [],
      'a share filling the slot for the vendor request leaves the slot open for the other, but the approve page can show both, so the robot still has to serve the vendor',
    );
    assert.deepEqual(
      await cardsFor(pasted.id),
      ['Inbox', 'Relay'],
      'a key that serves both hosts is offered the card whose slot is still open',
    );
  });

  test("a key's page lists only the cards that key can fill", async function (assert) {
    let auth = await secureSessionAuth(dbAdapter, OWNER);
    let cardsFor = async (key: string, slot?: string) =>
      await request
        .post('/_secure-window/cards')
        .set('Authorization', auth)
        .set('Origin', secureOriginURL.origin)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'secure-window-cards',
            attributes: {
              realm: realmURL.href,
              key,
              ...(slot ? { slot } : {}),
            },
          },
        });
    let namesFor = async (key: string, slot?: string) => {
      let response = await cardsFor(key, slot);
      assert.strictEqual(response.status, 200, JSON.stringify(response.body));
      return response.body.data
        .map((c: { attributes: { name: string } }) => c.attributes.name)
        .sort();
    };

    let pasted = await addKey(OWNER, 'pasted');
    let vendorRobot = await addOAuthClient(dbAdapter, keyring, {
      owner: OWNER,
      name: 'vendor robot',
      value: 'robot-secret',
      oauth: {
        clientId: 'robot',
        grantType: 'client_credentials',
        tokenUrl: `${VENDOR}/token`,
        apiHosts: [`${VENDOR}/`],
      },
      ticket: await ticket(OWNER, 'add'),
    });
    let hostless = await addOAuthClient(dbAdapter, keyring, {
      owner: OWNER,
      name: 'hostless robot',
      value: 'hostless-secret',
      oauth: {
        clientId: 'hostless',
        grantType: 'client_credentials',
        tokenUrl: `${VENDOR}/token`,
      },
      ticket: await ticket(OWNER, 'add'),
    });
    let signIn = await addOAuthClient(dbAdapter, keyring, {
      owner: OWNER,
      name: 'vendor app',
      value: 'app-secret',
      oauth: {
        clientId: 'app',
        authorizeUrl: `${VENDOR}/authorize`,
        tokenUrl: `${VENDOR}/token`,
        apiHosts: [`${VENDOR}/`],
      },
      ticket: await ticket(OWNER, 'add'),
    });
    // A connection made through the sign-in app and a service account,
    // stored as signing in and adding a key file store them.
    let connection = '3f9a1c2e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
    let serviceAccount = '7d2e4f6a-8b0c-4d1e-9f2a-3b4c5d6e7f80';
    for (let [id, name, kind] of [
      [connection, 'vendor account', 'oauth-connection'],
      [serviceAccount, 'service account', 'google-service-account'],
    ]) {
      await dbAdapter.execute(
        `INSERT INTO user_keys
           SELECT (jsonb_populate_record(k, jsonb_build_object('id', $1::text, 'name', $2::text, 'kind', $3::text))).*
             FROM user_keys k WHERE k.id = $4`,
        { bind: [id, name, kind, pasted.id] },
      );
    }
    await dbAdapter.execute(
      `INSERT INTO oauth_connections (key_id, client_kind, client_key_id, token_kind, client_id, token_url)
         VALUES ($1, 'own', $2, 'refresh', 'app', $3)`,
      { bind: [connection, signIn.id, `${VENDOR}/token`] },
    );

    assert.deepEqual(
      await namesFor(pasted.id),
      ['Digest', 'Inbox'],
      'a pasted key fills every slot that sends the user’s key',
    );
    assert.deepEqual(
      await namesFor(hostless.id),
      ['Digest', 'Inbox'],
      'so does a client that names no API hosts',
    );
    assert.deepEqual(
      await namesFor(vendorRobot.id),
      ['Digest'],
      "an OAuth client's tokens fill a slot only when every request sending it goes to its API hosts: the Inbox sends the same slot to another host too",
    );
    assert.deepEqual(
      await namesFor(connection),
      ['Digest'],
      "a connection's tokens are held to its client's API hosts",
    );
    assert.deepEqual(
      await namesFor(serviceAccount),
      [],
      "a service account fills no slot outside Google's services",
    );
    assert.deepEqual(
      await namesFor(signIn.id),
      [],
      'a client people only sign in through is never sent',
    );
    // The list agrees with the approve page: a card is listed for a key
    // exactly when the card's batch names that key as filling one of its
    // slots, the keys the page offers for interactive use.
    let offeredIn = async (type: typeof INBOX) => {
      let found = await batchOf(OWNER, onType(type));
      return new Set(Object.values(found.fillers.interactive).flat());
    };
    let offered = {
      Inbox: await offeredIn(INBOX),
      Digest: await offeredIn(DIGEST),
    };
    for (let key of [
      pasted.id,
      hostless.id,
      vendorRobot.id,
      connection,
      serviceAccount,
      signIn.id,
    ]) {
      assert.deepEqual(
        await namesFor(key),
        (['Digest', 'Inbox'] as const).filter((name) => offered[name].has(key)),
        `the list for ${key} is the cards whose approve page offers it`,
      );
    }

    assert.deepEqual(
      await namesFor(pasted.id, 'apiKey'),
      ['Inbox'],
      "with the `apiKey` slot, the cards whose realm's-key slot the shared key fills",
    );
    let otherRobot = await addOAuthClient(dbAdapter, keyring, {
      owner: OWNER,
      name: 'other robot',
      value: 'other-secret',
      oauth: {
        clientId: 'other',
        grantType: 'client_credentials',
        tokenUrl: `${OTHER_HOST}/token`,
        apiHosts: [`${OTHER_HOST}/`],
      },
      ticket: await ticket(OWNER, 'add'),
    });
    assert.deepEqual(
      await namesFor(otherRobot.id, 'apiKey'),
      [],
      "a shared key whose credential isn't good where the realm's key is sent fills none",
    );

    let theirs = await addKey(WRITER, 'theirs');
    for (let [key, what] of [
      [theirs.id, "another user's key"],
      ['not-a-key', 'a malformed id'],
      ['9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b', 'a key that does not exist'],
    ]) {
      let response = await cardsFor(key!);
      assert.strictEqual(response.status, 404, `${what} is no key`);
    }
    let wrongType = await request
      .post('/_secure-window/cards')
      .set('Authorization', auth)
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'secure-window-cards',
          attributes: { realm: realmURL.href, key: 7 },
        },
      });
    assert.strictEqual(wrongType.status, 400, 'a key is named by its id');
  });
});
