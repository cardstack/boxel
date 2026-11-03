import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  POLICY_AUDIT_CONFIRMATION_HEADER,
  POLICY_OPENS_SHARES_CODE,
  rri,
  SupportedMimeType,
  type PolicyShareAudit,
} from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmAction,
} from '@cardstack/runtime-common';
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

// ============================================================================
// A policy change that opens shared keys to people who aren't signed in is
// audited before it is saved. The team realm's policy lives in the org realm
// and opens its weather card's operations to signed-in callers only. Two keys
// are shared into the team realm: one whose owner allows anonymous use, bound
// to `forecast`, and one whose owner doesn't, bound to `alerts`. A save that
// would open either operation to visitors — of the policy card, or of the
// team realm's `realm.json` pointing at another card — is refused with the
// list of shares it opens, and saved once it carries that list's
// confirmation. Each listed share's owner then has a notice.
// ============================================================================

const TEAM = 'http://127.0.0.1:4444/policy-share-audit-team/';
const ORG = 'http://127.0.0.1:4444/policy-share-audit-org/';
const TEAM_POLICY = `${ORG}policies/team`;
const OPEN_POLICY = `${ORG}policies/open`;
const secureOriginURL = new URL(
  'https://secure.policy-share-audit.test/secure',
);
const VENDOR = 'http://127.0.0.1:4537';
const DESTINATION = `${VENDOR}/`;
const OWNER = '@audit-owner:localhost';
const OTHER_OWNER = '@audit-other-owner:localhost';
const ORG_ADMIN = '@audit-org-admin:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const WEATHER_MODULE = `import { CardDef } from '@cardstack/base/card-api';
import { operation } from '@cardstack/base/operations';

export class Weather extends CardDef {
  static displayName = 'Weather';

  @operation static forecast = {
    base: 'callApi',
    label: 'Read the forecast',
    url: '${VENDOR}/graphql',
    headers: { authorization: 'Bearer {{apiKey}}' },
    graphql: { document: 'query { viewer { login } }' },
  };

  @operation static alerts = {
    base: 'callApi',
    label: 'Read the weather alerts',
    url: '${VENDOR}/graphql',
    headers: { authorization: 'Bearer {{apiKey}}' },
    graphql: { document: 'query { viewer { name } }' },
  };
}
`;

const WEATHER = { module: `${TEAM}weather`, name: 'Weather' };
const FORECAST = `${TEAM}weather#Weather.forecast`;
const ALERTS = `${TEAM}weather#Weather.alerts`;
const ANONYMOUS = 'actor() == "anonymous"';

function policy(anonymousOperations: string[] = []) {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          rules: [
            {
              targetType: { module: rri(WEATHER.module), name: WEATHER.name },
              grants: [
                { operation: 'forecast' },
                { operation: 'alerts' },
                ...anonymousOperations.map((operation) => ({
                  operation,
                  where: ANONYMOUS,
                })),
              ],
            },
          ],
        },
        meta: { adoptsFrom: REALM_POLICY },
      },
    },
    null,
    2,
  );
}

module(basename(import.meta.filename), function (hooks) {
  let team: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let dbAdapter: PgAdapter;
  let keyring: SecretsKeyring;

  setupCatalogTestSubset(hooks);

  async function start({
    dbAdapter: adapter,
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
      secureOriginURL,
      realms: [
        {
          realmURL: new URL(TEAM),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Weather',
              policy: TEAM_POLICY,
            }),
            'weather.gts': WEATHER_MODULE,
            'today.json': JSON.stringify({
              data: {
                type: 'card',
                attributes: {},
                meta: { adoptsFrom: { module: './weather', name: 'Weather' } },
              },
            }),
          },
          permissions: {
            '*': ['read'],
            [OWNER]: ['read', 'write', 'realm-owner'],
            [OTHER_OWNER]: ['read', 'write'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/team.json': policy(),
            'policies/open.json': policy(['forecast']),
          },
          permissions: {
            '*': ['read'],
            [ORG_ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
      ],
      dbAdapter: adapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    team = result.realms.find((realm) => realm.url === TEAM)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  async function stop() {
    for (let realm of [team, org]) {
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
    beforeEach: async (adapter, publisher, runner) => {
      dbAdapter = adapter;
      keyring = installSecretsKeyring(
        await new LocalKeyProvider().loadDataKeys(),
      );
      // The vendor the weather card names is local.
      configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
      await start({ dbAdapter: adapter, publisher, runner });
    },
    afterEach: async () => {
      resetOutbound();
      resetSecretsAtRest();
      await stop();
    },
  });

  async function ticket(
    owner: string,
    action: KeyWriteAction,
    {
      keyId = null,
      realm = null,
    }: { keyId?: string | null; realm?: string | null } = {},
  ) {
    return (
      await mintKeyWriteTicket(dbAdapter, owner, {
        action,
        keyId,
        realmURL: realm,
        shareId: null,
      })
    ).ticket;
  }

  let keysAdded = 0;

  // Shares a key of `owner`'s into the team realm, labelled `label`, and
  // approves it for interactive use of `operation`.
  async function sharedFor(
    operation: string,
    {
      owner,
      label,
      anonymous,
      interactive = true,
    }: {
      owner: string;
      label: string;
      anonymous: boolean;
      interactive?: boolean;
    },
  ) {
    let key = await addUserKey(dbAdapter, keyring, {
      owner,
      name: `weather-${++keysAdded}`,
      value: `weather-key-${keysAdded}-3f81c2`,
      anonymous,
      ticket: await ticket(owner, 'add'),
    });
    let shared = await request
      .post('/_key-shares')
      .set('Authorization', await secureSessionAuth(dbAdapter, owner))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-share',
          attributes: { realm: TEAM, keyId: key.id, label },
        },
        meta: {
          ticket: await ticket(owner, 'share', { keyId: key.id, realm: TEAM }),
        },
      });
    if (shared.status !== 201) {
      throw new Error(`could not share: ${shared.status} ${shared.text}`);
    }
    let shareId = shared.body.data.id as string;
    let previewed = await request
      .get('/_key-bindings/preview')
      .query({
        realm: TEAM,
        module: WEATHER.module,
        name: WEATHER.name,
        operation,
      })
      .set('Authorization', await secureSessionAuth(dbAdapter, owner));
    if (previewed.status !== 200) {
      throw new Error(
        `could not preview: ${previewed.status} ${previewed.text}`,
      );
    }
    let shown = previewed.body.data.attributes as {
      slots: { slot: string; fingerprint: string }[];
    };
    let approved = await request
      .post('/_key-bindings')
      .set('Authorization', await secureSessionAuth(dbAdapter, owner))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-approval',
          attributes: {
            realm: TEAM,
            interactive,
            ...(interactive ? { dailyBudgets: { [shareId]: 500 } } : {}),
            operations: [
              {
                codeRef: WEATHER,
                operation,
                expectedDestination: DESTINATION,
                slots: Object.fromEntries(
                  shown.slots.map((s) => [
                    s.slot,
                    { shareId, expectedFingerprint: s.fingerprint },
                  ]),
                ),
              },
            ],
          },
        },
      });
    if (approved.status !== 201) {
      throw new Error(`could not approve: ${approved.status} ${approved.text}`);
    }
    return { shareId, keyId: key.id };
  }

  async function shareBoth() {
    let forecast = await sharedFor('forecast', {
      owner: OWNER,
      label: 'Forecast key',
      anonymous: true,
    });
    let alerts = await sharedFor('alerts', {
      owner: OTHER_OWNER,
      label: 'Alerts key',
      anonymous: false,
    });
    return { forecast, alerts };
  }

  function auth(realm: Realm, user: string) {
    let permissions: RealmAction[] = ['read', 'write', 'realm-owner'];
    return `Bearer ${createJWT(realm, user, permissions)}`;
  }

  // Writes a file's source as the code editor and the CLI do.
  async function writeSource(
    realm: Realm,
    user: string,
    path: string,
    source: string,
    confirmation?: string,
  ) {
    let req = request
      .post(`${new URL(realm.url).pathname}${path}`)
      .set('Accept', SupportedMimeType.CardSource)
      .set('Authorization', auth(realm, user));
    if (confirmation) {
      req = req.set(POLICY_AUDIT_CONFIRMATION_HEADER, confirmation);
    }
    return await req.send(source);
  }

  function auditOf(response: { body: any }): PolicyShareAudit | undefined {
    let error = response.body?.errors?.[0];
    return error?.meta?.code === POLICY_OPENS_SHARES_CODE
      ? error.meta.audit
      : undefined;
  }

  async function stored(realm: Realm, path: string) {
    return (
      await request
        .get(`${new URL(realm.url).pathname}${path}`)
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', auth(realm, ORG_ADMIN))
    ).text;
  }

  async function notices(owner: string) {
    let response = await request
      .get('/_key-policy-notices')
      .set('Authorization', await secureSessionAuth(dbAdapter, owner));
    return (response.body.data as { attributes: Record<string, any> }[]).map(
      ({ attributes }) => attributes,
    );
  }

  test('a policy save that opens shared keys to visitors is refused with the shares it opens, shown without the details of a realm the saver can’t see the shares of', async function (assert) {
    await shareBoth();
    let response = await writeSource(
      org,
      ORG_ADMIN,
      'policies/team.json',
      policy(['forecast', 'alerts']),
    );
    assert.strictEqual(response.status, 409, response.text);
    let audit = auditOf(response);
    assert.ok(audit, 'the refusal carries the audit');
    // The org admin writes the policy card but isn't a direct writer of the
    // team realm, so its shares' ids, labels and owners are left out.
    assert.deepEqual(audit?.entries, [
      {
        realm: TEAM,
        policy: TEAM_POLICY,
        share: null,
        label: null,
        owner: null,
        keyAllowsAnonymous: false,
        operations: [ALERTS],
      },
      {
        realm: TEAM,
        policy: TEAM_POLICY,
        share: null,
        label: null,
        owner: null,
        keyAllowsAnonymous: true,
        operations: [FORECAST],
      },
    ]);
    for (let name of ['Forecast key', 'Alerts key', OWNER, OTHER_OWNER]) {
      assert.notOk(
        response.text.includes(name),
        `nothing in the refusal names ${name}`,
      );
    }
    assert.strictEqual(
      await stored(org, 'policies/team.json'),
      policy(),
      'nothing is written',
    );
    assert.deepEqual(await notices(OWNER), [], 'and nobody is told');
  });

  test('the save lands once it carries the confirmation, and each share’s owner is told', async function (assert) {
    let { forecast, alerts } = await shareBoth();
    let opened = policy(['forecast', 'alerts']);
    let refused = await writeSource(
      org,
      ORG_ADMIN,
      'policies/team.json',
      opened,
    );
    let confirmation = auditOf(refused)!.confirmation;
    let saved = await writeSource(
      org,
      ORG_ADMIN,
      'policies/team.json',
      opened,
      confirmation,
    );
    assert.strictEqual(saved.status, 204, saved.text);
    assert.strictEqual(await stored(org, 'policies/team.json'), opened);

    let [forecastNotice] = await notices(OWNER);
    assert.deepEqual(
      {
        ...forecastNotice,
        createdAt: typeof forecastNotice?.createdAt,
      },
      {
        realm: TEAM,
        share: forecast.shareId,
        label: 'Forecast key',
        key: forecast.keyId,
        policy: TEAM_POLICY,
        savedBy: ORG_ADMIN,
        reason: 'visitors-use',
        operations: [FORECAST],
        createdAt: 'string',
      },
      'the owner of a key that allows it is told visitors now use it',
    );
    let otherNotices = await notices(OTHER_OWNER);
    assert.deepEqual(
      otherNotices.map(({ share, key, reason, operations }) => ({
        share,
        key,
        reason,
        operations,
      })),
      [
        {
          share: alerts.shareId,
          key: alerts.keyId,
          reason: 'visitors-wanted',
          operations: [ALERTS],
        },
      ],
      'the owner of a key that doesn’t is told the realm wants visitors to use it',
    );
  });

  test('a confirmation confirms only the list it was given', async function (assert) {
    await sharedFor('forecast', {
      owner: OWNER,
      label: 'Forecast key',
      anonymous: true,
    });
    let opened = policy(['forecast', 'alerts']);
    let refused = await writeSource(
      org,
      ORG_ADMIN,
      'policies/team.json',
      opened,
    );
    let confirmation = auditOf(refused)!.confirmation;
    // A share bound to another opened operation in between makes a new list.
    await sharedFor('alerts', {
      owner: OTHER_OWNER,
      label: 'Alerts key',
      anonymous: false,
    });
    let again = await writeSource(
      org,
      ORG_ADMIN,
      'policies/team.json',
      opened,
      confirmation,
    );
    assert.strictEqual(again.status, 409, again.text);
    assert.deepEqual(
      auditOf(again)?.entries.map((entry) => entry.operations),
      [[ALERTS], [FORECAST]],
    );
    assert.notStrictEqual(auditOf(again)?.confirmation, confirmation);
  });

  test('a save that opens nothing new to visitors needs no confirmation', async function (assert) {
    await shareBoth();
    let forecastOnly = policy(['forecast']);
    let refused = await writeSource(
      org,
      ORG_ADMIN,
      'policies/team.json',
      forecastOnly,
    );
    let saved = await writeSource(
      org,
      ORG_ADMIN,
      'policies/team.json',
      forecastOnly,
      auditOf(refused)!.confirmation,
    );
    assert.strictEqual(saved.status, 204, saved.text);
    // The team realm compares a later save with the policy now in force.
    await org.incrementalIndexing();
    team.__testOnlyClearCaches();

    // Opening the same operation again, and closing one, opens nothing.
    let reordered = JSON.parse(forecastOnly);
    reordered.data.attributes.rules[0].grants.reverse();
    let resaved = await writeSource(
      org,
      ORG_ADMIN,
      'policies/team.json',
      JSON.stringify(reordered, null, 2),
    );
    assert.strictEqual(resaved.status, 204, resaved.text);
    let closed = await writeSource(
      org,
      ORG_ADMIN,
      'policies/team.json',
      policy(),
    );
    assert.strictEqual(closed.status, 204, closed.text);
  });

  test('a write of a policy card no realm with shares names is not audited', async function (assert) {
    await shareBoth();
    let response = await writeSource(
      org,
      ORG_ADMIN,
      'policies/draft.json',
      policy(['forecast', 'alerts']),
    );
    assert.strictEqual(response.status, 204, response.text);
  });

  test('pointing a realm at a policy that opens its shares is audited the same way', async function (assert) {
    let { forecast } = await shareBoth();
    let config = realmConfigCardJSON({ name: 'Weather', policy: OPEN_POLICY });
    let refused = await writeSource(team, OWNER, 'realm.json', config);
    assert.strictEqual(refused.status, 409, refused.text);
    let audit = auditOf(refused);
    assert.deepEqual(
      audit?.entries.map(({ share, label, owner, policy, operations }) => ({
        share,
        label,
        owner,
        policy,
        operations,
      })),
      [
        {
          share: forecast.shareId,
          label: 'Forecast key',
          owner: OWNER,
          policy: OPEN_POLICY,
          operations: [FORECAST],
        },
      ],
      'a direct writer of the realm sees each share, and only the operation the policy it points at opens',
    );
    let saved = await writeSource(
      team,
      OWNER,
      'realm.json',
      config,
      audit!.confirmation,
    );
    assert.strictEqual(saved.status, 204, saved.text);
    assert.deepEqual(
      (await notices(OWNER)).map(({ reason, policy }) => ({ reason, policy })),
      [{ reason: 'visitors-use', policy: OPEN_POLICY }],
    );
  });

  test('an atomic write and a card patch are audited too', async function (assert) {
    await shareBoth();
    let atomic = await request
      .post(`${new URL(ORG).pathname}_atomic`)
      .set('Accept', SupportedMimeType.JSONAPI)
      .set('Authorization', auth(org, ORG_ADMIN))
      .send(
        JSON.stringify({
          'atomic:operations': [
            {
              op: 'update',
              href: 'policies/team.json',
              data: {
                type: 'source',
                attributes: { content: policy(['forecast']) },
                meta: {},
              },
            },
          ],
        }),
      );
    assert.strictEqual(atomic.status, 409, atomic.text);
    assert.strictEqual(
      auditOf(atomic)?.entries.length,
      1,
      'the atomic route answers with the audit',
    );

    let current = JSON.parse(policy()).data;
    let patched = await request
      .patch(`${new URL(ORG).pathname}policies/team`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth(org, ORG_ADMIN))
      .send(
        JSON.stringify({
          data: {
            type: 'card',
            attributes: {
              rules: [
                {
                  ...current.attributes.rules[0],
                  grants: [
                    ...current.attributes.rules[0].grants,
                    { operation: 'alerts', where: ANONYMOUS },
                  ],
                },
              ],
            },
            meta: { adoptsFrom: REALM_POLICY },
          },
        }),
      );
    assert.strictEqual(patched.status, 409, patched.text);
    assert.deepEqual(
      auditOf(patched)?.entries.map((entry) => entry.operations),
      [[ALERTS]],
      'the card route answers with the audit',
    );
    assert.strictEqual(await stored(org, 'policies/team.json'), policy());
  });
  test('creating the card a realm already names is audited like changing it', async function (assert) {
    await shareBoth();
    let missing = `${ORG}policies/upcoming`;
    let pointed = await writeSource(
      team,
      OWNER,
      'realm.json',
      realmConfigCardJSON({ name: 'Weather', policy: missing }),
    );
    assert.strictEqual(
      pointed.status,
      204,
      'naming a card that doesn’t exist yet opens nothing',
    );
    let created = await writeSource(
      org,
      ORG_ADMIN,
      'policies/upcoming.json',
      policy(['forecast']),
    );
    assert.strictEqual(created.status, 409, created.text);
    assert.deepEqual(
      auditOf(created)?.entries.map(({ policy, operations }) => ({
        policy,
        operations,
      })),
      [{ policy: missing, operations: [FORECAST] }],
    );
  });

  test('a share bound for pipelines only is not listed, since it never serves a visitor', async function (assert) {
    await sharedFor('forecast', {
      owner: OWNER,
      label: 'Forecast key',
      anonymous: true,
      interactive: false,
    });
    let response = await writeSource(
      org,
      ORG_ADMIN,
      'policies/team.json',
      policy(['forecast']),
    );
    assert.strictEqual(response.status, 204, response.text);
  });

  test('a save confirmed again owes no second notice', async function (assert) {
    await shareBoth();
    let opened = policy(['forecast']);
    let refused = await writeSource(
      org,
      ORG_ADMIN,
      'policies/team.json',
      opened,
    );
    let { confirmation } = auditOf(refused)!;
    for (let i = 0; i < 2; i++) {
      let saved = await writeSource(
        org,
        ORG_ADMIN,
        'policies/team.json',
        opened,
        confirmation,
      );
      assert.strictEqual(saved.status, 204, saved.text);
    }
    assert.strictEqual((await notices(OWNER)).length, 1);
  });
});
