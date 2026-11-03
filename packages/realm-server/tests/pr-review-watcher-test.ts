import QUnit from 'qunit';
const { module, test } = QUnit;
import { readFileSync } from 'fs';
import { basename, join } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import { createJWT, setupPermissionedRealmCached } from './helpers/index.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
  type SecretsKeyring,
} from '../lib/secrets-at-rest/index.ts';
import { addUserKey, mintKeyWriteTicket } from '../lib/user-keys.ts';
import {
  arrange,
  authoredBy,
  choicesOf,
  commentCount,
  waitingOnReviewBy,
  type PullRequestNode,
} from '../../experiments-realm/pr-review-watcher/review-state.ts';

// ============================================================================
// The PR review watcher example card in the experiments realm: how it decides
// which pull requests are waiting on whom, and its two GitHub operations end
// to end, each person with their own key, against the stub vendor's
// GitHub-shaped GraphQL endpoint. The card module is the experiments realm's
// own, read from disk with GitHub's address swapped for the stub's.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/pr-review-watcher-test/');
const secureOriginURL = new URL('https://secure.pr-review-watcher.test/secure');
const VENDOR_PORT = 4534;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const VIEWER = '@watcher-viewer:localhost';
const SECOND = '@watcher-second:localhost';
const REALM_USER = '@node-test_realm:localhost';
const VIEWER_TOKEN = 'ghp-watcher-viewer-token-5d20c1';
const SECOND_TOKEN = 'ghp-watcher-second-token-81fa3e';
const WATCHER = {
  module: rri(`${realmURL.href}pr-review-watcher`),
  name: 'PRReviewWatcher',
};

const experimentsRealm = join(
  import.meta.dirname,
  '..',
  '..',
  'experiments-realm',
);

function watcherModule() {
  let source = readFileSync(
    join(experimentsRealm, 'pr-review-watcher.gts'),
    'utf8',
  );
  let pointed = source.replace(
    "'https://api.github.com/graphql'",
    `'${VENDOR}/graphql'`,
  );
  if (pointed === source) {
    throw new Error('the watcher no longer names GitHub’s GraphQL address');
  }
  return pointed;
}

function watcherCard(): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: { org: 'cardstack', team: 'boxel-developers' },
      meta: { adoptsFrom: WATCHER },
    },
  };
}

// ---------------------------------------------------------------------------
// Pull requests as the watcher's query returns them.

const user = (login: string) => ({ __typename: 'User', login });
const bot = (login: string) => ({ __typename: 'Bot', login });
const TEAM = 'cardstack/boxel-developers';

function pr(
  number: number,
  {
    author = 'octo-author',
    isDraft = false,
    requests = [] as { at: string; user?: string; team?: string }[],
    opinions = [] as { state: string; by: string }[],
    comments = [] as ReturnType<typeof user>[],
    reviews = [] as {
      state: string;
      by: ReturnType<typeof user>;
      lines: number;
    }[],
  } = {},
): PullRequestNode {
  return {
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/cardstack/boxel/pull/${number}`,
    isDraft,
    createdAt: '2026-10-01T00:00:00Z',
    repository: { nameWithOwner: 'cardstack/boxel' },
    author: user(author),
    timelineItems: {
      nodes: requests.map((r) => ({
        createdAt: r.at,
        requestedReviewer: r.user
          ? user(r.user)
          : { __typename: 'Team', combinedSlug: r.team },
      })),
    },
    latestOpinionatedReviews: {
      nodes: opinions.map((o) => ({ state: o.state, author: user(o.by) })),
    },
    comments: { nodes: comments.map((author) => ({ author })) },
    reviews: {
      nodes: reviews.map((r) => ({
        state: r.state,
        author: r.by,
        comments: { totalCount: r.lines },
      })),
    },
  };
}

module(basename(import.meta.filename), function () {
  module('which pull requests are waiting on whom', function () {
    test("a team request stays after GitHub drops the team from the PR's requested reviewers, until someone approves", function (assert) {
      // GitHub drops the team as a requested reviewer once a member reviews; the
      // request is still in the PR's history, which is what the watcher reads.
      let commented = pr(1, {
        requests: [{ at: '2026-10-02T00:00:00Z', team: TEAM }],
        reviews: [{ state: 'COMMENTED', by: user('octo-reviewer'), lines: 2 }],
      });
      let approved = pr(2, {
        requests: [{ at: '2026-10-02T00:00:00Z', team: TEAM }],
        opinions: [{ state: 'APPROVED', by: 'octo-reviewer' }],
      });
      let otherTeam = pr(3, {
        requests: [{ at: '2026-10-02T00:00:00Z', team: 'cardstack/infra' }],
      });
      let waiting = waitingOnReviewBy(
        [commented, approved, otherTeam],
        'octo-viewer',
        TEAM,
      );
      assert.deepEqual(
        waiting.map((p) => p.number),
        [1],
        'the commented one stays; the approved one and another team’s go',
      );
      assert.deepEqual(waiting[0].requested, {
        at: '2026-10-02T00:00:00Z',
        from: TEAM,
      });
    });

    test('a direct request is sticky the same way, and the longest waiting comes first', function (assert) {
      let older = pr(4, {
        requests: [
          { at: '2026-10-01T00:00:00Z', user: 'octo-second' },
          { at: '2026-10-03T00:00:00Z', user: 'octo-viewer' },
        ],
      });
      let newer = pr(5, {
        isDraft: true,
        requests: [{ at: '2026-10-05T00:00:00Z', user: 'Octo-Viewer' }],
      });
      let own = pr(6, {
        author: 'octo-viewer',
        requests: [{ at: '2026-10-01T00:00:00Z', team: TEAM }],
      });
      let waiting = waitingOnReviewBy([newer, older, own], 'octo-viewer', TEAM);
      assert.deepEqual(
        waiting.map((p) => [p.number, p.requested?.at, p.isDraft]),
        [
          [4, '2026-10-03T00:00:00Z', false],
          [5, '2026-10-05T00:00:00Z', true],
        ],
        "the viewer's own PR is not waiting on them; a draft that asked is listed, marked; logins match whatever their case",
      );
    });

    test('changes requested and approvals read each reviewer’s latest opinion, the author’s own and bots’ left out', function (assert) {
      let [mine] = authoredBy(
        [
          pr(7, {
            author: 'octo-viewer',
            requests: [{ at: '2026-10-02T00:00:00Z', team: TEAM }],
            opinions: [
              { state: 'APPROVED', by: 'octo-reviewer' },
              { state: 'CHANGES_REQUESTED', by: 'octo-critic' },
              { state: 'APPROVED', by: 'octo-viewer' },
            ],
          }),
        ],
        'octo-viewer',
      );
      assert.deepEqual(mine.approvedBy, ['octo-reviewer']);
      assert.deepEqual(mine.changesRequestedBy, ['octo-critic']);
    });

    test('comments count conversation and review comments by people other than the author, bots excluded', function (assert) {
      let count = commentCount(
        pr(8, {
          author: 'octo-viewer',
          comments: [
            user('octo-reviewer'),
            user('octo-viewer'),
            bot('github-actions'),
          ],
          reviews: [
            { state: 'COMMENTED', by: user('octo-critic'), lines: 3 },
            // A review that left only its summary.
            { state: 'COMMENTED', by: user('octo-reviewer'), lines: 0 },
            { state: 'APPROVED', by: user('octo-reviewer'), lines: 0 },
            { state: 'COMMENTED', by: user('octo-viewer'), lines: 4 },
            { state: 'COMMENTED', by: bot('copilot'), lines: 5 },
          ],
        }),
      );
      assert.strictEqual(
        count,
        5,
        'one conversation comment, three line comments and one review summary',
      );
    });

    test('my PRs: every open one, drafts included, nobody asked to review last', function (assert) {
      let mine = authoredBy(
        [
          pr(9, { author: 'octo-viewer', isDraft: true }),
          pr(10, {
            author: 'octo-viewer',
            requests: [{ at: '2026-10-04T00:00:00Z', team: TEAM }],
          }),
          pr(11, { author: 'octo-author' }),
        ],
        'octo-viewer',
      );
      assert.deepEqual(
        mine.map((p) => [p.number, p.isDraft, p.requested?.from]),
        [
          [10, false, TEAM],
          [9, true, undefined],
        ],
      );
    });
  });

  module('sorting and filtering a list', function () {
    let list = () =>
      authoredBy(
        [
          pr(20, {
            author: 'octo-viewer',
            requests: [{ at: '2026-10-03T00:00:00Z', team: TEAM }],
          }),
          pr(21, {
            author: 'octo-viewer',
            requests: [{ at: '2026-10-01T00:00:00Z', team: TEAM }],
          }),
          pr(22, { author: 'octo-viewer' }),
        ],
        'octo-viewer',
      );

    test('by request time either way, with nobody asked to review last both ways', function (assert) {
      assert.deepEqual(
        arrange(list(), { sortBy: 'requested', direction: 'asc' }).map(
          (p) => p.number,
        ),
        [21, 20, 22],
      );
      assert.deepEqual(
        arrange(list(), { sortBy: 'requested', direction: 'desc' }).map(
          (p) => p.number,
        ),
        [20, 21, 22],
      );
    });

    test('by author or repository, A to Z or Z to A, ties going to the longest waiting', function (assert) {
      let waiting = waitingOnReviewBy(
        [
          pr(30, {
            author: 'octo-builder',
            requests: [{ at: '2026-10-04T00:00:00Z', team: TEAM }],
          }),
          pr(31, {
            author: 'Octo-Author',
            requests: [{ at: '2026-10-05T00:00:00Z', team: TEAM }],
          }),
          pr(32, {
            author: 'octo-builder',
            requests: [{ at: '2026-10-02T00:00:00Z', team: TEAM }],
          }),
        ],
        'octo-viewer',
        TEAM,
      );
      assert.deepEqual(
        arrange(waiting, { sortBy: 'author', direction: 'asc' }).map(
          (p) => p.number,
        ),
        [31, 32, 30],
        'letter case does not split the order',
      );
      assert.deepEqual(
        arrange(waiting, { sortBy: 'author', direction: 'desc' }).map(
          (p) => p.number,
        ),
        [32, 30, 31],
      );
      assert.deepEqual(choicesOf(waiting, 'author'), [
        'Octo-Author',
        'octo-builder',
      ]);
    });

    test('filters by author and repository together', function (assert) {
      let other = {
        ...pr(40, {
          author: 'octo-builder',
          requests: [{ at: '2026-10-02T00:00:00Z', team: TEAM }],
        }),
        repository: { nameWithOwner: 'cardstack/boxel-skills' },
      };
      let waiting = waitingOnReviewBy(
        [
          pr(41, {
            author: 'octo-builder',
            requests: [{ at: '2026-10-01T00:00:00Z', team: TEAM }],
          }),
          other,
          pr(42, {
            author: 'octo-author',
            requests: [{ at: '2026-10-03T00:00:00Z', team: TEAM }],
          }),
        ],
        'octo-viewer',
        TEAM,
      );
      assert.deepEqual(choicesOf(waiting, 'repo'), [
        'cardstack/boxel',
        'cardstack/boxel-skills',
      ]);
      assert.deepEqual(
        arrange(waiting, {
          sortBy: 'requested',
          direction: 'asc',
          author: 'octo-builder',
          repo: 'cardstack/boxel',
        }).map((p) => p.number),
        [41],
      );
      assert.deepEqual(
        arrange(waiting, { sortBy: 'repo', direction: 'desc' }).map(
          (p) => p.number,
        ),
        [40, 41, 42],
      );
    });
  });

  module('against GitHub, each person with their own key', function (hooks) {
    let realm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
    let vendor: StubVendor;
    let keyring: SecretsKeyring;

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
        [VIEWER]: ['read', 'write'],
        [SECOND]: ['read', 'write'],
        [REALM_USER]: ['read', 'write', 'realm-owner'],
      },
      fileSystem: {
        'pr-review-watcher.gts': watcherModule(),
        'pr-review-watcher/review-state.ts': readFileSync(
          join(experimentsRealm, 'pr-review-watcher', 'review-state.ts'),
          'utf8',
        ),
        'cardstack.json': watcherCard(),
      },
      onRealmSetup(args) {
        realm = args.testRealm;
        request = args.request;
        dbAdapter = args.dbAdapter;
        vendor.requests.length = 0;
        vendor.graphqlAnswers.length = 0;
      },
    });

    async function addKey(owner: string, value: string) {
      let { ticket } = await mintKeyWriteTicket(dbAdapter, owner, {
        action: 'add',
        keyId: null,
        realmURL: null,
        shareId: null,
      });
      return await addUserKey(dbAdapter, keyring, {
        owner,
        name: 'GitHub',
        value,
        ticket,
      });
    }

    // What the secure window does when the person approves the watcher's
    // requests "On a schedule and when the card is opened": one approval for
    // both operations, with the fingerprints its preview showed.
    async function approveBoth(owner: string, keyId: string) {
      let operations = [];
      for (let name of ['waitingOnMyReview', 'myPullRequests']) {
        let shown = (
          await request
            .get('/_key-bindings/preview')
            .query({
              realm: realmURL.href,
              module: WATCHER.module,
              name: WATCHER.name,
              operation: name,
            })
            .set('Authorization', await secureSessionAuth(dbAdapter, owner))
        ).body.data.attributes as {
          slots: { slot: string; fingerprint: string }[];
        };
        operations.push({
          codeRef: WATCHER,
          operation: name,
          expectedDestination: `${VENDOR}/`,
          slots: Object.fromEntries(
            shown.slots.map((s) => [
              s.slot,
              { keyId, expectedFingerprint: s.fingerprint },
            ]),
          ),
        });
      }
      let approved = await request
        .post('/_key-bindings')
        .set('Authorization', await secureSessionAuth(dbAdapter, owner))
        .set('Origin', secureOriginURL.origin)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'key-binding-approval',
            attributes: { realm: realmURL.href, operations, interactive: true },
          },
        });
      if (approved.status !== 201) {
        throw new Error(
          `approving answered ${approved.status}: ${JSON.stringify(approved.body)}`,
        );
      }
    }

    // Invokes `name` on the watcher card as `user` from the card open in the
    // browser.
    async function fromCard(user: string, name: string) {
      let response = await request
        .post(`${realmURL.pathname}_operations`)
        .set('Accept', OPERATIONS)
        .set('Content-Type', OPERATIONS)
        .set(
          'Authorization',
          `Bearer ${createJWT(realm, user, ['read', 'write'])}`,
        )
        .send(
          JSON.stringify({
            'boxel:operations': [
              { op: 'invoke', 'boxel:name': name, href: '/cardstack' },
            ],
          }),
        );
      return {
        status: response.status,
        body: response.body,
        code: response.body?.errors?.[0]?.code as string | undefined,
      };
    }

    async function readiness(user: string) {
      let response = await request
        .post(`${realmURL.pathname}_capabilities`)
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set(
          'Authorization',
          `Bearer ${createJWT(realm, user, ['read', 'write'])}`,
        )
        .send({
          checks: [
            {
              target: `${realmURL.href}cardstack`,
              operation: 'waitingOnMyReview',
              readiness: true,
            },
          ],
        });
      return response.body.checks[0].readiness as string | undefined;
    }

    test('each person is asked for their own key, and their lists are fetched with it', async function (assert) {
      assert.strictEqual(
        await readiness(VIEWER),
        'needs-connect',
        'with no key yet, the card asks for one',
      );
      let viewersKey = await addKey(VIEWER, VIEWER_TOKEN);
      await approveBoth(VIEWER, viewersKey.id);
      assert.strictEqual(await readiness(VIEWER), 'ready');
      assert.strictEqual(
        await readiness(SECOND),
        'needs-connect',
        "the first person's approval does nothing for the second",
      );

      let refused = await fromCard(SECOND, 'waitingOnMyReview');
      assert.strictEqual(refused.code, 'binding-not-approved');
      assert.strictEqual(
        vendor.requests.length,
        0,
        'nothing was sent for the second person',
      );

      vendor.graphqlAnswers.push({
        status: 200,
        body: {
          data: {
            viewer: { login: 'octo-viewer' },
            search: { issueCount: 1, nodes: [pr(12)] },
          },
        },
      });
      let loaded = await fromCard(VIEWER, 'waitingOnMyReview');
      assert.strictEqual(loaded.status, 200, JSON.stringify(loaded.body));
      assert.true(
        JSON.stringify(loaded.body).includes('Pull request 12'),
        "GitHub's answer reaches the card",
      );
      let sent = vendor.requests[0];
      assert.strictEqual(sent.headers.authorization, `Bearer ${VIEWER_TOKEN}`);
      let { query, variables } = JSON.parse(sent.body);
      assert.true(
        query.includes('REVIEW_REQUESTED_EVENT'),
        "the query reads each PR's review requests from its history",
      );
      assert.strictEqual(
        variables.q,
        'is:pr is:open archived:false org:cardstack -author:@me sort:updated-desc',
        "the search is the card's own, as the token's owner",
      );

      let secondsKey = await addKey(SECOND, SECOND_TOKEN);
      await approveBoth(SECOND, secondsKey.id);
      await fromCard(SECOND, 'myPullRequests');
      let seconds = vendor.requests[1];
      assert.strictEqual(
        seconds.headers.authorization,
        `Bearer ${SECOND_TOKEN}`,
      );
      assert.strictEqual(
        JSON.parse(seconds.body).variables.q,
        'is:pr is:open archived:false org:cardstack author:@me sort:updated-desc',
      );
    });

    test('a revoked token stops the card with credential-rejected instead of returning GitHub’s 401 as data', async function (assert) {
      let key = await addKey(VIEWER, VIEWER_TOKEN);
      await approveBoth(VIEWER, key.id);
      vendor.graphqlAnswers.push({
        status: 401,
        body: { message: 'Bad credentials' },
      });
      let refused = await fromCard(VIEWER, 'waitingOnMyReview');
      assert.strictEqual(refused.status, 424, JSON.stringify(refused.body));
      assert.strictEqual(refused.code, 'credential-rejected');
      assert.false(
        JSON.stringify(refused.body).includes('Bad credentials'),
        "GitHub's refusal is not handed to the card",
      );
      assert.strictEqual(await readiness(VIEWER), 'credential-rejected');

      let held = await fromCard(VIEWER, 'myPullRequests');
      assert.strictEqual(
        held.code,
        'credential-rejected',
        'the other list is held back too, since it sends the same token there',
      );
      assert.strictEqual(
        vendor.requests.length,
        1,
        'and nothing more was sent',
      );
    });
  });
});
