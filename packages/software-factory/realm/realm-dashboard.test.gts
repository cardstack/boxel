import { module, test } from 'qunit';
import { click, waitFor } from '@ember/test-helpers';

import { setupApplicationTest } from '@cardstack/host/tests/helpers/setup';
import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
} from '@cardstack/host/tests/helpers';
import { setupMockMatrix } from '@cardstack/host/tests/helpers/mock-matrix';

// @ts-expect-error import.meta is ESM, not CJS
const importMetaUrl = import.meta.url;
const realmDashboardModule: string = new URL('./realm-dashboard', importMetaUrl)
  .href;
const issueTrackerModule: string = new URL('./issue-tracker', importMetaUrl)
  .href;

const projectId = `${testRealmURL}Projects/test-project`;
const boardId = `${testRealmURL}Boards/test-board`;
const cardsGridId = `${testRealmURL}cards-grid`;
const overviewId = `${testRealmURL}overview`;

function makeProject(
  projectStatus?: string,
): Record<string, Record<string, unknown>> {
  return {
    'Projects/test-project.json': {
      data: {
        type: 'card',
        attributes: {
          projectCode: 'PF',
          projectName: 'Platform Factory',
          ...(projectStatus !== undefined ? { projectStatus } : {}),
        },
        meta: { adoptsFrom: { module: issueTrackerModule, name: 'Project' } },
      },
    },
  };
}

function makeBoard(): Record<string, Record<string, unknown>> {
  return {
    'Boards/test-board.json': {
      data: {
        type: 'card',
        attributes: { boardTitle: 'Test Board' },
        relationships: { project: { links: { self: projectId } } },
        meta: {
          adoptsFrom: { module: issueTrackerModule, name: 'IssueTracker' },
        },
      },
    },
  };
}

function makeIssue(
  issueId: string,
  attrs: Record<string, string | null | undefined>,
  filename: string,
  // Extra relationships (e.g. blocked-by links) merged onto the issue.
  extraRelationships: Record<string, unknown> = {},
): Record<string, Record<string, unknown>> {
  return {
    [filename]: {
      data: {
        type: 'card',
        attributes: { issueId, summary: `${issueId} issue`, ...attrs },
        relationships: {
          project: { links: { self: projectId } },
          ...extraRelationships,
        },
        meta: { adoptsFrom: { module: issueTrackerModule, name: 'Issue' } },
      },
    },
  };
}

const knowledgeArticleModule = issueTrackerModule.replace(
  'issue-tracker',
  'knowledge-article',
);

function makeKnowledgeArticle(
  filename: string,
): Record<string, Record<string, unknown>> {
  return {
    [filename]: {
      data: {
        type: 'card',
        attributes: { articleTitle: 'Architecture', content: 'Notes.' },
        meta: {
          adoptsFrom: {
            module: knowledgeArticleModule,
            name: 'KnowledgeArticle',
          },
        },
      },
    },
  };
}

// A Project that links one knowledge article into its knowledgeBase, used to
// drive the "Seed the knowledge base" setup step to done.
function makeProjectWithKnowledge(
  projectStatus: string,
  knowledgeArticleId: string,
): Record<string, Record<string, unknown>> {
  return {
    'Projects/test-project.json': {
      data: {
        type: 'card',
        attributes: {
          projectCode: 'PF',
          projectName: 'Platform Factory',
          projectStatus,
        },
        relationships: {
          'knowledgeBase.0': { links: { self: knowledgeArticleId } },
        },
        meta: { adoptsFrom: { module: issueTrackerModule, name: 'Project' } },
      },
    },
  };
}

function makeCardsGrid(): Record<string, Record<string, unknown>> {
  return {
    'cards-grid.json': {
      data: {
        type: 'card',
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/cards-grid',
            name: 'CardsGrid',
          },
        },
      },
    },
  };
}

// The realm-index card under test. Pass `board`/`cardsGrid: false` to omit the
// link and exercise the empty states.
function makeRealmIndex(
  opts: { board?: boolean; cardsGrid?: boolean } = {},
): Record<string, Record<string, unknown>> {
  let { board = true, cardsGrid = true } = opts;
  return {
    'overview.json': {
      data: {
        type: 'card',
        attributes: {},
        relationships: {
          ...(board ? { board: { links: { self: boardId } } } : {}),
          ...(cardsGrid ? { cardsGrid: { links: { self: cardsGridId } } } : {}),
        },
        meta: {
          adoptsFrom: {
            module: realmDashboardModule,
            name: 'RealmDashboard',
          },
        },
      },
    },
  };
}

export function runTests() {
  module('Target Realm Index', function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);
    setupOnSave(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
    });

    // ── Populated overview ────────────────────────────────────────────────────
    // One realm with a representative issue set drives the KPI, Needs-Attention,
    // and funnel assertions so they share a single (expensive) realm setup.
    //   PF-1 backlog / high / feature
    //   PF-2 in_progress / high / bug
    //   PF-3 done / low / feature
    //   PF-4 blocked
    //   PF-5 backlog, blocked by PF-4 (dependency-blocked, not status-blocked)
    module('populated overview', function (hooks) {
      hooks.beforeEach(async function () {
        await setupAcceptanceTestRealm({
          realmURL: testRealmURL,
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeProject('active'),
            ...makeBoard(),
            ...makeCardsGrid(),
            ...makeIssue(
              'PF-1',
              { status: 'backlog', priority: 'high', issueType: 'feature' },
              'Issues/issue-1.json',
            ),
            ...makeIssue(
              'PF-2',
              { status: 'in_progress', priority: 'high', issueType: 'bug' },
              'Issues/issue-2.json',
            ),
            ...makeIssue(
              'PF-3',
              { status: 'done', priority: 'low', issueType: 'feature' },
              'Issues/issue-3.json',
            ),
            ...makeIssue('PF-4', { status: 'blocked' }, 'Issues/issue-4.json'),
            ...makeIssue('PF-5', { status: 'backlog' }, 'Issues/issue-5.json', {
              'blockedBy.0': {
                links: { self: `${testRealmURL}Issues/issue-4` },
              },
            }),
            ...makeRealmIndex(),
          },
        });
      });

      // Regression test for the Status KPI bug: the status was read through a
      // nested two-hop `linksTo` field path that never resolved, so it always
      // fell through to the hardcoded "Planning". It must now show the real
      // project status sourced through the loaded `project` link.
      test('Status KPI shows the real project status, not the "Planning" fallback', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: overviewId, format: 'isolated' }]],
        });
        await waitFor('[data-test-status-kpi]');

        assert
          .dom('[data-test-status-kpi]')
          .hasText('active', 'Status KPI reflects the linked project status');
        assert
          .dom('[data-test-status-kpi]')
          .doesNotContainText(
            'Planning',
            'does not fall through to the hardcoded placeholder',
          );
      });

      // KPIs, the Needs-Attention list, and the funnels all read the same
      // rendered overview, so they share one realm setup.
      test('overview widgets reflect the linked issues (KPIs, Needs Attention, funnels)', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: overviewId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issues-kpi]');

        assert
          .dom('[data-test-issues-kpi]')
          .hasText('5', 'all five linked issues are counted');
        assert
          .dom('[data-test-done-kpi]')
          .hasText('1', 'one done issue is counted');
        assert
          .dom('[data-test-blocked-kpi]')
          .hasText('2', 'status-blocked and dependency-blocked issues counted');

        // blockedIssues filters on status === 'blocked' OR blockedBy.length > 0.
        assert
          .dom('[data-test-blocked-issue]')
          .exists({ count: 2 }, 'two issues appear in Needs Attention');
        assert
          .dom('[data-test-blocked-issue="PF-4"]')
          .exists('blocked-by-status issue is listed');
        assert
          .dom('[data-test-blocked-issue="PF-5"]')
          .exists('issue with a blockedBy dependency is listed');
        assert
          .dom('[data-test-blocked-issue="PF-2"]')
          .doesNotExist('unblocked issue is excluded');

        // Funnels: count each bucket and omit buckets with zero issues.
        assert
          .dom(
            '[data-test-status-funnel] [data-test-funnel-row="backlog"] [data-test-funnel-count]',
          )
          .hasText('2', 'two backlog issues counted');
        assert
          .dom(
            '[data-test-status-funnel] [data-test-funnel-row="done"] [data-test-funnel-count]',
          )
          .hasText('1', 'one done issue counted');
        assert
          .dom('[data-test-status-funnel] [data-test-funnel-row="review"]')
          .doesNotExist('statuses with zero issues are omitted (count > 0)');

        assert
          .dom(
            '[data-test-priority-funnel] [data-test-funnel-row="high"] [data-test-funnel-count]',
          )
          .hasText('2', 'two high-priority issues counted');
        assert
          .dom(
            '[data-test-type-funnel] [data-test-funnel-row="feature"] [data-test-funnel-count]',
          )
          .hasText('2', 'two feature issues counted');
        assert
          .dom(
            '[data-test-type-funnel] [data-test-funnel-row="bug"] [data-test-funnel-count]',
          )
          .hasText('1', 'one bug issue counted');
      });
    });

    // ── Before bootstrap (no board / no cards grid) ───────────────────────────
    // The setup roadmap and both tab empty states share the same bare realm, so
    // a single test exercises all three against one setup.
    module('before bootstrap', function (hooks) {
      hooks.beforeEach(async function () {
        await setupAcceptanceTestRealm({
          realmURL: testRealmURL,
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeRealmIndex({ board: false, cardsGrid: false }),
          },
        });
      });

      test('Overview shows the roadmap (no KPIs); Board and Artifacts tabs show empty states', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: overviewId, format: 'isolated' }]],
        });
        await waitFor('[data-test-setup-steps]');

        assert
          .dom('[data-test-setup-steps]')
          .exists('the setup roadmap is shown while no project exists');
        assert
          .dom('[data-test-status-kpi]')
          .doesNotExist('KPIs are hidden until the project is bootstrapped');
        assert
          .dom('[data-test-setup-step="active"]')
          .exists('one step is marked active');

        await click('[data-test-tab-label="Board"]');
        await waitFor('[data-test-board-empty]');
        assert
          .dom('[data-test-board-empty]')
          .containsText('No board yet', 'board empty state is shown');

        await click('[data-test-tab-label="Artifacts"]');
        await waitFor('[data-test-artifacts-empty]');
        assert
          .dom('[data-test-artifacts-empty]')
          .containsText('No artifacts yet', 'artifacts empty state is shown');
      });
    });

    // ── Recent activity (recentIssues sort + cap) ─────────────────────────────
    module('recent activity', function (hooks) {
      hooks.beforeEach(async function () {
        // Eight issues with descending updatedAt, plus one with no updatedAt.
        // recentIssues sorts by updatedAt desc and caps at 8 — the undated
        // issue falls back to time 0, sorts last, and is dropped by the cap.
        let issues = {};
        for (let day = 1; day <= 8; day++) {
          let id = `PF-${String(day).padStart(2, '0')}`;
          Object.assign(
            issues,
            makeIssue(
              id,
              {
                status: 'in_progress',
                updatedAt: `2026-02-${String(day).padStart(2, '0')}T00:00:00.000Z`,
              },
              `Issues/issue-${day}.json`,
            ),
          );
        }
        Object.assign(
          issues,
          makeIssue(
            'PF-UNDATED',
            { status: 'backlog' },
            'Issues/issue-undated.json',
          ),
        );

        await setupAcceptanceTestRealm({
          realmURL: testRealmURL,
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeProject('active'),
            ...makeBoard(),
            ...makeCardsGrid(),
            ...issues,
            ...makeRealmIndex(),
          },
        });
      });

      test('Recent Activity lists the 8 newest issues, newest first, dropping the undated one', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: overviewId, format: 'isolated' }]],
        });
        await waitFor('[data-test-recent-list]');

        assert
          .dom('[data-test-recent-issue]')
          .exists({ count: 8 }, 'recentIssues is capped at 8 rows');

        let renderedOrder = [
          ...document.querySelectorAll('[data-test-recent-issue]'),
        ].map((el) => el.getAttribute('data-test-recent-issue'));
        assert.deepEqual(
          renderedOrder,
          [
            'PF-08',
            'PF-07',
            'PF-06',
            'PF-05',
            'PF-04',
            'PF-03',
            'PF-02',
            'PF-01',
          ],
          'issues are ordered by updatedAt descending',
        );

        assert
          .dom('[data-test-recent-issue="PF-UNDATED"]')
          .doesNotExist(
            'the issue with no updatedAt sorts last and is dropped by the cap',
          );
      });
    });

    // ── Setup roadmap state machine ───────────────────────────────────────────
    module('setup roadmap', function () {
      // Project exists but the knowledge base and backlog are still empty, so
      // the roadmap should read: realm + project done, knowledge active, backlog
      // upcoming.
      module('mid-bootstrap', function (hooks) {
        hooks.beforeEach(async function () {
          await setupAcceptanceTestRealm({
            realmURL: testRealmURL,
            mockMatrixUtils,
            contents: {
              ...SYSTEM_CARD_FIXTURE_CONTENTS,
              ...makeProject('active'),
              ...makeBoard(),
              ...makeRealmIndex({ cardsGrid: false }),
            },
          });
        });

        test('derives done/active/upcoming from live model state', async function (assert) {
          await visitOperatorMode({
            stacks: [[{ id: overviewId, format: 'isolated' }]],
          });
          await waitFor('[data-test-setup-steps]');

          assert
            .dom('[data-test-setup-step="done"]')
            .exists(
              { count: 2 },
              'realm-created and bootstrap-project steps are done',
            );
          assert
            .dom('[data-test-setup-step="active"]')
            .exists(
              { count: 1 },
              'exactly one step is active (seed knowledge)',
            );
          assert
            .dom('[data-test-setup-step="upcoming"]')
            .exists({ count: 1 }, 'the backlog step is still upcoming');
        });
      });

      // Project, knowledge, and issues all exist — every step is done, so the
      // whole setup panel retires even though not all issues are done. This
      // pins that setup is considered complete once the backlog is generated,
      // not once every issue is done.
      module('complete once backlog exists', function (hooks) {
        hooks.beforeEach(async function () {
          await setupAcceptanceTestRealm({
            realmURL: testRealmURL,
            mockMatrixUtils,
            contents: {
              ...SYSTEM_CARD_FIXTURE_CONTENTS,
              ...makeProjectWithKnowledge(
                'active',
                `${testRealmURL}Knowledge/architecture`,
              ),
              ...makeKnowledgeArticle('Knowledge/architecture.json'),
              ...makeBoard(),
              ...makeCardsGrid(),
              // Backlog generated but NOT all done (one open, one done).
              ...makeIssue(
                'PF-1',
                { status: 'backlog' },
                'Issues/issue-1.json',
              ),
              ...makeIssue('PF-2', { status: 'done' }, 'Issues/issue-2.json'),
              ...makeRealmIndex(),
            },
          });
        });

        test('setup panel retires once the backlog is generated, even with open issues', async function (assert) {
          await visitOperatorMode({
            stacks: [[{ id: overviewId, format: 'isolated' }]],
          });
          await waitFor('[data-test-overview]');
          await waitFor('[data-test-status-kpi]');

          assert
            .dom('[data-test-setup-steps]')
            .doesNotExist('the setup roadmap is gone once every step is done');
          assert
            .dom('[data-test-issues-kpi]')
            .hasText('2', 'KPIs render in the live overview');
        });
      });
    });
  });
}
