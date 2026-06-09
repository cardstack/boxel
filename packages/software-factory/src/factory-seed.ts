/**
 * Seed issue creation for the issue-driven agentic loop.
 *
 * Writes a single "bootstrap" issue to the local factory workspace that
 * the agent picks up as its first task once the orchestrator syncs the
 * workspace into the target realm. The agent reads the brief, creates
 * Project, IssueTracker, KnowledgeArticle, and implementation Issue
 * cards, then marks the seed issue as done.
 */

import type { FactoryBrief } from './factory-brief.ts';

import { logger } from './logger.ts';
import { readCard, writeCard } from './workspace-fs.ts';

/**
 * Infer the darkfactory module URL from a target realm URL.
 * Uses the realm's origin to construct the URL.
 */
export function inferDarkfactoryModuleUrl(targetRealm: string): string {
  let parsed = new URL(targetRealm);
  return new URL('software-factory/darkfactory', parsed.origin + '/').href;
}

let log = logger('factory-seed');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeedIssueResult {
  issueId: string;
  status: 'created' | 'existing';
}

export interface SeedIssueOptions {
  darkfactoryModuleUrl: string;
  /**
   * Local workspace directory mirroring the target realm. The seed issue
   * is written here; the orchestrator syncs it to the realm before the
   * issue loop starts picking issues.
   */
  workspaceDir: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEED_ISSUE_PATH = 'Issues/bootstrap-seed';
const SEED_ISSUE_FILE = `${SEED_ISSUE_PATH}.json`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Create the bootstrap seed issue in the target realm.
 *
 * The seed issue is the entry point for the issue-driven loop. The agent
 * picks it up, reads the brief, and creates all project artifacts.
 *
 * Idempotent: if the seed issue already exists, returns `{ status: 'existing' }`.
 */
export async function createSeedIssue(
  brief: FactoryBrief,
  options: SeedIssueOptions,
): Promise<SeedIssueResult> {
  let { darkfactoryModuleUrl, workspaceDir } = options;

  // The factory entrypoint pulls the target realm into `workspaceDir`
  // before calling us, so a pre-existing seed shows up locally.
  let existing = await readCard(workspaceDir, SEED_ISSUE_FILE);
  if (existing.ok) {
    log.info(`Seed issue already exists at ${SEED_ISSUE_FILE}`);
    return { issueId: SEED_ISSUE_PATH, status: 'existing' };
  }

  // Anything other than "file missing" is a real problem — surface it.
  if (existing.status !== 404) {
    throw new Error(
      `Failed to check for existing seed issue: ${existing.error ?? 'unknown error'}`,
    );
  }

  let document = buildSeedIssueDocument(brief, darkfactoryModuleUrl);

  log.info(`Creating seed issue at ${SEED_ISSUE_FILE}`);
  let writeResult = await writeCard(
    workspaceDir,
    SEED_ISSUE_FILE,
    JSON.stringify(document, null, 2),
  );

  if (!writeResult.ok) {
    throw new Error(
      `Failed to create seed issue: ${writeResult.error ?? 'unknown error'}`,
    );
  }

  log.info(`Seed issue created: ${SEED_ISSUE_PATH}`);
  return { issueId: SEED_ISSUE_PATH, status: 'created' };
}

// ---------------------------------------------------------------------------
// Document builder
// ---------------------------------------------------------------------------

function buildSeedIssueDocument(
  brief: FactoryBrief,
  darkfactoryModuleUrl: string,
) {
  let now = new Date().toISOString();

  let description = [
    `## Brief`,
    ``,
    `**URL:** ${brief.sourceUrl}`,
    `**Title:** ${brief.title}`,
    `**Summary:** ${brief.contentSummary}`,
    ``,
    `### Full content`,
    ``,
    brief.content,
    ``,
    `## Instructions`,
    ``,
    `Read the brief above and create the following project artifacts in the workspace:`,
    ``,
    `1. **Project card** — \`Projects/<slug>.json\` with fields populated from the brief`,
    `2. **Issue Tracker Board** — \`Boards/<slug>.json\`, linked both ways with the Project card`,
    `3. **Knowledge Articles** — \`Knowledge Articles/<slug>-brief-context.json\` and \`Knowledge Articles/<slug>-agent-onboarding.json\`, plus more as the brief warrants`,
    `4. **Implementation Issues** — one per entry-point card at \`Issues/<slug>-<card-name-slug>.json\`, each covering:`,
    `   - Card definition (.gts) and any interior/support cards`,
    `   - QUnit tests (.test.gts) for entry-point and support cards`,
    `   - Catalog Spec (\`Spec/<card>.json\`) with example instances`,
    ``,
    `Each implementation issue must have:`,
    `- \`project\` relationship pointing to the Project card`,
    `- \`relatedKnowledge\` relationships pointing to the Knowledge Article cards`,
    `- \`blockedBy\` relationships to any prior issues it depends on`,
    ``,
    `Use the **\`Write\`** tool to create each \`.json\` file. When every artifact is on disk, call **\`signal_done\`** — the orchestrator marks this bootstrap issue done.`,
  ].join('\n');

  let acceptanceCriteria = [
    '- [ ] Project card created with objective, scope, and success criteria from the brief',
    '- [ ] IssueTracker card created and linked to the Project card',
    '- [ ] Knowledge Article for brief context created',
    '- [ ] Knowledge Article for agent onboarding created',
    '- [ ] Additional knowledge articles if the brief warrants them',
    '- [ ] One implementation issue per entry-point card (with tests, spec, and examples)',
    '- [ ] Implementation issues have project and relatedKnowledge relationships',
    '- [ ] Implementation issues have blockedBy relationships where appropriate',
    '- [ ] This bootstrap issue marked as done',
  ].join('\n');

  return {
    data: {
      type: 'card' as const,
      attributes: {
        issueId: 'BOOT-1',
        summary: 'Process brief and create project artifacts',
        description,
        issueType: 'bootstrap',
        status: 'backlog',
        priority: 'critical',
        order: 0,
        acceptanceCriteria,
        createdAt: now,
        updatedAt: now,
      },
      meta: {
        adoptsFrom: {
          module: darkfactoryModuleUrl,
          name: 'Issue',
        },
      },
    },
  };
}
