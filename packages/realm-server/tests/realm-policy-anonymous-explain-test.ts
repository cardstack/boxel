import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  DEFAULT_ANONYMOUS_RATE_LIMIT,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import type { PolicyExplanation } from '@cardstack/runtime-common/card-operations';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
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

// A notice board nobody may read or write without signing in, governed by a
// policy card in an Org realm. Its policy opens edits of a notice to callers
// who aren't signed in through four grants, each with an `actingUser` reading
// a different key of the board's `realm.json` `config`: one naming a user who
// may write the board, one naming a user who may only read it, one naming
// nobody, and one the config doesn't hold, which the expression fails on.
// `claim` reads the caller, so the grant opening it to such callers is warned
// about. A second board's grants carry no rate limit of their own.
const BOARD = 'http://127.0.0.1:4444/board/';
const PLAIN = 'http://127.0.0.1:4444/plain/';
const ORG = 'http://127.0.0.1:4444/org/';
const BOARD_POLICY = `${ORG}policies/board`;
const PLAIN_POLICY = `${ORG}policies/plain`;
const EDITOR = '@editor:localhost';
const SUBMITTER = '@submitter:localhost';
const READER = '@reader:localhost';
const ORG_ADMIN = '@org-admin:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const BOARD_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, actor } from "@cardstack/base/operations";
  export class Notice extends CardDef {
    @field message = contains(StringField);
    @field claimedBy = contains(StringField);

    @operation static claim = {
      base: 'transform',
      set: { claimedBy: actor() },
    };
  }
`;

const BOARD_CONFIG = {
  submitter: SUBMITTER,
  reader: READER,
  bogus: 'not a user',
  blockedIps: '',
  requests: 5,
  windowSeconds: 30,
};

const BOARD_LIMIT = { requests: 5, windowSeconds: 30 };

// What a grant's `where` says to open it to callers who aren't signed in.
const ANONYMOUS = 'actor() == "anonymous"';

const NOTICE = `${BOARD}notices/welcome`;
const PLAIN_NOTICE = `${PLAIN}notices/welcome`;

function notice(message: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { message },
      meta: { adoptsFrom: { module: '../board', name: 'Notice' } },
    },
  });
}

function policyCard(realm: string, { limited }: { limited: boolean }) {
  let traffic = limited
    ? {
        blocklist: 'realmConfig("blockedIps")',
        rateLimitRequests: 'realmConfig("requests")',
        rateLimitWindowSeconds: 'realmConfig("windowSeconds")',
      }
    : {};
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        rules: [
          {
            targetType: { module: `${realm}board`, name: 'Notice' },
            grants: [
              {
                operation: 'update',
                where: ANONYMOUS,
                actingUser: 'realmConfig("submitter")',
              },
              {
                operation: 'update',
                where: ANONYMOUS,
                actingUser: 'realmConfig("reader")',
              },
              {
                operation: 'update',
                where: ANONYMOUS,
                actingUser: 'realmConfig("bogus")',
              },
              {
                operation: 'update',
                where: ANONYMOUS,
                actingUser: 'realmConfig("missing")',
              },
              { operation: 'read', where: ANONYMOUS, ...traffic },
              {
                operation: 'claim',
                where: ANONYMOUS,
                actingUser: 'realmConfig("submitter")',
              },
              // Signed-in grants that put a warned grant at index 10, whose
              // path `rules[0].grants[1]` is a string prefix of.
              { operation: 'delete' },
              { operation: 'delete' },
              { operation: 'delete' },
              { operation: 'delete' },
              {
                operation: 'claim',
                where: ANONYMOUS,
                actingUser: 'realmConfig("reader")',
              },
            ],
          },
        ],
      },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

module(basename(import.meta.filename), function (hooks) {
  let board: Realm;
  let plain: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;

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
          realmURL: new URL(BOARD),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Board',
              policy: BOARD_POLICY,
              config: BOARD_CONFIG,
            }),
            'board.gts': BOARD_MODULE,
            'notices/welcome.json': notice('Welcome'),
          },
          permissions: {
            [EDITOR]: ['read', 'write', 'realm-owner'],
            [SUBMITTER]: ['read', 'write'],
            [READER]: ['read'],
            [ORG_ADMIN]: ['read'],
          },
        },
        {
          realmURL: new URL(PLAIN),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Plain',
              policy: PLAIN_POLICY,
              config: BOARD_CONFIG,
            }),
            'board.gts': BOARD_MODULE,
            'notices/welcome.json': notice('Welcome'),
          },
          permissions: {
            [EDITOR]: ['read', 'write', 'realm-owner'],
            [SUBMITTER]: ['read', 'write'],
            [ORG_ADMIN]: ['read'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/board.json': policyCard(BOARD, { limited: true }),
            'policies/plain.json': policyCard(PLAIN, { limited: false }),
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
    board = result.realms.find((realm) => realm.url === BOARD)!;
    plain = result.realms.find((realm) => realm.url === PLAIN)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  async function stop() {
    for (let realm of [board, plain, org]) {
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
    },
    afterEach: stop,
  });

  async function explain(
    policy: string,
    actor: string,
    target: string,
    operation: string,
  ): Promise<PolicyExplanation> {
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
            {
              op: 'invoke',
              'boxel:name': 'explain',
              href: policy,
              data: { actor, target, operation },
            },
          ],
        }),
      );
    if (response.status !== 200) {
      throw new Error(`explain answered ${response.status}: ${response.text}`);
    }
    return response.body['atomic:results'][0] as PolicyExplanation;
  }

  function grantsOf(explanation: PolicyExplanation) {
    return explanation.rules.flatMap((rule) => rule.grants);
  }

  test('each grant opened to callers who are not signed in says who its writes are made as, or why no one', async function (assert) {
    let explanation = await explain(BOARD_POLICY, '', NOTICE, 'update');
    assert.strictEqual(explanation.decision, 'allowed', 'the submitter writes');
    assert.deepEqual(
      grantsOf(explanation).map(({ path, anonymous }) => ({
        path,
        actingUser: anonymous?.actingUser,
      })),
      [
        {
          path: 'rules[0].grants[0]',
          actingUser: {
            expression: 'realmConfig("submitter")',
            user: SUBMITTER,
          },
        },
        {
          path: 'rules[0].grants[1]',
          actingUser: {
            expression: 'realmConfig("reader")',
            failure: 'no-write',
          },
        },
        {
          path: 'rules[0].grants[2]',
          actingUser: {
            expression: 'realmConfig("bogus")',
            failure: 'not-a-matrix-id',
          },
        },
        {
          path: 'rules[0].grants[3]',
          actingUser: {
            expression: 'realmConfig("missing")',
            failure: 'expression-failed',
          },
        },
      ],
    );
    let read = await explain(BOARD_POLICY, '', NOTICE, 'read');
    assert.deepEqual(
      grantsOf(read).map(({ anonymous }) => anonymous?.actingUser),
      [undefined],
      'a read opted in names no acting user',
    );
  });

  test('a grant opened to such callers says what it blocks them by and what it limits them to', async function (assert) {
    let own = await explain(BOARD_POLICY, '', NOTICE, 'read');
    assert.deepEqual(
      grantsOf(own).map(({ anonymous }) => anonymous),
      [
        {
          blocklist: {
            expression: 'realmConfig("blockedIps")',
            entries: [],
          },
          rateLimit: {
            ...BOARD_LIMIT,
            requestsFrom: 'grant',
            windowSecondsFrom: 'grant',
            requestsExpression: 'realmConfig("requests")',
            windowSecondsExpression: 'realmConfig("windowSeconds")',
          },
        },
      ],
    );
    assert.deepEqual(
      own.anonymous,
      { platformLimit: DEFAULT_ANONYMOUS_RATE_LIMIT },
      'and the explanation says what a grant that sets none falls back to',
    );

    let inherited = await explain(PLAIN_POLICY, '', PLAIN_NOTICE, 'read');
    assert.deepEqual(
      grantsOf(inherited).map(({ anonymous }) => anonymous?.rateLimit),
      [
        {
          ...DEFAULT_ANONYMOUS_RATE_LIMIT,
          requestsFrom: 'platform',
          windowSecondsFrom: 'platform',
        },
      ],
      'a grant that sets no limit of its own counts against the platform default',
    );

    let signedIn = await explain(BOARD_POLICY, READER, NOTICE, 'update');
    assert.strictEqual(
      signedIn.anonymous,
      undefined,
      'a question about a signed-in caller says nothing about it',
    );
    assert.notOk(
      grantsOf(signedIn).some(({ anonymous }) => anonymous),
      'and neither do its grants',
    );
  });

  test('an invalid blocklist entry is reported, since it closes the grant to every such caller', async function (assert) {
    await board.write(
      'realm.json',
      realmConfigCardJSON({
        name: 'Board',
        policy: BOARD_POLICY,
        config: {
          ...BOARD_CONFIG,
          blockedIps: '198.51.100.0/24, not an address',
        },
      }),
    );
    await board.indexing();
    let explanation = await explain(BOARD_POLICY, '', NOTICE, 'read');
    assert.deepEqual(
      grantsOf(explanation).map(({ anonymous }) => anonymous?.blocklist),
      [
        {
          expression: 'realmConfig("blockedIps")',
          entries: ['198.51.100.0/24'],
          invalid: ['not an address'],
        },
      ],
    );
    assert.strictEqual(
      explanation.decision,
      'denied',
      'the grant that would admit such a caller does not, since it turns them away first',
    );
    assert.deepEqual(explanation.refusal, {
      status: 401,
      code: 'actor-required',
    });
    assert.strictEqual(explanation.admittedBy, undefined);
    let signedIn = await explain(BOARD_POLICY, READER, NOTICE, 'read');
    assert.strictEqual(
      signedIn.reason,
      'acl',
      'a signed-in caller is answered by the realm as before',
    );
  });

  test('a grant listed carries what compiling the policy recorded against it', async function (assert) {
    let explanation = await explain(BOARD_POLICY, READER, NOTICE, 'claim');
    let claim = grantsOf(explanation).find(
      ({ path }) => path === 'rules[0].grants[5]',
    );
    assert.ok(claim, 'the claim grant is listed');
    assert.deepEqual(
      claim?.issues?.map(({ code, path, severity }) => ({
        code,
        path,
        severity,
      })),
      [
        {
          code: 'anonymous-grant-reads-actor',
          path: 'rules[0].grants[5].operation',
          severity: 'warning',
        },
      ],
    );
    assert.notOk(
      grantsOf(await explain(BOARD_POLICY, READER, NOTICE, 'update')).some(
        ({ issues }) => issues,
      ),
      "a grant with nothing recorded against it carries no issues, not even rules[0].grants[10]'s",
    );
  });
});
