/**
 * Seed issue creation for the issue-driven agentic loop.
 *
 * Creates a single "bootstrap" issue in the target realm that the agent
 * picks up as its first task. The agent reads the brief, creates Project,
 * KnowledgeArticle, and implementation Issue cards, then marks the seed
 * issue as done.
 */

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
import {
  readFile,
  writeFile,
  waitForRealmFile,
  type RealmFetchOptions,
} from './realm-operations';

let log = logger('factory-seed');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeedIssueResult {
  issueId: string;
  status: 'created' | 'existing';
}

export interface SeedIssueOptions extends RealmFetchOptions {
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
  // Check if seed issue already exists
  let existing = await readFile(targetRealmUrl, SEED_ISSUE_PATH, options);
  if (existing.ok) {
    log.info(`Seed issue already exists at ${SEED_ISSUE_PATH}`);
    return { issueId: SEED_ISSUE_PATH, status: 'existing' };
  }

  let document = buildSeedIssueDocument(brief, options.darkfactoryModuleUrl);

  log.info(`Creating seed issue at ${SEED_ISSUE_FILE}`);
  let writeResult = await writeFile(
    targetRealmUrl,
    SEED_ISSUE_FILE,
    JSON.stringify(document, null, 2),
    options,
  );

  if (!writeResult.ok) {
    throw new Error(
      `Failed to create seed issue: ${writeResult.error ?? 'unknown error'}`,
    );
  }

  // Wait for the card to be indexed and readable
  let readable = await waitForRealmFile(targetRealmUrl, SEED_ISSUE_PATH, {
    ...options,
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
    `2. **Knowledge Articles** — in \`Knowledge Articles/\` for brief context and agent onboarding`,
    `3. **Implementation Issues** — in \`Issues/\` with proper ordering, dependencies, and relationships:`,
    `   - Issue #1: Create card definitions and tests for all cards the brief requires (priority: high, order: 1)`,
    `   - Issue #2: Create catalog specs with examples for entry point cards (priority: medium, order: 2, blockedBy: issue #1)`,
    ``,
    `Each implementation issue must have:`,
    `- \`project\` relationship pointing to the Project card`,
    `- \`relatedKnowledge\` relationships pointing to the Knowledge Article cards`,
    ``,
    `When all artifacts are created, mark this issue as done via \`update_issue\`.`,
  ].join('\n');

  let acceptanceCriteria = [
    '- [ ] Project card created with objective, scope, and success criteria from the brief',
    '- [ ] Knowledge Article for brief context created',
    '- [ ] Knowledge Article for agent onboarding created',
    '- [ ] Implementation issue #1: card definitions and tests for all cards',
    '- [ ] Implementation issue #2: catalog specs with examples for entry point cards',
    '- [ ] Implementation issues have project and relatedKnowledge relationships',
    '- [ ] Issue #2 has blockedBy relationship to issue #1',
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
