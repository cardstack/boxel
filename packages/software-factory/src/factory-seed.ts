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

// Phrases that read like "modify a card that already exists" rather than
// "build a new one". Kept deliberately narrow — these don't naturally appear
// in a greenfield "build a new X" brief, so a match on one of them while
// `sourceCardUrl` is unset is a strong signal the brief author meant to set it.
const ADJUST_PROSE_SIGNALS = [
  'adjust the existing',
  'adjust an existing',
  'adjusting the existing',
  'existing card',
  'rather than rebuild',
  'rather than build',
  'instead of rebuilding',
  'ingest-card',
  'source card',
];

function briefProseLooksLikeAdjust(brief: FactoryBrief): boolean {
  let text = `${brief.title}\n${brief.content}`.toLowerCase();
  return ADJUST_PROSE_SIGNALS.some((signal) => text.includes(signal));
}

/**
 * The factory's adjust-existing-card flow is triggered by the brief's
 * structured `sourceCardUrl` attribute, NOT by its prose. A brief that
 * describes adjusting an existing card only in prose but leaves `sourceCardUrl`
 * unset silently falls through to the greenfield path — the agent never
 * ingests the source and rebuilds from scratch. Return true when that mismatch
 * is detected so the caller can warn the operator. Exported for unit testing.
 */
export function shouldWarnMissingSourceCardUrl(brief: FactoryBrief): boolean {
  return !brief.sourceCardUrl && briefProseLooksLikeAdjust(brief);
}

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
  let adjust = Boolean(brief.sourceCardUrl);

  if (shouldWarnMissingSourceCardUrl(brief)) {
    log.warn(
      `Brief "${brief.title}" reads like an "adjust existing card" task but its ` +
        `\`sourceCardUrl\` attribute is unset — the factory will treat this as a ` +
        `greenfield build and the agent will NOT ingest a source card. Set the ` +
        `brief's \`sourceCardUrl\` to the absolute source card URL to trigger the ` +
        `adjust flow.`,
    );
  }

  let briefHeader = [
    `## Brief`,
    ``,
    `**URL:** ${brief.sourceUrl}`,
    `**Title:** ${brief.title}`,
    `**Summary:** ${brief.contentSummary}`,
    ...(adjust ? [`**Source card to adjust:** ${brief.sourceCardUrl}`] : []),
    ``,
    `### Full content`,
    ``,
    brief.content,
    ``,
  ];

  let { instructions, acceptanceCriteria, summary } = adjust
    ? adjustSeedInstructions(brief)
    : greenfieldSeedInstructions();

  let description = [...briefHeader, ...instructions].join('\n');

  return {
    data: {
      type: 'card' as const,
      attributes: {
        issueId: 'BOOT-1',
        summary,
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

function greenfieldSeedInstructions(): {
  instructions: string[];
  acceptanceCriteria: string;
  summary: string;
} {
  let instructions = [
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
  ];

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
    instructions,
    acceptanceCriteria,
    summary: 'Process brief and create project artifacts',
  };
}

function adjustSeedInstructions(brief: FactoryBrief): {
  instructions: string[];
  acceptanceCriteria: string;
  summary: string;
} {
  let instructions = [
    `## Mode: ADJUST EXISTING CARD`,
    ``,
    `This brief carries a \`sourceCardUrl\`, so you are **adjusting an existing**`,
    `card rather than building one from scratch. Follow the "Adjust flow"`,
    `section of the \`software-factory-bootstrap\` skill. The steps:`,
    ``,
    `1. **Project artifacts** — create the \`Project\`, \`IssueTracker\`, and`,
    `   \`Knowledge Articles\` exactly as in greenfield, from the brief above.`,
    `2. **Seed the source card** — \`${brief.sourceCardUrl}\` — and its`,
    `   same-realm dependency graph into the workspace with one command (run`,
    `   from inside the workspace dir; read-only from the source realm):`,
    `   \`\`\`bash`,
    `   boxel realm ingest-card "${brief.sourceCardUrl}" .`,
    `   \`\`\``,
    `   It copies the card's module, every same-realm module it imports`,
    `   (transitively, including type-only imports), its sample instances,`,
    `   and its card-level Catalog Spec — preserving realm-relative paths.`,
    `   Cross-realm imports (\`https://cardstack.com/base/...\`) and`,
    `   component/function Specs are intentionally left out.`,
    `   - **If the source card has no co-located test** (common for catalog`,
    `     cards), write **characterization tests** that capture its current`,
    `     behavior — field defaults, computed-field values, and key rendered`,
    `     output. These tests are what make the baseline green and what the`,
    `     adjustment must not regress; without them there is nothing to`,
    `     protect.`,
    `3. **Confirm a GREEN BASELINE** — after the seeded files are written,`,
    `   run \`run_parse\`, \`run_evaluate\`, \`run_instantiate\`, and`,
    `   \`run_tests\` against the seeded copy. The tools sync your workspace`,
    `   to the realm before checking, and a run that finds **nothing to`,
    `   check** (0 files / modules / instances / tests) comes back as an`,
    `   error, not a pass — it means the seed hasn't landed on the realm;`,
    `   re-run rather than treating it as green. All four must **pass with`,
    `   real coverage before you create any adjustment Issue** (\`run_tests\``,
    `   needs the co-located or characterization tests from step 2). If the`,
    `   baseline is not green, fix the seeded copy first; if it cannot be`,
    `   made green, \`request_clarification\` — do **not** proceed to`,
    `   adjustments on a red baseline.`,
    `4. **Provenance Knowledge Article** — record where the seed came from`,
    `   (the \`sourceCardUrl\`, which files were copied) in a`,
    `   \`Knowledge Articles/<slug>-source-provenance.json\`.`,
    `5. **Adjustment Issues** — create one Issue per coherent adjustment the`,
    `   brief describes, with **\`issueType\` \`adjustment\`** (not \`feature\`).`,
    `   Each adjustment Issue's \`description\` must name:`,
    `   - the workspace-relative **target file(s) to edit** (the seeded`,
    `     card and any support files the delta touches),`,
    `   - the **delta** — what changes, as a diff against the baseline, not`,
    `     a full card spec,`,
    `   - **acceptance** — the new expected behavior and its test`,
    `     assertions, **plus** that the pre-existing baseline tests keep`,
    `     passing (the delta must not regress the green baseline).`,
    ``,
    `Adjustments operate on the **seeded artifacts** — edit the existing`,
    `module, tests, sample instances, and Spec in place. Do not create new`,
    `modules, instances, or Specs alongside them unless the brief explicitly`,
    `asks for a new card.`,
    ``,
    `Each adjustment Issue must have a \`project\` relationship, the relevant`,
    `\`relatedKnowledge\` links (including the provenance article), and`,
    `\`blockedBy\` links where one delta depends on another.`,
    ``,
    `Use the **\`Write\`** tool for every \`.json\` and copied file. When the`,
    `baseline is green and all adjustment Issues are on disk, call`,
    `**\`signal_done\`** — the orchestrator marks this bootstrap issue done.`,
  ];

  let acceptanceCriteria = [
    '- [ ] Project card created with objective, scope, and success criteria from the brief',
    '- [ ] IssueTracker card created and linked to the Project card',
    '- [ ] Knowledge Articles for brief context and agent onboarding created',
    '- [ ] Source card + its same-realm dependency graph copied into the workspace (module, imported modules, instances, Spec)',
    '- [ ] Tests present on the seeded copy — the source card’s co-located tests, or characterization tests written here if it had none',
    '- [ ] Green baseline confirmed: parse, evaluate, instantiate, and tests all pass on the seeded copy BEFORE any adjustment issue is created',
    '- [ ] Source-provenance Knowledge Article created (sourceCardUrl + copied files)',
    '- [ ] One `adjustment` issue per coherent delta, each naming target file(s), the delta, and acceptance (incl. baseline tests still pass)',
    '- [ ] Adjustment issues have project and relatedKnowledge relationships, and blockedBy where appropriate',
    '- [ ] This bootstrap issue marked as done',
  ].join('\n');

  return {
    instructions,
    acceptanceCriteria,
    summary: 'Seed the source card and create adjustment issues',
  };
}
