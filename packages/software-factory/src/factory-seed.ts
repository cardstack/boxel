/**
 * Seed issue creation for the issue-driven agentic loop.
 *
 * Writes a single "bootstrap" issue to the local factory workspace that
 * the agent picks up as its first task once the orchestrator syncs the
 * workspace into the target realm. The agent reads the brief, creates
 * Project, IssueTracker, KnowledgeArticle, and implementation Issue
 * cards, then marks the seed issue as done.
 */

import { posix } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import type { FactoryBrief } from './factory-brief.ts';

import { logger } from './logger.ts';
import {
  inferIssueTrackerModuleUrl,
  linkRelationshipToCard,
  toRealmRelativePath,
} from './realm-operations.ts';
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
const ANALYSIS_ISSUE_PATH = 'Issues/port-analysis-seed';
const ANALYSIS_ISSUE_FILE = `${ANALYSIS_ISSUE_PATH}.json`;

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
  //
  // LOCAL PATCH (CS-12192): the seed path is a realm-wide constant, so a
  // second `factory:go` against an already-bootstrapped realm would find the
  // *previous* run's stale seed here and short-circuit — silently ignoring
  // the new brief. For this workspace's sequential multi-brief pass we instead
  // OVERWRITE the seed with the current brief every time, so each run bootstraps
  // its own brief. `buildSeedIssueDocument` stamps status=backlog, so a seed
  // left `done`/`blocked` by a prior run is re-armed. Not an upstream change.
  let existing = await readCard(workspaceDir, SEED_ISSUE_FILE);
  // Anything other than "found" or "file missing" is a real problem — surface it.
  if (!existing.ok && existing.status !== 404) {
    throw new Error(
      `Failed to check for existing seed issue: ${existing.error ?? 'unknown error'}`,
    );
  }

  let document = buildSeedIssueDocument(brief, darkfactoryModuleUrl);

  // GitHub-port flow (v3): a PORT-ANALYSIS issue runs before bootstrap —
  // it studies the source repo (README, screenshots, demo media, code
  // layout) and writes the port-background Knowledge Article that
  // bootstrap plans the card family from. Bootstrap is blockedBy it.
  if (brief.githubRepoUrl) {
    let analysisDocument = buildAnalysisSeedIssueDocument(
      brief,
      darkfactoryModuleUrl,
    );
    let analysisWrite = await writeCard(
      workspaceDir,
      ANALYSIS_ISSUE_FILE,
      JSON.stringify(analysisDocument, null, 2),
    );
    if (!analysisWrite.ok) {
      throw new Error(
        `Failed to create port-analysis seed issue: ${analysisWrite.error ?? 'unknown error'}`,
      );
    }
    log.info(`Port-analysis seed issue created: ${ANALYSIS_ISSUE_PATH}`);
  }

  log.info(
    existing.ok
      ? `Overwriting existing seed issue at ${SEED_ISSUE_FILE} with current brief`
      : `Creating seed issue at ${SEED_ISSUE_FILE}`,
  );
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

  log.info(
    existing.ok
      ? `Seed issue overwritten: ${SEED_ISSUE_PATH}`
      : `Seed issue created: ${SEED_ISSUE_PATH}`,
  );
  return { issueId: SEED_ISSUE_PATH, status: 'created' };
}

// ---------------------------------------------------------------------------
// Post-bootstrap project link
// ---------------------------------------------------------------------------

export interface LinkProjectToSeedIssueOptions {
  client: BoxelCLIClient;
  realmUrl: string;
  workspaceDir: string;
  /** From `inferDarkfactoryModuleUrl(realmUrl)`. */
  darkfactoryModuleUrl: string;
  /**
   * How many times to retry the Project search when it comes back empty.
   * The Project is synced to the realm fire-and-forget (no `waitForIndex`),
   * so an empty result can just mean the indexer hasn't caught up. The
   * post-loop backstop sets this so a fast run doesn't permanently leave the
   * seed issue's project link unset; the in-loop hook leaves it at the
   * default 0 — the backstop is its safety net.
   */
  searchRetries?: number;
  /** Delay between empty-result retries. Defaults to `SEARCH_RETRY_DELAY_MS`. */
  searchRetryDelayMs?: number;
}

/**
 * Point the bootstrap seed issue's `project` relationship at the Project the
 * bootstrap issue created, once it exists in the realm.
 *
 * The seed issue is written before the loop runs, when no Project exists yet,
 * so it starts with no `project` link. After the bootstrap issue creates and
 * syncs a Project, this finds it and patches the workspace seed issue in
 * place. Returns `true` when it modified the issue so the caller can sync; a
 * no-op (no Project indexed, the seed issue missing, or the link already
 * correct) returns `false`.
 */
export async function linkProjectToSeedIssue(
  options: LinkProjectToSeedIssueOptions,
): Promise<boolean> {
  let { client, realmUrl, workspaceDir, darkfactoryModuleUrl } = options;
  let issueTrackerModuleUrl = inferIssueTrackerModuleUrl(darkfactoryModuleUrl);

  return linkRelationshipToCard({
    client,
    realmUrl,
    workspaceDir,
    cardFile: SEED_ISSUE_FILE,
    relationshipKey: 'project',
    targetLabel: 'Project',
    search: () =>
      client.search(realmUrl, {
        filter: { type: { module: issueTrackerModuleUrl, name: 'Project' } },
        // One Project per bootstrapped realm; newest-first so a re-run that
        // somehow produced more than one links the most recently created
        // (the default first-id selection then takes the newest).
        sort: [{ by: 'lastModified', direction: 'desc' as const }],
      }),
    // The `self` link is relative to the seed issue's directory, matching how
    // the agent encodes implementation-issue project links (`../Projects/<slug>`).
    buildLink: (id, realm) =>
      posix.relative(
        posix.dirname(SEED_ISSUE_PATH),
        toRealmRelativePath(id, realm),
      ),
    log,
    searchRetries: options.searchRetries,
    searchRetryDelayMs: options.searchRetryDelayMs,
  });
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

  let port = Boolean(brief.githubRepoUrl);
  let portNote = port
    ? [
        `## Port background (read first)`,
        ``,
        `A PORT-ANALYSIS issue ran before this one. Its output — the`,
        `port-background Knowledge Article linked on this issue via`,
        `\`relatedKnowledge\` — is the AUTHORITATIVE background for this`,
        `port: feature inventory, screen catalogue, inferred data model,`,
        `UX flows, and the "better than the original" rubric. Plan the`,
        `card family from THAT article, not just the README excerpt above.`,
        `Carry the rubric into the Project's success criteria and each`,
        `implementation issue's acceptance criteria.`,
        ``,
      ]
    : [];

  let description = [...briefHeader, ...portNote, ...instructions].join('\n');

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
        order: port ? 1 : 0,
        acceptanceCriteria,
        createdAt: now,
        updatedAt: now,
      },
      // Under the port flow, bootstrap waits for the analysis issue.
      ...(port
        ? {
            relationships: {
              'blockedBy.0': {
                links: { self: `../${ANALYSIS_ISSUE_PATH}` },
              },
            },
          }
        : {}),
      meta: {
        adoptsFrom: {
          module: darkfactoryModuleUrl,
          name: 'Issue',
        },
      },
    },
  };
}

/**
 * The PORT-ANALYSIS seed issue (v3 GitHub-port flow). The prompt template
 * `issue-analysis.md` carries the full research protocol; the issue
 * description carries the repo pointer and the acceptance contract.
 */
function buildAnalysisSeedIssueDocument(
  brief: FactoryBrief,
  darkfactoryModuleUrl: string,
) {
  let now = new Date().toISOString();
  let description = [
    `## Source application to analyze`,
    ``,
    `**Repository:** ${brief.githubRepoUrl}`,
    `**Working title:** ${brief.title}`,
    `**One-liner:** ${brief.contentSummary}`,
    ``,
    `Fully analyze this GitHub repository — README, screenshots, demo`,
    `GIFs/videos, and source layout — and write the PORT BACKGROUND:`,
    `the document a team would need to build a Boxel-native version that`,
    `is BETTER than the original. Deliverables: a`,
    `\`Knowledge Articles/port-background.json\` Knowledge Article, linked`,
    `onto the bootstrap seed issue via \`relatedKnowledge\`.`,
    ``,
    `The full research protocol is in your turn instructions.`,
  ].join('\n');

  let acceptanceCriteria = [
    '- [ ] README and repository file tree analyzed (not just skimmed)',
    '- [ ] Every screenshot/GIF/video referenced by the README downloaded and READ (or explicitly listed as unviewable with why)',
    '- [ ] Feature inventory: every user-facing capability, named and described',
    '- [ ] Screen catalogue: each view/screen with what it shows and its key affordances',
    '- [ ] Inferred data model: entities, fields, relationships',
    '- [ ] "Better than the original" rubric: measurable criteria the Boxel port must beat',
    '- [ ] Boxel port mapping: proposed card family (CardDefs + links) with per-card format notes',
    '- [ ] Knowledge Article written and linked to the bootstrap issue via relatedKnowledge',
  ].join('\n');

  return {
    data: {
      type: 'card' as const,
      attributes: {
        issueId: 'PORT-0',
        summary: `Analyze ${brief.githubRepoUrl} and write the port background`,
        description,
        issueType: 'analysis',
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
