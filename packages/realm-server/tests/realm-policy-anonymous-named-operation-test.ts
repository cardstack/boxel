import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  LocalPath,
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import {
  setAnonymousRequestSink,
  type AnonymousRequestEvent,
} from '@cardstack/runtime-common/card-operations/telemetry';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  clearOfRateLimitWindowEdge,
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// A civic realm nobody may read or write without signing in, governed by a
// policy card in an Org realm. Its policy opens two operations its types
// declare to callers who aren't signed in: signing an open petition, and
// registering for updates. Both are made as the submitter the realm's own
// `realm.json` names. Closing a petition is opened to signed-in callers only,
// and `claim`, which reads the caller, is opened to everyone but admits only
// signed-in callers. A notice declares `sign` too and no grant names it, and a
// ballot's only grant is made as a key the realm's config doesn't hold.
const CIVIC = 'http://127.0.0.1:4444/civic/';
// A board anyone may read, whose policy opens only a declared write, `sign` of
// an open petition, to callers who aren't signed in.
const BOARD = 'http://127.0.0.1:4444/board/';
// A commons anyone may read and write, so the ACL, not its policy, admits a
// caller who isn't signed in to every operation its types declare.
const COMMONS = 'http://127.0.0.1:4444/commons/';
const ORG = 'http://127.0.0.1:4444/org/';
const CIVIC_POLICY = `${ORG}policies/civic`;
const BOARD_POLICY = `${ORG}policies/board`;
const COMMONS_POLICY = `${ORG}policies/commons`;
const EDITOR = '@editor:localhost';
const SUBMITTER = '@submitter:localhost';
const ORG_ADMIN = '@org-admin:localhost';

// Callers' addresses come from the ranges reserved for documentation.
const VISITOR = '192.0.2.10';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const CIVIC_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params, actor } from "@cardstack/base/operations";
  export class Petition extends CardDef {
    @field title = contains(StringField);
    @field status = contains(StringField);
    @field signature = contains(StringField);

    @operation static sign = {
      base: 'transform',
      params: { name: StringField },
      set: { signature: params('name') },
    };
    @operation static close = {
      base: 'transform',
      set: { status: 'closed' },
    };
    @operation static claim = {
      base: 'transform',
      set: { signature: actor() },
    };
  }
  // Redeclares \`sign\` to read the caller, so a grant on Petition that opens
  // \`sign\` admits no caller who isn't signed in to one of these.
  export class LocalPetition extends Petition {
    @operation static sign = {
      base: 'transform',
      set: { signature: actor() },
    };
  }
  export class Notice extends CardDef {
    @field title = contains(StringField);
    @field status = contains(StringField);
    @field signature = contains(StringField);

    @operation static sign = {
      base: 'transform',
      params: { name: StringField },
      set: { signature: params('name') },
    };
  }
  export class Ballot extends Notice {}
  export class Signup extends CardDef {
    @field email = contains(StringField);
    @field source = contains(StringField);

    @operation static register = {
      base: 'create',
      of: () => Signup,
      params: { email: StringField },
      fill: { email: params('email'), source: 'form' },
    };
  }
`;

function type(realm: string, name: string) {
  return { module: `${realm}civic`, name };
}

const PETITION = type(CIVIC, 'Petition');
const SIGNUP = type(CIVIC, 'Signup');

const OPEN = `${CIVIC}petitions/open`;
const LOCAL = `${CIVIC}petitions/local`;
const CLOSED = `${CIVIC}petitions/closed`;
const NOTICE = `${CIVIC}notices/open`;
const BALLOT = `${CIVIC}ballots/open`;
const MISSING = `${CIVIC}petitions/nowhere`;
const BOARD_PETITION = `${BOARD}petitions/open`;
const BOARD_CLOSED = `${BOARD}petitions/closed`;
const COMMONS_PETITION = `${COMMONS}petitions/open`;

function petition(title: string, status: string, name = 'Petition') {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title, status },
      meta: { adoptsFrom: { module: '../civic', name } },
    },
  });
}

function rule(
  targetType: { module: string; name: string },
  grants: Record<string, unknown>[],
) {
  return { targetType, grants };
}

function policyCard(rules: unknown[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

// What a grant's `where` says to open it to callers who aren't signed in.
const ANONYMOUS = 'actor() == "anonymous"';
// The user a write by such a caller is made as, and the limit it counts
// against, both read from the governed realm's own config.
const SUBMITTER_WRITES = {
  actingUser: 'realmConfig("submitter")',
  rateLimitRequests: 'realmConfig("requests")',
  rateLimitWindowSeconds: 'realmConfig("windowSeconds")',
};

const POLICY = policyCard([
  rule(PETITION, [
    {
      operation: 'sign',
      where: `${ANONYMOUS} and .status == "open"`,
      ...SUBMITTER_WRITES,
    },
    { operation: 'close' },
    { operation: 'claim', where: ANONYMOUS, ...SUBMITTER_WRITES },
  ]),
  rule(SIGNUP, [
    { operation: 'register', where: ANONYMOUS, ...SUBMITTER_WRITES },
  ]),
  rule(type(CIVIC, 'Ballot'), [
    {
      operation: 'sign',
      where: ANONYMOUS,
      actingUser: 'realmConfig("missing")',
    },
  ]),
]);

module(basename(import.meta.filename), function (hooks) {
  let civic: Realm;
  let board: Realm;
  let commons: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let records: AnonymousRequestEvent[];

  setupCatalogTestSubset(hooks);

  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      clientAddress: { trustedProxyHops: 1, infraAddresses: [] },
      realms: [
        {
          realmURL: new URL(CIVIC),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Civic',
              policy: CIVIC_POLICY,
              config: { submitter: SUBMITTER },
            }),
            'civic.gts': CIVIC_MODULE,
            'petitions/open.json': petition('Fix the park', 'open'),
            'petitions/closed.json': petition('Move the library', 'closed'),
            'petitions/local.json': petition(
              'Light the square',
              'open',
              'LocalPetition',
            ),
            'notices/open.json': petition('Quiet hours', 'open', 'Notice'),
            'ballots/open.json': petition('Name the park', 'open', 'Ballot'),
          },
          permissions: {
            [EDITOR]: ['read', 'write', 'realm-owner'],
            [SUBMITTER]: ['read', 'write'],
            [ORG_ADMIN]: ['read'],
          },
        },
        {
          realmURL: new URL(BOARD),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Board',
              policy: BOARD_POLICY,
              config: { submitter: SUBMITTER },
            }),
            'civic.gts': CIVIC_MODULE,
            'petitions/open.json': petition('Paint the fence', 'open'),
            'petitions/closed.json': petition('Fix the gate', 'closed'),
          },
          permissions: {
            '*': ['read'],
            [EDITOR]: ['read', 'write', 'realm-owner'],
            [SUBMITTER]: ['read', 'write'],
          },
        },
        {
          realmURL: new URL(COMMONS),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Commons',
              policy: COMMONS_POLICY,
            }),
            'civic.gts': CIVIC_MODULE,
            'petitions/open.json': petition('Plant the verge', 'open'),
          },
          permissions: {
            '*': ['read', 'write'],
            [EDITOR]: ['read', 'write', 'realm-owner'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/civic.json': POLICY,
            'policies/board.json': policyCard([
              rule(type(BOARD, 'Petition'), [
                {
                  operation: 'sign',
                  where: `${ANONYMOUS} and .status == "open"`,
                  actingUser: 'realmConfig("submitter")',
                },
              ]),
            ]),
            'policies/commons.json': policyCard([
              rule(type(COMMONS, 'Petition'), [{ operation: 'close' }]),
            ]),
          },
          permissions: { [ORG_ADMIN]: ['read', 'write', 'realm-owner'] },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    civic = result.realms.find((realm) => realm.url === CIVIC)!;
    board = result.realms.find((realm) => realm.url === BOARD)!;
    commons = result.realms.find((realm) => realm.url === COMMONS)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  async function stop() {
    for (let realm of [civic, board, commons, org]) {
      realm.__testOnlyClearCaches();
      realm.unsubscribe();
    }
    await closeServer(server);
    resetCatalogRealms();
  }

  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key: import.meta.filename,
    build: async (args) => {
      await start(args);
      return stop;
    },
  });

  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
      records = [];
      setAnonymousRequestSink((record) => records.push(record));
    },
    afterEach: async () => {
      setAnonymousRequestSink(undefined);
      await stop();
    },
  });

  function invoke(
    name: string,
    rest: { href?: string; data?: unknown } = {},
  ): Record<string, unknown> {
    return { op: 'invoke', 'boxel:name': name, ...rest };
  }

  function operations(
    realm: string,
    entries: Record<string, unknown>[],
    authorization?: string,
  ) {
    let req = request
      .post(`${new URL(realm).pathname}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('X-Forwarded-For', VISITOR);
    if (authorization) {
      req = req.set('Authorization', authorization);
    }
    return req.send(JSON.stringify({ 'boxel:operations': entries }));
  }

  function sign(url: string, name: string) {
    return operations(CIVIC, [invoke('sign', { href: url, data: { name } })]);
  }

  function register(email: string) {
    return operations(CIVIC, [
      invoke('register', {
        data: {
          email,
          meta: {
            adoptsFrom: { module: rri(`${CIVIC}civic`), name: 'Signup' },
          },
        },
      }),
    ]);
  }

  async function stored(realm: Realm, url: string) {
    let content = await realm.operationCore.readFileAsText(
      `${new URL(url).pathname.slice(new URL(realm.url).pathname.length)}.json` as LocalPath,
    );
    return content === undefined
      ? undefined
      : (
          JSON.parse(content) as {
            data: { attributes: Record<string, unknown> };
          }
        ).data.attributes;
  }

  // Sets what the civic realm's grants read from its config, over the
  // fixture's.
  async function setCivic(config: Record<string, unknown>) {
    await civic.write(
      'realm.json',
      realmConfigCardJSON({
        name: 'Civic',
        policy: CIVIC_POLICY,
        config: { submitter: SUBMITTER, ...config },
      }),
    );
    await civic.indexing();
    await clearOfRateLimitWindowEdge({
      windowSeconds: config.windowSeconds,
    });
  }

  function unauthenticated(response: Response, label: string, assert: Assert) {
    assert.strictEqual(response.status, 401, `${label}: 401 ${response.text}`);
    assert.strictEqual(
      response.body?.errors?.[0]?.code,
      'actor-required',
      `${label}: told to authenticate`,
    );
  }

  function editor() {
    return `Bearer ${createJWT(civic, EDITOR, ['read', 'write', 'realm-owner'])}`;
  }

  async function explain(
    target: string,
    operation: string,
    policy = CIVIC_POLICY,
  ) {
    let response = await request
      .post(`${new URL(ORG).pathname}_operations`)
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set(
        'Authorization',
        `Bearer ${createJWT(org, ORG_ADMIN, ['read', 'write', 'realm-owner'])}`,
      )
      .send(
        JSON.stringify({
          'boxel:operations': [
            invoke('explain', {
              href: policy,
              data: { actor: '', target, operation },
            }),
          ],
        }),
      );
    if (response.status !== 200) {
      throw new Error(`explain answered ${response.status}: ${response.text}`);
    }
    return response.body['atomic:results'][0];
  }

  test('a caller who is not signed in signs an open petition through the operation its type declares, made as the user the realm names', async function (assert) {
    let response = await sign(OPEN, 'Ada');
    assert.strictEqual(response.status, 200, response.text);
    assert.deepEqual(
      await stored(civic, OPEN),
      { title: 'Fix the park', status: 'open', signature: 'Ada' },
      'the operation set only what it declares',
    );
    let [record] = records.filter((r) => r.outcome === 'admitted');
    assert.deepEqual(record?.actingUsers, [SUBMITTER], 'made as the submitter');
    assert.strictEqual(record?.clientIP, VISITOR);
  });

  test('a declared write is admitted only where its grant holds, and every refusal is the same 401', async function (assert) {
    let closed = await sign(CLOSED, 'Ada');
    let missing = await sign(MISSING, 'Ada');
    unauthenticated(closed, 'a closed petition', assert);
    unauthenticated(missing, 'a missing petition', assert);
    assert.strictEqual(
      closed.text,
      missing.text,
      'a closed petition and a missing one are refused alike',
    );
    assert.notOk(
      (await stored(civic, CLOSED))?.signature,
      'the closed petition is unsigned',
    );
  });

  test('a grant on a declared write opens nothing else, and an operation opened only to signed-in callers stays closed', async function (assert) {
    unauthenticated(
      await operations(CIVIC, [invoke('close', { href: OPEN })]),
      'an operation no grant opens to such callers',
      assert,
    );
    unauthenticated(
      await operations(CIVIC, [
        invoke('update', {
          href: OPEN,
          data: {
            type: 'card',
            attributes: { signature: 'Mallory' },
            meta: {
              adoptsFrom: { module: rri(`${CIVIC}civic`), name: 'Petition' },
            },
          },
        }),
      ]),
      'the base operation the declared one is built on',
      assert,
    );
    assert.deepEqual(
      await stored(civic, OPEN),
      { title: 'Fix the park', status: 'open' },
      'nothing was written',
    );
    let closedBy = await operations(
      CIVIC,
      [invoke('close', { href: OPEN })],
      editor(),
    );
    assert.strictEqual(closedBy.status, 200, closedBy.text);
    assert.strictEqual(
      (await stored(civic, OPEN))?.status,
      'closed',
      'a signed-in caller the policy admits still closes it',
    );
  });

  test('a declared create gets an id the realm mints, filled as its template says', async function (assert) {
    let response = await register('ada@example.com');
    assert.strictEqual(response.status, 200, response.text);
    let id = (
      response.body as { 'atomic:results': { data: { id: string } }[] }
    )['atomic:results'][0].data.id;
    assert.true(id.startsWith(CIVIC), `minted in the realm: ${id}`);
    assert.deepEqual(
      await stored(civic, id),
      { email: 'ada@example.com', source: 'form' },
      'the card holds what the template fills',
    );
    let [record] = records.filter((r) => r.outcome === 'admitted');
    assert.deepEqual(record?.actingUsers, [SUBMITTER], 'made as the submitter');
  });

  test('a declared operation that reads the caller is warned about, and admits no caller who is not signed in', async function (assert) {
    let policy = await civic.getCompiledPolicy();
    assert.deepEqual(
      policy?.issues.map(({ code, path, severity }) => ({
        code,
        path,
        severity,
      })),
      [
        {
          code: 'anonymous-grant-reads-actor',
          path: 'rules[0].grants[2].operation',
          severity: 'warning',
        },
      ],
    );
    assert.deepEqual(
      policy?.anonymous,
      { operations: ['register', 'sign'], writes: ['register', 'sign'] },
      'claim is left out of what it opens to such callers',
    );
    unauthenticated(
      await operations(CIVIC, [invoke('claim', { href: OPEN })]),
      'claim',
      assert,
    );
    assert.notOk((await stored(civic, OPEN))?.signature, 'nothing was written');
  });

  test('a subtype that redeclares an opened operation to read the caller admits no caller who is not signed in, and capability checks and explain say so', async function (assert) {
    let capabilities = await request
      .post(`${new URL(CIVIC).pathname}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON)
      .set('X-Forwarded-For', VISITOR)
      .send({
        checks: [
          { target: OPEN, operation: 'sign' },
          { target: LOCAL, operation: 'sign' },
        ],
      });
    assert.strictEqual(capabilities.status, 200, capabilities.text);
    assert.deepEqual(
      (capabilities.body.checks as { allowed: boolean }[]).map(
        (check) => check.allowed,
      ),
      [true, false],
      "the parent's petition may be signed, and the subtype's may not",
    );
    let explained = await explain(LOCAL, 'sign');
    assert.strictEqual(explained.decision, 'denied', 'explain agrees');
    assert.strictEqual(
      explained.reason,
      'reads-actor',
      'and says why, rather than that no grant names the operation',
    );
    unauthenticated(await sign(LOCAL, 'Ada'), 'the subtype', assert);
    assert.notOk(
      (await stored(civic, LOCAL))?.signature,
      'nothing was written',
    );
  });

  test('a declared write is counted one unit, and one over the limit gets 429 and writes nothing', async function (assert) {
    await setCivic({ requests: 1, windowSeconds: 600 });
    assert.strictEqual((await sign(OPEN, 'Ada')).status, 200);
    let over = await sign(OPEN, 'Grace');
    assert.strictEqual(over.status, 429, over.text);
    assert.strictEqual(over.body?.errors?.[0]?.code, 'rate-limited');
    assert.ok(over.headers['retry-after'], 'says when to retry');
    assert.strictEqual(
      (await stored(civic, OPEN))?.signature,
      'Ada',
      'the second signature was not written',
    );
  });

  test('a capability check answers such a caller about declared operations as the gate would', async function (assert) {
    let response = await request
      .post(`${new URL(CIVIC).pathname}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON)
      .set('X-Forwarded-For', VISITOR)
      .send({
        checks: [
          { target: OPEN, operation: 'sign' },
          { target: CLOSED, operation: 'sign' },
          { target: OPEN, operation: 'close' },
          { target: OPEN, operation: 'claim' },
          { target: SIGNUP, operation: 'register' },
        ],
      });
    assert.strictEqual(response.status, 200, response.text);
    assert.deepEqual(
      (response.body.checks as { allowed: boolean }[]).map(
        (check) => check.allowed,
      ),
      [true, false, false, false, true],
    );
  });

  test('a realm anyone may read answers a capability check about a declared write it opens to such callers', async function (assert) {
    let response = await request
      .post(`${new URL(BOARD).pathname}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON)
      .set('X-Forwarded-For', VISITOR)
      .send({
        checks: [
          { target: BOARD_PETITION, operation: 'sign' },
          { target: BOARD_PETITION, operation: 'update' },
        ],
      });
    assert.strictEqual(response.status, 200, response.text);
    assert.deepEqual(
      (response.body.checks as { allowed: boolean }[]).map(
        (check) => check.allowed,
      ),
      [true, false],
      'the signature form may be shown, and editing may not',
    );
    let signed = await operations(BOARD, [
      invoke('sign', { href: BOARD_PETITION, data: { name: 'Ada' } }),
    ]);
    assert.strictEqual(signed.status, 200, signed.text);
    assert.strictEqual(
      (await stored(board, BOARD_PETITION))?.signature,
      'Ada',
      'and the petition is signed',
    );
  });

  test('a realm anyone may read answers a capability check about a write it declines such a caller as that write is answered', async function (assert) {
    // The realm declines such a caller's write outright, without asking
    // whether they could read, so a refused write is told without a reason,
    // as it is to a caller who may not read the realm. Their reads keep the
    // ACL's answer.
    let response = await request
      .post(`${new URL(BOARD).pathname}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON)
      .set('X-Forwarded-For', VISITOR)
      .send({
        checks: [
          { target: BOARD_CLOSED, operation: 'sign' },
          { target: BOARD_PETITION, operation: 'close' },
          { target: BOARD_PETITION, operation: 'read' },
        ],
      });
    assert.strictEqual(response.status, 200, response.text);
    assert.deepEqual(
      (
        response.body.checks as {
          allowed: boolean;
          reason?: string;
          conditional?: boolean;
        }[]
      ).map(({ allowed, reason, conditional }) => ({
        allowed,
        reason,
        conditional,
      })),
      [
        { allowed: false, reason: undefined, conditional: undefined },
        { allowed: false, reason: undefined, conditional: undefined },
        { allowed: true, reason: undefined, conditional: undefined },
      ],
      'each refused write is a bare refusal, and the read is allowed',
    );
    for (let [label, name, href] of [
      ['a write its grant refuses', 'sign', BOARD_CLOSED],
      ['a write no grant opens', 'close', BOARD_PETITION],
    ]) {
      unauthenticated(
        await operations(BOARD, [
          invoke(name, { href, data: name === 'sign' ? { name: 'Ada' } : {} }),
        ]),
        label,
        assert,
      );
    }
  });

  test('a realm anyone may write refuses such a caller an operation that reads the caller, and explain and a capability check say so', async function (assert) {
    let explained = await explain(COMMONS_PETITION, 'claim', COMMONS_POLICY);
    assert.strictEqual(explained.decision, 'denied');
    assert.strictEqual(explained.reason, 'reads-actor');
    assert.deepEqual(
      explained.refusal,
      { status: 401, code: 'actor-required' },
      'explain reports the 401 the realm sends',
    );
    unauthenticated(
      await operations(COMMONS, [invoke('claim', { href: COMMONS_PETITION })]),
      'an operation that reads the caller',
      assert,
    );

    let checked = await request
      .post(`${new URL(COMMONS).pathname}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON)
      .set('X-Forwarded-For', VISITOR)
      .send({
        checks: [
          { target: COMMONS_PETITION, operation: 'claim' },
          { target: COMMONS_PETITION, operation: 'sign' },
        ],
      });
    assert.strictEqual(checked.status, 200, checked.text);
    assert.deepEqual(
      (checked.body.checks as { allowed: boolean; reason?: string }[]).map(
        ({ allowed, reason }) => ({ allowed, reason }),
      ),
      [
        { allowed: false, reason: 'actor-required' },
        { allowed: true, reason: undefined },
      ],
      'the capability check refuses the operation that reads the caller',
    );

    // One that doesn't read the caller is the ACL's to allow, and is.
    let signing = await explain(COMMONS_PETITION, 'sign', COMMONS_POLICY);
    assert.strictEqual(signing.decision, 'allowed');
    assert.strictEqual(signing.reason, 'acl');
    let signed = await operations(COMMONS, [
      invoke('sign', { href: COMMONS_PETITION, data: { name: 'Ada' } }),
    ]);
    assert.strictEqual(signed.status, 200, signed.text);
    assert.strictEqual(
      (await stored(commons, COMMONS_PETITION))?.signature,
      'Ada',
      'and the petition is signed',
    );
  });

  test('explain judges such a caller’s declared write by the grants that opt in to them', async function (assert) {
    assert.strictEqual(
      (await explain(OPEN, 'sign')).decision,
      'allowed',
      'an open petition',
    );
    assert.strictEqual(
      (await explain(CLOSED, 'sign')).decision,
      'denied',
      'a closed petition',
    );
  });

  test('explain reports a refusal as the caller who is not signed in receives it', async function (assert) {
    let refusals: [string, string, string][] = [
      ['a predicate that does not hold', CLOSED, 'predicate-false'],
      ['an operation that reads the caller', LOCAL, 'reads-actor'],
      ['a type no grant names', NOTICE, 'no-grant'],
      ['a grant whose acting user is not in the config', BALLOT, 'no-grant'],
    ];
    for (let [label, target, reason] of refusals) {
      let explained = await explain(target, 'sign');
      assert.strictEqual(explained.reason, reason, `${label}: ${reason}`);
      let response = await sign(target, 'Ada');
      unauthenticated(response, label, assert);
      assert.deepEqual(
        explained.refusal,
        { status: 401, code: 'actor-required' },
        `${label}: explain reports the 401 the realm sends`,
      );
    }
    // A realm anyone may read tells such a caller to authenticate for a write
    // it refused too, and explain says the same.
    let explained = await explain(BOARD_CLOSED, 'sign', BOARD_POLICY);
    assert.strictEqual(explained.reason, 'predicate-false');
    unauthenticated(
      await operations(BOARD, [
        invoke('sign', { href: BOARD_CLOSED, data: { name: 'Ada' } }),
      ]),
      'a realm anyone may read',
      assert,
    );
    assert.deepEqual(
      explained.refusal,
      { status: 401, code: 'actor-required' },
      'a realm anyone may read: explain reports the 401 the realm sends',
    );
  });
});
