import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import { createJWT, setupPermissionedRealmCached } from './helpers/index.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import {
  startStubVendor,
  STUB_PULL_REQUEST,
  type StubVendor,
} from './helpers/stub-vendor.ts';
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
import { shareKey, swapKeyIntoShare } from '../lib/key-shares.ts';
import { setUserKeyLimits } from '../lib/key-limits.ts';
import { DEFAULT_KEY_LIMITS } from '../lib/key-limit-settings.ts';

// ============================================================================
// Interactive use of a binding, end to end against the stub vendor. A key's
// owner approves a card's operations for interactive use as well as for
// pipelines, and a card opened in the browser (an `_operations` request
// carrying the user's session) then sends the key, within the key's limits.
// A binding approved for pipelines only refuses that call
// `interactive-use-not-approved`. A share's first interactive approval names
// its daily budget.
//
// The card is the PR Inbox the `api-integrations` card-author skill writes,
// pointed at the stub vendor's GitHub-shaped GraphQL endpoint.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/interactive-bindings-test/');
const secureOriginURL = new URL('https://secure.interactive.test/secure');
const VENDOR_PORT = 4533;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const OWNER = '@interactive-owner:localhost';
const READER = '@interactive-reader:localhost';
const REALM_USER = '@node-test_realm:localhost';
const VALUE = 'ghp-interactive-owner-key-7c21e0';
const OTHER_VALUE = 'ghp-interactive-reader-key-3b9f44';
const PR_INBOX = { module: rri(`${realmURL.href}pr-inbox`), name: 'PRInbox' };
const TEAM_FEED = {
  module: rri(`${realmURL.href}team-feed`),
  name: 'TeamFeed',
};
const DESTINATION = `${VENDOR}/`;

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

// A card whose one keyed request is filled from a share in its realm.
const teamFeedModule = `import { CardDef } from '@cardstack/base/card-api';
import { operation } from '@cardstack/base/operations';

export class TeamFeed extends CardDef {
  static displayName = 'Team feed';

  @operation static latest = {
    base: 'callApi',
    label: 'Read the team feed',
    url: '${VENDOR}/graphql',
    headers: { authorization: 'Bearer {{apiKey}}' },
    graphql: { document: 'query { viewer { login } }' },
  };
}
`;

function inboxCard(): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: { login: 'octocat' },
      meta: { adoptsFrom: PR_INBOX },
    },
  };
}

interface BatchSlot {
  slot: string;
  status: string;
  fingerprint: string;
  approved?: { interactive: boolean };
}
interface BatchOperation {
  name: string;
  status: string;
  slots: BatchSlot[];
}
interface Batch {
  groups: { operations: BatchOperation[] }[];
  shares: {
    id: string;
    label: string;
    interactive: boolean;
    dailyBudget: number;
  }[];
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let request: SuperTest<Test>;
  let dbAdapter: PgAdapter;
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
      [READER]: ['read', 'write'],
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'pr-inbox.gts': prInboxModule,
      'team-feed.gts': teamFeedModule,
      'inbox.json': inboxCard(),
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter;
      vendor.requests.length = 0;
    },
  });

  async function ticket(
    owner: string,
    action: KeyWriteAction,
    {
      keyId = null,
      shareId = null,
      realm: realmOf = null,
    }: {
      keyId?: string | null;
      shareId?: string | null;
      realm?: URL | null;
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

  async function addKey(owner = OWNER, value = VALUE) {
    return await addUserKey(dbAdapter, keyring, {
      owner,
      name: 'github',
      value,
      ticket: await ticket(owner, 'add'),
    });
  }

  async function addShare() {
    let key = await addKey();
    return await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId: key.id,
      label: 'Team GitHub',
      ticket: await ticket(OWNER, 'share', { keyId: key.id, realm: realmURL }),
    });
  }

  async function batchOf(
    user: string,
    type: { module: string; name: string },
    extra: Record<string, unknown> = {},
  ): Promise<Batch> {
    let response = await request
      .post('/_key-bindings/batch')
      .set('Authorization', await secureSessionAuth(dbAdapter, user))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-batch',
          attributes: {
            target: { kind: 'type', ...type, realm: realmURL.href },
            ...extra,
          },
        },
      });
    if (response.status !== 200) {
      throw new Error(
        `batch answered ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
    return response.body.data.attributes;
  }

  function operationsIn(batch: Batch) {
    return batch.groups.flatMap((g) => g.operations);
  }

  // Approves the named operations, every slot filled with `fill`, naming the
  // fingerprints the approval screen's preview shows. The preview answers an
  // operation whether or not it is approved already, so an approval can be
  // made again.
  async function approve(
    user: string,
    type: { module: string; name: string },
    names: string[],
    fill: { keyId: string } | { shareId: string },
    attributes: Record<string, unknown> = {},
  ) {
    let operations = [];
    for (let name of names) {
      let shown = (
        await request
          .get('/_key-bindings/preview')
          .query({
            realm: realmURL.href,
            module: type.module,
            name: type.name,
            operation: name,
          })
          .set('Authorization', await secureSessionAuth(dbAdapter, user))
      ).body.data.attributes as {
        slots: { slot: string; fingerprint: string }[];
      };
      operations.push({
        codeRef: type,
        operation: name,
        expectedDestination: DESTINATION,
        slots: Object.fromEntries(
          shown.slots.map((s) => [
            s.slot,
            { ...fill, expectedFingerprint: s.fingerprint },
          ]),
        ),
      });
    }
    return await request
      .post('/_key-bindings')
      .set('Authorization', await secureSessionAuth(dbAdapter, user))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-approval',
          attributes: { realm: realmURL.href, operations, ...attributes },
        },
      });
  }

  function envelope(name: string, rest: { href?: string; data?: unknown }) {
    return JSON.stringify({
      'boxel:operations': [{ op: 'invoke', 'boxel:name': name, ...rest }],
    });
  }

  function onInbox(name: string) {
    return envelope(name, { href: '/inbox' });
  }

  function onTeamFeed() {
    return envelope('latest', { data: { meta: { adoptsFrom: TEAM_FEED } } });
  }

  // Invokes as `user` from a card open in the browser: an `_operations`
  // request from off the network, carrying the user's session.
  async function fromBrowser(user: string, body: string) {
    let response = await request
      .post(`${realmURL.pathname}_operations`)
      .set('Accept', OPERATIONS)
      .set('Content-Type', OPERATIONS)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, user, ['read', 'write'])}`,
      )
      .send(body);
    return {
      status: response.status,
      body: response.body,
      code: response.body?.errors?.[0]?.code as string | undefined,
    };
  }

  // Invokes as a pipeline the realm server runs as `user`.
  async function asPipeline(user: string, body: string) {
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

  async function budgetUsed(subject: 'key' | 'share', id: string) {
    let rows = await dbAdapter.execute(
      `SELECT count FROM rate_limit_budgets WHERE budget_key = $1 AND period = 'day'`,
      { bind: [JSON.stringify(['key-limit', subject, id])] },
    );
    return rows.length === 0 ? 0 : Number(rows[0].count);
  }

  test('the PR Inbox, approved interactively with a personal key, loads pull requests in the browser; one approved for pipelines only is refused there', async function (assert) {
    let key = await addKey();
    let approved = await approve(
      OWNER,
      PR_INBOX,
      ['listPRs'],
      {
        keyId: key.id,
      },
      { interactive: true },
    );
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    assert.true(
      approved.body.data[0].attributes.interactive,
      'the binding allows interactive use',
    );
    let pipelinesOnly = await approve(OWNER, PR_INBOX, ['listReviewRequests'], {
      keyId: key.id,
    });
    assert.strictEqual(
      pipelinesOnly.status,
      201,
      JSON.stringify(pipelinesOnly.body),
    );
    assert.false(pipelinesOnly.body.data[0].attributes.interactive);

    let loaded = await fromBrowser(OWNER, onInbox('listPRs'));
    assert.strictEqual(loaded.status, 200, JSON.stringify(loaded.body));
    assert.true(
      JSON.stringify(loaded.body).includes(STUB_PULL_REQUEST.title),
      'the pull requests come back from the vendor',
    );
    assert.strictEqual(vendor.requests.length, 1);
    assert.strictEqual(
      vendor.requests[0].headers.authorization,
      `Bearer ${VALUE}`,
      "the key is sent as the declaration says, from the binding's grant",
    );
    assert.true(
      vendor.requests[0].body.includes('octocat'),
      "the card's own login is the query variable",
    );
    assert.strictEqual(
      await budgetUsed('key', key.id),
      1,
      "the first browser call is counted against the key's daily budget",
    );

    let refused = await fromBrowser(OWNER, onInbox('listReviewRequests'));
    assert.strictEqual(refused.status, 403, JSON.stringify(refused.body));
    assert.strictEqual(refused.code, 'interactive-use-not-approved');
    let detail: string = refused.body.errors[0].detail;
    assert.true(
      detail.includes(`"userKey" (the invoking user's own key)`),
      "the refusal says the slot takes the caller's own key",
    );
    assert.true(
      detail.includes('The invoking user can allow'),
      'and that the caller can allow it',
    );
    assert.strictEqual(vendor.requests.length, 1, 'nothing more was sent');

    let pipeline = await asPipeline(OWNER, onInbox('listReviewRequests'));
    assert.strictEqual(pipeline.status, 200, JSON.stringify(pipeline.body));
    assert.strictEqual(
      await budgetUsed('key', key.id),
      1,
      'a pipeline call counts against nothing',
    );
  });

  test("the key's limits refuse a browser call once its owner's rate is spent", async function (assert) {
    let key = await addKey();
    await setUserKeyLimits(dbAdapter, {
      owner: OWNER,
      keyId: key.id,
      changes: { rateBurst: 1, rateRefillPerMinute: 0.01 },
    });
    await approve(
      OWNER,
      PR_INBOX,
      ['listPRs'],
      { keyId: key.id },
      {
        interactive: true,
      },
    );
    let first = await fromBrowser(OWNER, onInbox('listPRs'));
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    let second = await fromBrowser(OWNER, onInbox('listPRs'));
    assert.strictEqual(second.status, 429, JSON.stringify(second.body));
    assert.strictEqual(second.code, 'rate-limited');
    assert.strictEqual(
      vendor.requests.length,
      1,
      'the refused call sent nothing',
    );
  });

  test('approving again without interactive use returns a binding to pipelines only, and each approval records which it allowed', async function (assert) {
    let key = await addKey();
    let first = await approve(
      OWNER,
      PR_INBOX,
      ['listPRs'],
      { keyId: key.id },
      {
        interactive: true,
      },
    );
    let bindingId = first.body.data[0].id;
    await approve(OWNER, PR_INBOX, ['listPRs'], { keyId: key.id });
    let [binding] = await dbAdapter.execute(
      `SELECT interactive FROM key_bindings WHERE id = $1`,
      { bind: [bindingId] },
    );
    assert.false(Boolean(binding.interactive));
    let history = await dbAdapter.execute(
      `SELECT action, interactive FROM key_binding_approvals WHERE binding_id = $1 ORDER BY at`,
      { bind: [bindingId] },
    );
    assert.deepEqual(
      history.map((r) => [r.action, Boolean(r.interactive)]),
      [
        ['approved', true],
        ['re-approved', false],
      ],
    );
    let refused = await fromBrowser(OWNER, onInbox('listPRs'));
    assert.strictEqual(refused.code, 'interactive-use-not-approved');
  });

  test('anonymous use is still refused, and nothing is approved', async function (assert) {
    let key = await addKey();
    let response = await approve(
      OWNER,
      PR_INBOX,
      ['listPRs'],
      { keyId: key.id },
      { interactive: true, anonymous: true },
    );
    assert.strictEqual(response.status, 403, JSON.stringify(response.body));
    let rows = await dbAdapter.execute(
      `SELECT id FROM key_bindings WHERE realm_url = $1`,
      { bind: [realmURL.href] },
    );
    assert.strictEqual(rows.length, 0);
  });

  test('a batch asked with interactive also answers what is approved for pipelines only, and says how each slot was approved', async function (assert) {
    let key = await addKey();
    await approve(
      OWNER,
      PR_INBOX,
      ['listPRs'],
      { keyId: key.id },
      {
        interactive: true,
      },
    );
    await approve(OWNER, PR_INBOX, ['listReviewRequests'], { keyId: key.id });

    assert.deepEqual(
      operationsIn(await batchOf(OWNER, PR_INBOX)),
      [],
      'both are approved, so a batch for pipelines has nothing to ask',
    );
    let forInteractive = operationsIn(
      await batchOf(OWNER, PR_INBOX, { interactive: true }),
    );
    assert.deepEqual(
      forInteractive.map((o) => [o.name, o.status]),
      [['listReviewRequests', 'pipelines-only']],
      'only the one approved for pipelines only needs approving for interactive use',
    );
    assert.false(forInteractive[0].slots[0].approved?.interactive);
  });

  test("a share's first interactive approval names its daily budget, which is set with it; later ones needn't", async function (assert) {
    let share = await addShare();
    let pipelinesOnly = await approve(OWNER, TEAM_FEED, ['latest'], {
      shareId: share.id,
    });
    assert.strictEqual(pipelinesOnly.status, 201);
    let refusedReader = await fromBrowser(READER, onTeamFeed());
    assert.strictEqual(refusedReader.code, 'interactive-use-not-approved');
    let readerDetail: string = refusedReader.body.errors[0].detail;
    assert.true(
      readerDetail.includes(`"apiKey" (the realm's key)`),
      "a share slot is named as the realm's key",
    );
    assert.true(
      readerDetail.includes("Whoever shared the realm's key can allow"),
      'which whoever shared it can allow',
    );
    let shown = await batchOf(OWNER, TEAM_FEED, { interactive: true });
    assert.deepEqual(
      shown.shares.map((s) => [s.label, s.interactive, s.dailyBudget]),
      [['Team GitHub', false, DEFAULT_KEY_LIMITS.dailyBudget]],
      'the share has no interactive approval yet, and the default budget',
    );

    let unnamed = await approve(
      OWNER,
      TEAM_FEED,
      ['latest'],
      { shareId: share.id },
      { interactive: true },
    );
    assert.strictEqual(unnamed.status, 400, JSON.stringify(unnamed.body));
    assert.true(
      JSON.stringify(unnamed.body).includes('daily budget'),
      'it says what is missing',
    );
    let interactiveRows = await dbAdapter.execute(
      `SELECT id FROM key_bindings WHERE share_id = $1 AND interactive`,
      { bind: [share.id] },
    );
    assert.strictEqual(
      interactiveRows.length,
      0,
      'nothing was approved for interactive use',
    );

    let notInteractive = await approve(
      OWNER,
      TEAM_FEED,
      ['latest'],
      { shareId: share.id },
      { dailyBudgets: { [share.id]: 500 } },
    );
    assert.strictEqual(
      notInteractive.status,
      400,
      'a budget is set only with interactive use',
    );

    let named = await approve(
      OWNER,
      TEAM_FEED,
      ['latest'],
      { shareId: share.id },
      { interactive: true, dailyBudgets: { [share.id]: 500 } },
    );
    assert.strictEqual(named.status, 201, JSON.stringify(named.body));
    let [row] = await dbAdapter.execute(
      `SELECT daily_budget FROM key_shares WHERE id = $1`,
      { bind: [share.id] },
    );
    assert.strictEqual(Number(row.daily_budget), 500);

    let readerCall = await fromBrowser(READER, onTeamFeed());
    assert.strictEqual(
      readerCall.status,
      200,
      'a reader of the realm can use the share from the browser',
    );
    assert.strictEqual(await budgetUsed('share', share.id), 1);

    let again = await approve(
      OWNER,
      TEAM_FEED,
      ['latest'],
      { shareId: share.id },
      { interactive: true },
    );
    assert.strictEqual(
      again.status,
      201,
      'a later interactive approval keeps the budget it has',
    );
    let [kept] = await dbAdapter.execute(
      `SELECT daily_budget FROM key_shares WHERE id = $1`,
      { bind: [share.id] },
    );
    assert.strictEqual(Number(kept.daily_budget), 500);
  });

  test('a daily budget is refused for a share the approval does not fill, or one that is not a whole number', async function (assert) {
    let share = await addShare();
    let other = await approve(
      OWNER,
      TEAM_FEED,
      ['latest'],
      { shareId: share.id },
      {
        interactive: true,
        dailyBudgets: {
          [share.id]: 500,
          '00000000-0000-4000-8000-000000000000': 10,
        },
      },
    );
    assert.strictEqual(other.status, 400, JSON.stringify(other.body));
    let fractional = await approve(
      OWNER,
      TEAM_FEED,
      ['latest'],
      { shareId: share.id },
      { interactive: true, dailyBudgets: { [share.id]: 2.5 } },
    );
    assert.strictEqual(fractional.status, 400, JSON.stringify(fractional.body));
  });

  test('a swap keeps whether each of the share’s bindings allows interactive use', async function (assert) {
    let share = await addShare();
    let approved = await approve(
      OWNER,
      TEAM_FEED,
      ['latest'],
      { shareId: share.id },
      { interactive: true, dailyBudgets: { [share.id]: 500 } },
    );
    let bindingId = approved.body.data[0].id;
    await dbAdapter.execute(
      `UPDATE realm_user_permissions SET write = false WHERE realm_url = $1 AND username = $2`,
      { bind: [realmURL.href, OWNER] },
    );
    let theirs = await addKey(READER, OTHER_VALUE);
    await swapKeyIntoShare(dbAdapter, keyring, {
      user: READER,
      shareId: share.id,
      keyId: theirs.id,
      ticket: await ticket(READER, 'swap', {
        keyId: theirs.id,
        shareId: share.id,
      }),
      via: 'window',
    });
    let [binding] = await dbAdapter.execute(
      `SELECT interactive FROM key_bindings WHERE id = $1`,
      { bind: [bindingId] },
    );
    assert.true(Boolean(binding.interactive));
    let [last] = await dbAdapter.execute(
      `SELECT action, interactive FROM key_binding_approvals WHERE binding_id = $1 ORDER BY at DESC LIMIT 1`,
      { bind: [bindingId] },
    );
    assert.deepEqual(
      [last.action, Boolean(last.interactive)],
      ['re-approved', true],
    );
    let call = await fromBrowser(READER, onTeamFeed());
    assert.strictEqual(call.status, 200, JSON.stringify(call.body));
    assert.strictEqual(
      vendor.requests[vendor.requests.length - 1].headers.authorization,
      `Bearer ${OTHER_VALUE}`,
    );
  });
});
