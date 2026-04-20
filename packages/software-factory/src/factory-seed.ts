/**
 * Seed issue creation for the issue-driven agentic loop.
 *
 * Creates a single "bootstrap" issue in the target realm that the agent
 * picks up as its first task. The agent reads the brief, creates Project,
 * KnowledgeArticle, and implementation Issue cards, then marks the seed
 * issue as done.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import type { FactoryBrief } from './factory-brief';

import { logger } from './logger';

/**
 * Infer the darkfactory module URL from a target realm URL.
 * Uses the realm's origin to construct the URL.
 */
export function inferDarkfactoryModuleUrl(targetRealmUrl: string): string {
  let parsed = new URL(targetRealmUrl);
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
  client: BoxelCLIClient;
  darkfactoryModuleUrl: string;
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
  targetRealmUrl: string,
  options: SeedIssueOptions,
): Promise<SeedIssueResult> {
  let { client, darkfactoryModuleUrl } = options;

  // Check if seed issue already exists
  let existing = await client.read(targetRealmUrl, SEED_ISSUE_PATH);
  if (existing.ok) {
    log.info(`Seed issue already exists at ${SEED_ISSUE_PATH}`);
    return { issueId: SEED_ISSUE_PATH, status: 'existing' };
  }

  // Only proceed to create if the read failed with 404 (not found).
  // Any other failure (auth, network, server error) should be surfaced —
  // including network errors where status is undefined.
  if (existing.status !== 404) {
    throw new Error(
      `Failed to check for existing seed issue: ${existing.error ?? `HTTP ${existing.status}`}`,
    );
  }

  let document = buildSeedIssueDocument(brief, darkfactoryModuleUrl);

  log.info(`Creating seed issue at ${SEED_ISSUE_FILE}`);
  let writeResult = await client.write(
    targetRealmUrl,
    SEED_ISSUE_FILE,
    JSON.stringify(document, null, 2),
  );

  if (!writeResult.ok) {
    throw new Error(
      `Failed to create seed issue: ${writeResult.error ?? 'unknown error'}`,
    );
  }

  // Wait for the card to be indexed and readable
  let readable = await client.waitForFile(targetRealmUrl, SEED_ISSUE_PATH, {
    timeoutMs: 15_000,
    pollMs: 250,
  });

  if (!readable) {
    throw new Error(
      `Seed issue written but not readable after 15s: ${SEED_ISSUE_PATH}`,
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
    ``,
    brief.contentSummary,
    ``,
    `## Instructions`,
    ``,
    `Read the brief and create the following project artifacts:`,
    ``,
    `1. **Project card** — in \`Projects/\` with fields populated from the brief`,
    `2. **Knowledge Articles** — in \`Knowledge Articles/\`, at least Brief Context + Agent Onboarding, plus more as the brief warrants`,
    `3. **Implementation Issues** — one per entry-point card, each covering:`,
    `   - Card definition (.gts) and any interior/support cards`,
    `   - QUnit tests (.test.gts) for entry-point and support cards`,
    `   - Catalog Spec (Spec/<card>.json) with example instances`,
    ``,
    `Each implementation issue must have:`,
    `- \`project\` relationship pointing to the Project card`,
    `- \`relatedKnowledge\` relationships pointing to the Knowledge Article cards`,
    `- \`blockedBy\` relationships to any prior issues it depends on`,
    ``,
    `When all artifacts are created, mark this issue as done via \`update_issue\`.`,
  ].join('\n');

  let acceptanceCriteria = [
    '- [ ] Project card created with objective, scope, and success criteria from the brief',
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
