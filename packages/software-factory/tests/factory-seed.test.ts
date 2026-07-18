import QUnit from 'qunit';
const { module, test } = QUnit;

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import {
  createSeedIssue,
  linkProjectToSeedIssue,
} from '../src/factory-seed.ts';
import type { FactoryBrief } from '../src/factory-brief.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

const REALM = 'https://realms.example.test/me/proj/';
const DARKFACTORY = 'https://realms.example.test/software-factory/darkfactory';
const SEED_ISSUE_FILE = 'Issues/bootstrap-seed.json';

function seedIssueDocument() {
  return {
    data: {
      type: 'card',
      attributes: {
        issueId: 'BOOT-1',
        status: 'done',
        issueType: 'bootstrap',
      },
      meta: { adoptsFrom: { module: DARKFACTORY, name: 'Issue' } },
    },
  };
}

function clientFindingProjects(
  projects: Record<string, unknown>[],
  capture?: (realmUrls: unknown, query: Record<string, unknown>) => void,
): BoxelCLIClient {
  return {
    search: async (realmUrls: unknown, query: Record<string, unknown>) => {
      capture?.(realmUrls, query);
      return { ok: true, data: projects };
    },
  } as unknown as BoxelCLIClient;
}

module('factory-seed > linkProjectToSeedIssue', function (hooks) {
  let workspace: ReturnType<typeof createTestWorkspace>;

  hooks.beforeEach(function () {
    workspace = createTestWorkspace();
    workspace.write(
      SEED_ISSUE_FILE,
      JSON.stringify(seedIssueDocument(), null, 2),
    );
  });

  hooks.afterEach(function () {
    workspace.cleanup();
  });

  test('patches the seed issue project link to the found Project', async function (assert) {
    let capturedQuery: Record<string, unknown> | undefined;
    let modified = await linkProjectToSeedIssue({
      client: clientFindingProjects(
        [{ id: `${REALM}Projects/sticky-note` }],
        (_realms, query) => {
          capturedQuery = query;
        },
      ),
      realmUrl: REALM,
      workspaceDir: workspace.dir,
      darkfactoryModuleUrl: DARKFACTORY,
    });

    assert.true(modified, 'reports the seed issue was modified');
    // Searches for Project in the sibling issue-tracker module.
    assert.deepEqual(capturedQuery?.filter, {
      type: {
        module: 'https://realms.example.test/software-factory/issue-tracker',
        name: 'Project',
      },
    });

    let seed = JSON.parse(workspace.read(SEED_ISSUE_FILE));
    assert.deepEqual(
      seed.data.relationships.project,
      { links: { self: '../Projects/sticky-note' } },
      'project link is relative to the seed issue directory',
    );
    // Existing attributes are preserved.
    assert.strictEqual(seed.data.attributes.issueId, 'BOOT-1');
    assert.strictEqual(seed.data.attributes.status, 'done');
  });

  test('is a no-op when no Project exists yet', async function (assert) {
    let modified = await linkProjectToSeedIssue({
      client: clientFindingProjects([]),
      realmUrl: REALM,
      workspaceDir: workspace.dir,
      darkfactoryModuleUrl: DARKFACTORY,
    });

    assert.false(modified, 'reports no modification');
    let seed = JSON.parse(workspace.read(SEED_ISSUE_FILE));
    assert.strictEqual(
      seed.data.relationships,
      undefined,
      'project link stays unset',
    );
  });

  test('is idempotent when the project link is already correct', async function (assert) {
    let options = {
      client: clientFindingProjects([{ id: `${REALM}Projects/sticky-note` }]),
      realmUrl: REALM,
      workspaceDir: workspace.dir,
      darkfactoryModuleUrl: DARKFACTORY,
    };

    assert.true(await linkProjectToSeedIssue(options), 'first run links');
    assert.false(
      await linkProjectToSeedIssue(options),
      'second run is a no-op once the link is set',
    );
  });
});

const ANALYSIS_ISSUE_FILE = 'Issues/port-analysis-seed.json';
const DESIGN_FOUNDATION_ISSUE_FILE = 'Issues/design-foundation-seed.json';

function portBrief(repoUrl: string): FactoryBrief {
  return {
    title: `Port: ${repoUrl.split('/').pop() ?? 'app'}`,
    sourceUrl: repoUrl,
    content: `# Port ${repoUrl}`,
    contentSummary: 'A GitHub app to port to Boxel.',
    tags: [],
    githubRepoUrl: repoUrl,
  };
}

/** A seed card as a prior turn would leave it once completed. */
function doneSeed(issueId: string, identityToken: string) {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          issueId,
          status: 'done',
          // The URL the resume guard keys on lives in the summary verbatim.
          summary: `Done: ${identityToken}`,
        },
        meta: { adoptsFrom: { module: DARKFACTORY, name: 'Issue' } },
      },
    },
    null,
    2,
  );
}

function statusOf(workspace: ReturnType<typeof createTestWorkspace>, file: string) {
  return JSON.parse(workspace.read(file)).data.attributes.status;
}

module('factory-seed > createSeedIssue resume guard', function (hooks) {
  let workspace: ReturnType<typeof createTestWorkspace>;
  const REPO = 'https://github.com/acme/wardrobe';

  hooks.beforeEach(function () {
    workspace = createTestWorkspace();
  });
  hooks.afterEach(function () {
    workspace.cleanup();
  });

  test('a fresh workspace arms analysis, bootstrap, and design-foundation at backlog', async function (assert) {
    let result = await createSeedIssue(portBrief(REPO), {
      darkfactoryModuleUrl: DARKFACTORY,
      workspaceDir: workspace.dir,
      designFoundation: true,
    });

    assert.strictEqual(result.status, 'created', 'bootstrap freshly created');
    assert.strictEqual(
      statusOf(workspace, ANALYSIS_ISSUE_FILE),
      'backlog',
      'analysis armed',
    );
    assert.strictEqual(
      statusOf(workspace, SEED_ISSUE_FILE),
      'backlog',
      'bootstrap armed',
    );
    assert.strictEqual(
      statusOf(workspace, DESIGN_FOUNDATION_ISSUE_FILE),
      'backlog',
      'design-foundation armed',
    );
  });

  test('a restart on the SAME brief leaves done seeds intact (resume, not re-arm)', async function (assert) {
    // Simulate the control-realm pull: prior turn's completed seeds are here.
    workspace.write(ANALYSIS_ISSUE_FILE, doneSeed('PORT-0', REPO));
    workspace.write(SEED_ISSUE_FILE, doneSeed('BOOT-1', REPO));
    workspace.write(DESIGN_FOUNDATION_ISSUE_FILE, doneSeed('DESIGN-0', REPO));

    let result = await createSeedIssue(portBrief(REPO), {
      darkfactoryModuleUrl: DARKFACTORY,
      workspaceDir: workspace.dir,
      designFoundation: true,
    });

    assert.strictEqual(result.status, 'existing', 'bootstrap not re-armed');
    assert.strictEqual(
      statusOf(workspace, ANALYSIS_ISSUE_FILE),
      'done',
      'analysis stays done — no repo re-study',
    );
    assert.strictEqual(
      statusOf(workspace, SEED_ISSUE_FILE),
      'done',
      'bootstrap stays done',
    );
    assert.strictEqual(
      statusOf(workspace, DESIGN_FOUNDATION_ISSUE_FILE),
      'done',
      'design-foundation stays done',
    );
  });

  test('a restart with a DIFFERENT brief re-arms the stale done seeds', async function (assert) {
    // Done seeds left by a PRIOR brief (different repo) must not be resumed.
    let priorRepo = 'https://github.com/acme/old-thing';
    workspace.write(ANALYSIS_ISSUE_FILE, doneSeed('PORT-0', priorRepo));
    workspace.write(SEED_ISSUE_FILE, doneSeed('BOOT-1', priorRepo));

    let result = await createSeedIssue(portBrief(REPO), {
      darkfactoryModuleUrl: DARKFACTORY,
      workspaceDir: workspace.dir,
    });

    assert.strictEqual(result.status, 'created', 'bootstrap re-armed');
    assert.strictEqual(
      statusOf(workspace, ANALYSIS_ISSUE_FILE),
      'backlog',
      'analysis re-armed for the new brief',
    );
    assert.strictEqual(
      statusOf(workspace, SEED_ISSUE_FILE),
      'backlog',
      'bootstrap re-armed for the new brief',
    );
  });
});
