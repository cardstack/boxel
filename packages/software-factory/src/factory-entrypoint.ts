import { parseArgs as parseNodeArgs } from 'node:util';

import { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import {
  ControlPlaneSync,
  ensureControlPlaneIgnoreFile,
  ensureScratchIgnoreFile,
} from './control-plane-sync.ts';
import {
  linkBoardToRealmIndex,
  writeRealmDashboardCard,
  type LinkBoardToRealmIndexOptions,
} from './factory-realm-index.ts';
import { inferDarkfactoryModuleUrl } from './factory-seed.ts';
import { initRunTrace, withSpan } from './run-trace.ts';
import {
  parseAgentFlag,
  type FactoryAgentProvider,
} from './factory-agent/index.ts';
import {
  loadFactoryBrief,
  loadGitHubBrief,
  type FactoryBrief,
} from './factory-brief.ts';
import { FactoryEntrypointUsageError } from './factory-entrypoint-errors.ts';
import {
  assertAgentProviderImplemented,
  runFactoryIssueLoop,
  type IssueLoopWiringConfig,
} from './factory-issue-loop-wiring.ts';
import {
  ANALYSIS_ISSUE_PATH,
  createSeedIssue,
  DESIGN_FOUNDATION_ISSUE_PATH,
  linkProjectToSeedIssue,
  type LinkProjectToSeedIssueOptions,
  type SeedIssueResult,
} from './factory-seed.ts';
import {
  bootstrapFactoryTargetRealm,
  resolveFactoryTargetRealm,
  type FactoryTargetRealmBootstrapResult,
  type FactoryTargetRealmResolution,
  type ResolveFactoryTargetRealmOptions,
} from './factory-target-realm.ts';
import type { IssueLoopResult } from './issue-loop.ts';
import { logger } from './logger.ts';
import { withStdoutRedirected } from './redirect-stdout.ts';
import {
  ensureWorkspaceDir,
  resetWorkspaceDir,
  resolveWorkspaceDir,
} from './workspace-fs.ts';

let log = logger('factory-entrypoint');

// Retries the post-loop backstop spends polling the realm index for the
// bootstrap board/Project before giving up. At the default ~1s delay this
// covers a few seconds of indexer lag after a fire-and-forget board sync.
const BOOTSTRAP_LINK_SEARCH_RETRIES = 5;

export interface FactoryEntrypointOptions {
  /**
   * A Boxel brief card URL — OUR authored content describing what to
   * build. Exactly one of `briefUrl` / `repoUrl` is required.
   */
  briefUrl?: string;
  /**
   * A GitHub repository URL for an inspired-by port (v3). The factory
   * synthesizes the brief from the repo and seeds a PORT-ANALYSIS issue
   * that digs into the repo's code — dependencies, specialized logic,
   * tests and fixtures — before bootstrap plans anything.
   */
  repoUrl?: string;
  targetRealm: string | null;
  /**
   * Control realm (v3 split): issues, tracker cards, validations, and the
   * run log live here; the target realm keeps only the built product.
   * Created if missing, like the target realm. Null = no split (v2
   * behavior — everything in the target realm).
   */
  controlRealm?: string | null;
  realmServerUrl: string | null;
  agent: FactoryAgentProvider;
  /** Only set when agent === 'openrouter' and the flag carried a `=<id>` suffix. */
  openRouterModel?: string;
  /**
   * OpenRouter API key for direct billing on the `--agent openrouter`
   * path. Read from `--openrouter-api-key <key>` or env
   * `OPENROUTER_API_KEY`. When unset, the OpenRouter path falls
   * through to the realm-server `/_openrouter/chat/completions`
   * passthrough (boxel tokens). Ignored on every other backend.
   */
  openRouterApiKey?: string;
  debug?: boolean;
  retryBlocked?: boolean;
  /**
   * Feature flag — when set, the boxel-ui-component-discovery skill is
   * loaded into the agent's system prompt and the system prompt's
   * catalog-search exception is enabled, so the agent must search the
   * catalog for boxel-ui Spec cards before writing UI in a .gts
   * template. When unset (default), the agent has no awareness of
   * boxel-ui components at all — neither the skill nor the system-prompt
   * exception is visible.
   *
   * Set via `--enable-boxel-ui-discovery` on the CLI.
   */
  enableBoxelUiDiscovery?: boolean;
  /** V2 lean/design-first mode (see factory-issue-loop-wiring). */
  v2?: boolean;
  /** Context forking: prime once per brief, fork every implementation turn. */
  forkContext?: boolean;
  /**
   * Execute factory-generated polish issues (the bootstrap's pass-2
   * `enhancement` scope) unattended. Default false: the loop leaves them
   * on the board awaiting operator approval.
   */
  includePolish?: boolean;
  /**
   * Model for fix iterations (inner iterations ≥ 2 — mechanical lint/parse
   * fix-ups). Defaults to `claude-sonnet-5` under --v2; pass `inherit` to
   * keep the session model for every turn.
   */
  fixModel?: string;
  /** Effort for fix iterations (low|medium|high|xhigh|max). Default `medium` under --v2. */
  fixEffort?: string;
  /**
   * Phase-split: run each implementation issue as a DESIGN turn
   * (flagship budget) + a BUILD turn (cheap budget) forked from the
   * design session. DEFAULT ON under --v2 (v3); `--no-phase-split`
   * opts out. Explicit `--phase-split` forces it on.
   */
  phaseSplit?: boolean;
  /**
   * Render gate + acceptance walkthrough (v3 P0): post-issue screenshot
   * capture via `_screenshot-card` and a verifier turn that reads the
   * PNGs, verdicts acceptance criteria, and files defect issues. Default
   * on under --v2; `--no-render-gate` opts out.
   */
  renderGate?: boolean;
  /** Model for phase-split build turns. Default `claude-sonnet-5`; `inherit` keeps the session model. */
  buildModel?: string;
  /** Effort for phase-split build turns. Default `medium`. */
  buildEffort?: string;
  /**
   * Model for the bootstrap turn (planning + tracker-card writing).
   * Defaults to `claude-sonnet-5` under --v2 — the turn's output is
   * mostly mechanical JSON; pass `inherit` to keep the session flagship.
   */
  bootstrapModel?: string;
  /** Effort for the bootstrap turn. Default `medium` under --v2. */
  bootstrapEffort?: string;
  /**
   * Model for the review turn (the PM gate after the render gate). By
   * default the review inherits the session flagship — cheap-tier reviews
   * shipped false verdicts, so downgrading is an explicit experiment, not
   * a default. Pass e.g. `claude-sonnet-5` to opt in; `inherit` is a
   * no-op.
   */
  reviewModel?: string;
  /** Effort for the review turn when --review-model is set. Default `medium`. */
  reviewEffort?: string;
  /**
   * Orchestrator monitor level (v3, requires --v2): quiet | normal |
   * verbose. Default `normal` — stall narration, per-turn telemetry,
   * scheduler notes, and sync failures on the run log.
   */
  monitorLevel?: 'quiet' | 'normal' | 'verbose';
}

export interface FactoryEntrypointAction {
  name: string;
  status: 'ok';
  detail: string;
}

export interface FactoryEntrypointBriefSummary extends FactoryBrief {
  url: string;
}

export interface FactoryEntrypointSeedSummary {
  seedIssueId: string;
  seedIssueStatus: SeedIssueResult['status'];
}

export interface FactoryEntrypointIssueLoopSummary {
  outcome: IssueLoopResult['outcome'];
  outerCycles: number;
  issueResults: {
    issueId: string;
    exitReason: string;
    innerIterations: number;
    toolCallCount: number;
  }[];
}

export interface FactoryEntrypointSummary {
  command: 'factory:go';
  brief: FactoryEntrypointBriefSummary;
  targetRealm: {
    url: string;
    ownerUsername: string;
  };
  seedIssue: FactoryEntrypointSeedSummary;
  actions: FactoryEntrypointAction[];
  issueLoop?: FactoryEntrypointIssueLoopSummary;
  result: {
    status: 'ready' | 'completed' | 'failed';
    nextStep: string;
  };
}

export interface RunFactoryEntrypointDependencies {
  fetch?: typeof globalThis.fetch;
  resolveTargetRealm?: (
    options: ResolveFactoryTargetRealmOptions,
  ) => FactoryTargetRealmResolution;
  bootstrapTargetRealm?: (
    resolution: FactoryTargetRealmResolution,
  ) => Promise<FactoryTargetRealmBootstrapResult>;
  createSeed?: (
    brief: FactoryBrief,
    options: {
      darkfactoryModuleUrl: string;
      workspaceDir: string;
    },
  ) => Promise<SeedIssueResult>;
  runIssueLoop?: (config: IssueLoopWiringConfig) => Promise<IssueLoopResult>;
  /**
   * Pull the target realm into the workspace. Tests stub this out so
   * they don't make real HTTP calls. Defaults to `client.pull`.
   */
  pullTargetRealm?: (
    client: BoxelCLIClient,
    realmUrl: string,
    workspaceDir: string,
  ) => Promise<void>;
  /**
   * Push the workspace to the target realm (prefer-local) and wait for
   * the realm's indexer to settle before returning. Tests stub this
   * out. Defaults to `client.sync({ preferLocal: true, waitForIndex: true })`.
   */
  syncWorkspaceToRealm?: (
    client: BoxelCLIClient,
    realmUrl: string,
    workspaceDir: string,
  ) => Promise<void>;
  /**
   * Write the realm's index page. Defaults to
   * `writeRealmDashboardCard`, which makes a freshly-created realm open
   * to the `RealmDashboard` dashboard. Tests stub this out.
   */
  writeRealmIndex?: (workspaceDir: string, realmUrl: string) => Promise<void>;
  /**
   * Link the realm index's `board` relationship to the IssueTracker the
   * bootstrap issue created. Defaults to `linkBoardToRealmIndex`. Returns
   * `true` when it modified the index so the entrypoint syncs. Tests stub
   * this out.
   */
  linkRealmIndexBoard?: (
    options: LinkBoardToRealmIndexOptions,
  ) => Promise<boolean>;
  /**
   * Link the bootstrap seed issue's `project` relationship to the Project the
   * bootstrap issue created. Defaults to `linkProjectToSeedIssue`. Returns
   * `true` when it modified the seed issue so the entrypoint syncs. Tests stub
   * this out.
   */
  linkBootstrapIssueProject?: (
    options: LinkProjectToSeedIssueOptions,
  ) => Promise<boolean>;
}
export { FactoryEntrypointUsageError } from './factory-entrypoint-errors.ts';

export function getFactoryEntrypointUsage(): string {
  return [
    'Usage:',
    '  pnpm factory:go --brief-url <url> --target-realm <realm> [options]',
    '  pnpm factory:go --repo-url <github url> --target-realm <realm> [options]',
    '',
    'Required (exactly one of --brief-url / --repo-url, plus --target-realm):',
    '  --brief-url <url>           Absolute URL for the source brief card (your authored content)',
    '  --repo-url <url>            GitHub repository URL for an inspired-by port. Seeds a',
    '                              PORT-ANALYSIS issue ahead of bootstrap that clones the repo,',
    '                              reads its media AND code (dependencies, specialized logic,',
    '                              tests + fixtures), and writes the port background + code',
    '                              analysis Knowledge Articles bootstrap plans from.',
    '  --target-realm <realm>      Target realm (URL form, e.g. http://localhost:4201/me/realm/)',
    '',
    'Options:',
    '  --realm-server-url <url>   Realm server URL (default: from active Boxel profile)',
    '  --control-realm <realm>     Control realm for the v3 control/product split. Issues,',
    '                              tracker cards, validation artifacts, and the run log live',
    '                              here (raw-written, immune to the atomic FieldDef strip);',
    '                              the target realm keeps only the built product — so product',
    '                              .gts updates never invalidate the run log the operator is',
    '                              watching, and control churn never re-runs product queries.',
    '                              Created if missing. Omit for v2 single-realm behavior.',
    '  --no-retry-blocked          Skip retrying blocked issues (by default, blocked issues are reset to backlog)',
    '  --agent <provider>          LLM backend: "claude" (default, uses Claude Code Agent SDK),',
    '                              "codex" (not yet implemented),',
    '                              "openrouter" (defaults to anthropic/claude-opus-4-7, runs',
    '                              via the opencode SDK with native fs / Bash),',
    '                              or "openrouter=<model-id>" to pick a specific OpenRouter model',
    '                              (e.g., "openrouter=anthropic/claude-sonnet-4").',
    '  --openrouter-api-key <key>  OpenRouter API key for the openrouter backend.',
    '                              When set, opencode talks to OpenRouter directly with this key.',
    '                              When unset (and OPENROUTER_API_KEY env is also unset), the',
    '                              backend falls back to the realm server passthrough at',
    '                              `/_openrouter/chat/completions` — burns boxel tokens.',
    '  --debug                     Log LLM prompts and responses to stderr',
    '  --no-phase-split            Disable the v3 default phase-split (DESIGN turn on the',
    '                              flagship model + BUILD turn on claude-sonnet-5, forked).',
    '                              Only meaningful with --v2, where phase-split is on by default.',
    '  --bootstrap-model <model>   Model for the bootstrap (planning) turn. Default under --v2:',
    '                              claude-sonnet-5 — mostly mechanical tracker JSON. Pass',
    '                              `inherit` to keep the session flagship.',
    '  --bootstrap-effort <effort> Effort for the bootstrap turn (low|medium|high|xhigh|max).',
    '                              Default medium.',
    '  --review-model <model>      Model for the post-issue review turn. Default: inherit the',
    '                              session flagship (cheap-tier reviews shipped false verdicts,',
    '                              so downgrading is an explicit experiment). `inherit` is a no-op.',
    '  --review-effort <effort>    Effort for the review turn when --review-model is set',
    '                              (low|medium|high|xhigh|max). Default medium.',
    "  --include-polish            Execute factory-generated polish issues (the bootstrap's",
    '                              pass-2 enhancement scope) unattended. By default they stay',
    '                              on the board awaiting operator approval.',
    '  --no-render-gate            Skip the v3 render gate + acceptance walkthrough (post-issue',
    '                              _screenshot-card captures and the verifier turn that reads',
    '                              them, verdicts acceptance criteria, and files defect issues).',
    '  --monitor-level <level>     Orchestrator monitor verbosity on the run log (requires --v2):',
    '                              "quiet" (stalls + failures only), "normal" (default — adds',
    '                              per-turn telemetry and scheduler notes), "verbose" (adds turn',
    '                              starts, heals, and sync successes).',
    '  --enable-boxel-ui-discovery Make the agent search the catalog for @cardstack/boxel-ui',
    '                              component Spec cards before writing UI in a .gts template.',
    '                              When omitted, the agent has no awareness of boxel-ui',
    '                              components — neither the discovery skill nor the',
    '                              system-prompt catalog exception is loaded. Feature flag.',
    '  --help                      Show this usage information',
    '',
    'Auth:',
    '  Authentication uses the active Boxel profile (see: boxel profile add).',
    '  The target realm owner is determined from the active profile username.',
    '  For public briefs, no further auth setup is needed.',
    '  For private briefs, factory:go authenticates via the active Boxel profile.',
    '  The realm server URL comes from --realm-server-url, or the active Boxel profile.',
    '  It is never inferred from --target-realm.',
  ].join('\n');
}

export function parseFactoryEntrypointArgs(
  argv: string[],
): FactoryEntrypointOptions {
  let normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  let parsed;

  try {
    parsed = parseNodeArgs({
      args: normalizedArgv,
      allowPositionals: true,
      strict: true,
      options: {
        'brief-url': {
          type: 'string',
        },
        'repo-url': {
          type: 'string',
        },
        'target-realm': {
          type: 'string',
        },
        'control-realm': {
          type: 'string',
        },
        'realm-server-url': {
          type: 'string',
        },
        help: {
          type: 'boolean',
        },
        'no-retry-blocked': {
          type: 'boolean',
        },
        agent: {
          type: 'string',
        },
        'openrouter-api-key': {
          type: 'string',
        },
        debug: {
          type: 'boolean',
        },
        'enable-boxel-ui-discovery': {
          type: 'boolean',
        },
        v2: {
          type: 'boolean',
        },
        'fork-context': {
          type: 'boolean',
        },
        'include-polish': {
          type: 'boolean',
        },
        'fix-model': {
          type: 'string',
        },
        'fix-effort': {
          type: 'string',
        },
        'phase-split': {
          type: 'boolean',
        },
        'no-phase-split': {
          type: 'boolean',
        },
        'no-render-gate': {
          type: 'boolean',
        },
        'review-model': {
          type: 'string',
        },
        'bootstrap-model': {
          type: 'string',
        },
        'bootstrap-effort': {
          type: 'string',
        },
        'review-effort': {
          type: 'string',
        },
        'build-model': {
          type: 'string',
        },
        'build-effort': {
          type: 'string',
        },
        'monitor-level': {
          type: 'string',
        },
      },
    });
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    throw new FactoryEntrypointUsageError(message);
  }

  if (parsed.positionals.length > 0) {
    throw new FactoryEntrypointUsageError(
      `Unexpected positional arguments: ${parsed.positionals.join(', ')}`,
    );
  }

  let rawBriefUrl =
    typeof parsed.values['brief-url'] === 'string' &&
    parsed.values['brief-url'].trim() !== ''
      ? parsed.values['brief-url']
      : undefined;
  let rawRepoUrl =
    typeof parsed.values['repo-url'] === 'string' &&
    parsed.values['repo-url'].trim() !== ''
      ? parsed.values['repo-url']
      : undefined;
  if (!rawBriefUrl && !rawRepoUrl) {
    throw new FactoryEntrypointUsageError(
      'Missing required input: pass --brief-url <brief card> (your authored content) or --repo-url <github repo> (inspired-by port).',
    );
  }
  if (rawBriefUrl && rawRepoUrl) {
    throw new FactoryEntrypointUsageError(
      '--brief-url and --repo-url are mutually exclusive — a run has one source.',
    );
  }
  let targetRealm = requireStringValue(
    parsed.values['target-realm'],
    '--target-realm',
  );
  let realmServerUrl =
    typeof parsed.values['realm-server-url'] === 'string'
      ? normalizeUrl(parsed.values['realm-server-url'], '--realm-server-url')
      : null;

  let agentRaw =
    typeof parsed.values.agent === 'string' ? parsed.values.agent : undefined;
  let parsedAgent;
  try {
    parsedAgent = parseAgentFlag(agentRaw);
  } catch (error) {
    throw new FactoryEntrypointUsageError(
      error instanceof Error ? error.message : String(error),
    );
  }

  let openRouterApiKey: string | undefined;
  let rawOpenRouterApiKey = parsed.values['openrouter-api-key'];
  if (typeof rawOpenRouterApiKey === 'string') {
    let trimmed = rawOpenRouterApiKey.trim();
    if (trimmed !== '') {
      openRouterApiKey = trimmed;
    }
  }

  return {
    briefUrl: rawBriefUrl
      ? normalizeUrl(rawBriefUrl, '--brief-url')
      : undefined,
    repoUrl: rawRepoUrl ? normalizeUrl(rawRepoUrl, '--repo-url') : undefined,
    targetRealm: normalizeUrl(targetRealm, '--target-realm'),
    controlRealm:
      typeof parsed.values['control-realm'] === 'string'
        ? normalizeUrl(parsed.values['control-realm'], '--control-realm')
        : null,
    realmServerUrl,
    agent: parsedAgent.provider,
    openRouterModel: parsedAgent.openRouterModel,
    openRouterApiKey,
    debug: parsed.values.debug === true ? true : undefined,
    retryBlocked: parsed.values['no-retry-blocked'] === true ? false : true,
    // V2 turns boxel-ui discovery on by default — the design-first loop
    // must search the catalog before hand-rolling UI.
    enableBoxelUiDiscovery:
      parsed.values['enable-boxel-ui-discovery'] === true ||
      parsed.values.v2 === true
        ? true
        : undefined,
    v2: parsed.values.v2 === true ? true : undefined,
    forkContext: parsed.values['fork-context'] === true ? true : undefined,
    includePolish: parsed.values['include-polish'] === true ? true : undefined,
    fixModel:
      typeof parsed.values['fix-model'] === 'string'
        ? parsed.values['fix-model']
        : undefined,
    fixEffort:
      typeof parsed.values['fix-effort'] === 'string'
        ? parsed.values['fix-effort']
        : undefined,
    // Tri-state: --no-phase-split wins; explicit --phase-split forces on;
    // otherwise undefined lets the v2 default (on) apply downstream.
    phaseSplit:
      parsed.values['no-phase-split'] === true
        ? false
        : parsed.values['phase-split'] === true
          ? true
          : undefined,
    renderGate: parsed.values['no-render-gate'] === true ? false : undefined,
    reviewModel:
      typeof parsed.values['review-model'] === 'string'
        ? parsed.values['review-model']
        : undefined,
    bootstrapModel:
      typeof parsed.values['bootstrap-model'] === 'string'
        ? parsed.values['bootstrap-model']
        : undefined,
    bootstrapEffort:
      typeof parsed.values['bootstrap-effort'] === 'string'
        ? parsed.values['bootstrap-effort']
        : undefined,
    reviewEffort:
      typeof parsed.values['review-effort'] === 'string'
        ? parsed.values['review-effort']
        : undefined,
    buildModel:
      typeof parsed.values['build-model'] === 'string'
        ? parsed.values['build-model']
        : undefined,
    buildEffort:
      typeof parsed.values['build-effort'] === 'string'
        ? parsed.values['build-effort']
        : undefined,
    monitorLevel: parseMonitorLevel(parsed.values['monitor-level']),
  };
}

function parseMonitorLevel(
  raw: unknown,
): 'quiet' | 'normal' | 'verbose' | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw === 'quiet' || raw === 'normal' || raw === 'verbose') {
    return raw;
  }
  throw new FactoryEntrypointUsageError(
    `Invalid --monitor-level: "${raw}". Valid values: quiet, normal, verbose.`,
  );
}

/**
 * Turn the CLI's budget flags into the loop's model policy. Orchestrator-
 * owned: budgets key off turn TYPE (prime/bootstrap/build/fix), never off
 * issue content.
 *
 * Cache-family heuristic (why the default tunes EFFORT, not model):
 * provider prompt cache is per-model. Switching a fork turn to another
 * model re-ingests the whole primed prefix uncached — roughly
 *   cost_switch ≈ prefix_tokens × input_price(new)
 *   savings     ≈ turn_tokens × (price(old) − price(new))
 * Fix turns are short (small turn_tokens) against a large primed prefix,
 * so in-family effort reduction wins: same model keeps the cache hit AND
 * effort='medium'/'low' cuts the thinking that dominated profiled turns.
 * Cross-family switching only pays when the turn's output is large
 * relative to the prefix (e.g. bulk BUILD emission) — that's an explicit
 * `--fix-model <model>` opt-in, never the default.
 *
 * v2 default: fix iterations (mechanical lint/parse fix-ups) inherit the
 * session model at effort='medium'. `--fix-effort low|...` tunes it;
 * `--fix-model claude-sonnet-5` (or an OpenRouter id under the opencode
 * backend) opts into a family switch; `--fix-model inherit --fix-effort
 * high` effectively disables the policy.
 */
type TurnBudget = {
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};

function normalizeEffort(
  value: string | undefined,
  fallback: 'low' | 'medium' | 'high' | 'xhigh' | 'max',
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  return value && ['low', 'medium', 'high', 'xhigh', 'max'].includes(value)
    ? (value as 'low' | 'medium' | 'high' | 'xhigh' | 'max')
    : fallback;
}

export function buildModelPolicy(options: {
  v2?: boolean;
  fixModel?: string;
  fixEffort?: string;
  phaseSplit?: boolean;
  buildModel?: string;
  buildEffort?: string;
  reviewModel?: string;
  reviewEffort?: string;
  bootstrapModel?: string;
  bootstrapEffort?: string;
}):
  | {
      bootstrap?: TurnBudget;
      design?: TurnBudget;
      build?: TurnBudget;
      fix?: TurnBudget;
      acceptance?: TurnBudget;
    }
  | undefined {
  if (options.v2 !== true) return undefined;

  // Fix turns: short output vs a big primed prefix — in-family effort
  // reduction wins (cache preserved); family switch is explicit opt-in.
  let fixModel =
    options.fixModel === 'inherit' || options.fixModel === undefined
      ? undefined
      : options.fixModel;
  let policy: {
    bootstrap?: TurnBudget;
    design?: TurnBudget;
    build?: TurnBudget;
    fix?: TurnBudget;
    acceptance?: TurnBudget;
  } = {
    fix: {
      ...(fixModel ? { model: fixModel } : {}),
      effort: normalizeEffort(options.fixEffort, 'medium'),
    },
    // Review turn (PM gate): NOT budgeted by default — it inherits the
    // session flagship. The reviewer makes taste + product judgments
    // (ship / bounce / reprioritize the backlog) that the cheap tier
    // shipped false verdicts on; a fresh unforked context has no
    // cache-family concern either way. (Operator directive 2026-07-17:
    // review is the powerful model's job.) `--review-model` opts into a
    // downgrade as an explicit experiment.
  };

  let reviewModel =
    options.reviewModel === 'inherit' ? undefined : options.reviewModel;
  if (reviewModel !== undefined || options.reviewEffort !== undefined) {
    policy.acceptance = {
      ...(reviewModel ? { model: reviewModel } : {}),
      effort: normalizeEffort(options.reviewEffort, 'medium'),
    };
  }

  // Bootstrap: plans the project and writes tracker JSON — long mechanical
  // output where the family switch beats flagship cost, like build turns.
  let bootstrapModel =
    options.bootstrapModel === 'inherit'
      ? undefined
      : (options.bootstrapModel ?? 'claude-sonnet-5');
  policy.bootstrap = {
    ...(bootstrapModel ? { model: bootstrapModel } : {}),
    effort: normalizeEffort(options.bootstrapEffort, 'medium'),
  };

  // Phase-split build turns: LARGE output (the .gts emissions) — the one
  // turn type where a family switch beats the cache re-ingest cost, so
  // the default IS a switch (claude-sonnet-5 @ medium). DESIGN keeps the
  // session flagship (taste turn) unless a future --design-* flag says
  // otherwise.
  if (options.phaseSplit === true) {
    let buildModel =
      options.buildModel === 'inherit'
        ? undefined
        : (options.buildModel ?? 'claude-sonnet-5');
    policy.build = {
      ...(buildModel ? { model: buildModel } : {}),
      effort: normalizeEffort(options.buildEffort, 'medium'),
    };
  }

  return policy;
}

export function wantsFactoryEntrypointHelp(argv: string[]): boolean {
  let normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  return normalizedArgv.includes('--help');
}

export async function runFactoryEntrypoint(
  options: FactoryEntrypointOptions,
  dependencies?: RunFactoryEntrypointDependencies,
): Promise<FactoryEntrypointSummary> {
  // Reject unsupported agent backends before any realm/brief side effects
  // run — otherwise `--agent codex` would create a seed issue and mutate
  // the target realm only to fail later when the loop tries to build the
  // (unimplemented) agent.
  assertAgentProviderImplemented(options.agent);

  let targetRealmResolution = (
    dependencies?.resolveTargetRealm ?? resolveFactoryTargetRealm
  )({
    targetRealm: options.targetRealm,
    realmServerUrl: options.realmServerUrl,
  });

  let client = new BoxelCLIClient();

  // One source per run: a brief card (our authored content) or a GitHub
  // repo (inspired-by port — the analysis issue does the deep reading).
  let brief = await withSpan('startup', 'load-brief', undefined, () =>
    options.repoUrl
      ? loadGitHubBrief(options.repoUrl, { fetch: dependencies?.fetch })
      : loadFactoryBrief(requireBriefSource(options), {
          client,
          fetch: dependencies?.fetch,
        }),
  );
  // Downstream (run slug, loop config, bootstrap prompt) keys off one
  // source URL regardless of which flag provided it.
  let briefSourceUrl = brief.sourceUrl;

  let targetRealm = await withSpan(
    'startup',
    'bootstrap-target-realm',
    undefined,
    () =>
      (dependencies?.bootstrapTargetRealm ?? bootstrapFactoryTargetRealm)(
        targetRealmResolution,
      ),
  );

  // v3 control/product split: resolve + bootstrap the control realm the
  // same way as the target (created if missing). A control realm equal to
  // the target degenerates to the single-realm v2 flow.
  let controlRealmUrl: string | undefined;
  if (options.controlRealm) {
    let controlResolution = (
      dependencies?.resolveTargetRealm ?? resolveFactoryTargetRealm
    )({
      targetRealm: options.controlRealm,
      realmServerUrl: options.realmServerUrl,
    });
    let controlRealm = await (
      dependencies?.bootstrapTargetRealm ?? bootstrapFactoryTargetRealm
    )(controlResolution);
    if (controlRealm.url !== targetRealm.url) {
      controlRealmUrl = controlRealm.url;
    }
  }

  let darkfactoryModuleUrl = inferDarkfactoryModuleUrl(targetRealm.url);

  // Establish the local workspace for target-realm I/O. Every factory
  // read/write against the target realm happens against this directory;
  // the realm itself is reached only via `client.pull` / `client.sync`.
  // The path is deterministic per realm so re-runs reuse state.
  //
  // When the realm was just created by bootstrap, any pre-existing
  // workspace state is guaranteed to be orphaned (the remote has only
  // index.json, so local files from a prior run would fail the
  // subsequent atomic sync). Reset in that case so users don't need to
  // `rm -rf` by hand when iterating against a recreated realm.
  let workspaceDir = resolveWorkspaceDir(targetRealm.url);
  if (targetRealm.createdRealm) {
    await resetWorkspaceDir(workspaceDir);
    log.info(`Reset workspace for freshly-created realm: ${workspaceDir}`);
  } else {
    await ensureWorkspaceDir(workspaceDir);
    log.info(`Workspace directory: ${workspaceDir}`);
  }

  // Span-trace telemetry for the whole run (see run-trace.ts for the
  // schema). Spans recorded before this point were buffered and flush now.
  initRunTrace({
    workspaceDir,
    tags: {
      targetRealm: targetRealm.url,
      controlRealm: controlRealmUrl,
      brief: briefSourceUrl,
      v2: options.v2 === true,
    },
  });

  let pullTargetRealm = dependencies?.pullTargetRealm ?? defaultPullTargetRealm;
  await withSpan('startup', 'pull-target-realm', undefined, () =>
    pullTargetRealm(client, targetRealm.url, workspaceDir),
  );

  // `.factory-scratch/` (the port-analysis turn's download area) never
  // syncs anywhere — always ignored, split or not.
  await ensureScratchIgnoreFile(workspaceDir);

  // Under the split: exclude control-plane paths from the product atomic
  // sync (BEFORE the first sync below), then pull the control realm's
  // control-plane files into the shared workspace so resume runs see
  // prior issues/run logs.
  let controlSync: ControlPlaneSync | undefined;
  if (controlRealmUrl) {
    await ensureControlPlaneIgnoreFile(workspaceDir);
    controlSync = new ControlPlaneSync({
      client,
      controlRealm: controlRealmUrl,
      workspaceDir,
    });
    await withSpan('startup', 'pull-control-realm', undefined, () =>
      controlSync!.pull(),
    );
  }

  // Legacy single-realm mode only: replace the default CardsGrid index
  // with a RealmDashboard so the realm opens to the factory dashboard.
  // Under the control/product split the PRODUCT realm keeps its stock
  // index — the product realm is the user's deliverable, not a factory
  // surface (operator directive 2026-07-17: no custom workspace/home
  // card per build; the stock grid shows the product cards, and a
  // future out-of-box workspace.gts with pinning/readme replaces
  // per-build home customization). Tracking surfaces live in the
  // control realm.
  if (targetRealm.createdRealm && !controlRealmUrl) {
    let writeRealmIndex =
      dependencies?.writeRealmIndex ?? writeRealmDashboardCard;
    await writeRealmIndex(workspaceDir, targetRealm.url);
  }

  // Create the seed issue locally
  let seedResult = await withSpan('seed', 'create-seed', undefined, () =>
    (dependencies?.createSeed ?? createSeedIssue)(brief, {
      darkfactoryModuleUrl,
      workspaceDir,
      // v2: hierarchical design — a design-foundation issue (brand guide,
      // tokens, family coherence sheet) runs between bootstrap and the
      // implementation issues.
      designFoundation: options.v2 === true,
    }),
  );

  // Push the freshly-written seed (and any other pre-existing workspace
  // state) to the realm. `defaultSyncWorkspaceToRealm` uses
  // `waitForIndex: true` so the realm-server only responds after the
  // indexer has processed the batch — the next step is `listIssues()`,
  // which hits the index, and CS-11003 PR 2 made `+source` POSTs
  // fire-and-forget by default.
  let syncWorkspaceToRealm =
    dependencies?.syncWorkspaceToRealm ?? defaultSyncWorkspaceToRealm;
  await syncWorkspaceToRealm(client, targetRealm.url, workspaceDir);

  // Under the split the seed issue is a control-plane file — excluded from
  // the product sync above — so push it to the control realm now. Raw
  // writes don't wait for indexing; the loop wiring bounded-polls
  // listIssues before starting.
  if (controlSync) {
    let controlPush = await controlSync.sync();
    if (!controlPush.ok) {
      throw new Error(
        `Initial control-plane sync failed — the seed issue may not have reached the control realm: ${controlPush.error ?? 'unknown error'}`,
      );
    }
  }

  // Wire the artifacts the bootstrap issue creates into the realm. The
  // bootstrap agent makes an IssueTracker board and a Project; the index card
  // and seed issue were both written before those existed, so they start with
  // no `board` / `project` link. These find the board/Project and patch
  // `index.json` and the seed issue in place. Each reports whether it changed
  // its card; sync once if either did. Idempotent — a no-op once the links
  // are set or while nothing is indexed. Only freshly-created realms get a
  // RealmDashboard page, so callers gate this on `createdRealm`.
  let linkBoard = dependencies?.linkRealmIndexBoard ?? linkBoardToRealmIndex;
  let linkSeedProject =
    dependencies?.linkBootstrapIssueProject ?? linkProjectToSeedIssue;
  let wireBootstrapArtifacts = async ({ waitForIndex = true } = {}) => {
    // The board/Project are pushed to the realm fire-and-forget (no
    // waitForIndex), so a search right after can race the indexer. Both the
    // in-loop hook and the post-loop backstop therefore retry on an empty
    // result: the hook is the only wiring a run that stalls or is interrupted
    // before the backstop ever gets, so it can't afford to lose that race.
    let searchRetries = waitForIndex ? BOOTSTRAP_LINK_SEARCH_RETRIES : 0;
    // Under the split the bootstrap agent's IssueTracker/Project land in
    // the CONTROL realm: search there, and write the index card's board
    // link as an absolute URL (index.json lives in the product realm).
    let linkArgs = {
      client,
      realmUrl: controlRealmUrl ?? targetRealm.url,
      workspaceDir,
      darkfactoryModuleUrl,
      searchRetries,
    };
    // The two links patch independent files (index.json vs the seed issue)
    // and share no state, so run them concurrently. When the realm has
    // neither card yet, each search otherwise burns its full retry budget in
    // turn; overlapping them halves the worst-case wait.
    // Under the split the product realm keeps its STOCK index (no
    // dashboard was written), so there is no board relationship to patch
    // — skip linkBoard entirely; only the seed issue's project link (a
    // control-plane file) still gets wired.
    // The design-foundation and port-analysis seeds are written by the
    // seeder before any Project exists and nothing else ever links them —
    // leaving the project-scoped board blind to the issue the loop is
    // actively working. Link them alongside the bootstrap seed; a seed
    // that doesn't exist for this run shape is a no-op.
    let [boardLinked, projectLinked, foundationLinked, analysisLinked] =
      await Promise.all([
        controlRealmUrl
          ? Promise.resolve(false)
          : linkBoard({ ...linkArgs, absoluteLink: false }),
        linkSeedProject(linkArgs),
        linkSeedProject({
          ...linkArgs,
          seedIssuePath: DESIGN_FOUNDATION_ISSUE_PATH,
        }),
        linkSeedProject({ ...linkArgs, seedIssuePath: ANALYSIS_ISSUE_PATH }),
      ]);
    if (boardLinked || projectLinked || foundationLinked || analysisLinked) {
      await syncWorkspaceToRealm(client, targetRealm.url, workspaceDir);
      // The seed issue's project link is a control-plane change.
      if (controlSync) {
        await controlSync.sync();
      }
    }
  };

  let summary = buildFactoryEntrypointSummary(
    options,
    brief,
    targetRealm,
    seedResult,
  );

  // v3: phase-split is the default economics under --v2 (design on the
  // flagship, build on the cheap model, forked). --no-phase-split opts out.
  let phaseSplit = options.phaseSplit ?? options.v2 === true;

  // Run the issue-driven loop
  let loopFn = dependencies?.runIssueLoop ?? runFactoryIssueLoop;
  let loopResult = await loopFn({
    briefUrl: briefSourceUrl,
    targetRealm: targetRealm.url,
    controlRealm: controlRealmUrl,
    controlSync,
    realmServerUrl: targetRealm.serverUrl,
    ownerUsername: targetRealm.ownerUsername,
    client,
    workspaceDir,
    agent: options.agent,
    openRouterModel: options.openRouterModel,
    openRouterApiKey: options.openRouterApiKey,
    debug: options.debug,
    retryBlocked: options.retryBlocked,
    enableBoxelUiDiscovery: options.enableBoxelUiDiscovery,
    v2: options.v2,
    runTitle: brief.title,
    forkContext: options.forkContext,
    includePolish: options.includePolish,
    modelPolicy: buildModelPolicy({ ...options, phaseSplit }),
    phaseSplit,
    renderGate: options.renderGate,
    monitorLevel: options.monitorLevel,
    // Wire the board and the seed issue's project the moment the bootstrap
    // issue finishes, rather than after the whole loop returns — so a run
    // whose later issues stall or get interrupted still ends up with the
    // dashboard and seed issue wired up. The post-loop call below is an
    // idempotent backstop for runs that complete normally.
    onBootstrapComplete: targetRealm.createdRealm
      ? wireBootstrapArtifacts
      : undefined,
  });

  summary.issueLoop = {
    outcome: loopResult.outcome,
    outerCycles: loopResult.outerCycles,
    issueResults: loopResult.issueResults.map((ir) => ({
      issueId: ir.issueId,
      exitReason: ir.exitReason,
      innerIterations: ir.innerIterations,
      toolCallCount: ir.toolCallLog.length,
    })),
  };

  // Backstop after the loop returns. The bootstrap-complete hook above is the
  // primary trigger (it fires even when the loop never reaches here), but this
  // re-wires idempotently for runs that complete normally, covering the case
  // where the hook exhausted its retry budget before the index caught up. A
  // no-op when the board and project are already linked. Best-effort, like the
  // hook: a wiring failure here must not turn an otherwise-successful run into
  // a failure.
  if (targetRealm.createdRealm) {
    try {
      await wireBootstrapArtifacts({ waitForIndex: true });
    } catch (err) {
      log.warn(
        `wireBootstrapArtifacts backstop failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let succeeded = loopResult.outcome === 'all_issues_done';
  summary.result = {
    status: succeeded ? 'completed' : 'failed',
    nextStep: succeeded ? 'all-issues-completed' : `loop-${loopResult.outcome}`,
  };

  return summary;
}

export function buildFactoryEntrypointSummary(
  _options: FactoryEntrypointOptions,
  brief: FactoryBrief,
  targetRealm: FactoryTargetRealmBootstrapResult,
  seedResult: SeedIssueResult,
): FactoryEntrypointSummary {
  let actions: FactoryEntrypointAction[] = [
    {
      name: 'validated-inputs',
      status: 'ok',
      detail: 'accepted required CLI inputs',
    },
    {
      name: 'resolved-target-realm-owner',
      status: 'ok',
      detail: targetRealm.ownerUsername,
    },
    {
      name: 'fetched-brief',
      status: 'ok',
      detail: brief.sourceUrl,
    },
    {
      name: 'normalized-brief',
      status: 'ok',
      detail: 'prepared-brief-data',
    },
    {
      name: 'resolved-target-realm',
      status: 'ok',
      detail: targetRealm.url,
    },
    {
      name: 'bootstrapped-target-realm',
      status: 'ok',
      detail: targetRealm.createdRealm
        ? 'created realm via realm server API'
        : 'target realm already existed',
    },
    {
      name: 'created-seed-issue',
      status: 'ok',
      detail: `${seedResult.issueId} (${seedResult.status})`,
    },
  ];

  return {
    command: 'factory:go',
    brief: {
      ...brief,
      url: brief.sourceUrl,
    },
    targetRealm: {
      url: targetRealm.url,
      ownerUsername: targetRealm.ownerUsername,
    },
    seedIssue: {
      seedIssueId: seedResult.issueId,
      seedIssueStatus: seedResult.status,
    },
    actions,
    result: {
      status: 'ready',
      nextStep: 'run-issue-loop',
    },
  };
}

async function defaultPullTargetRealm(
  client: BoxelCLIClient,
  realmUrl: string,
  workspaceDir: string,
): Promise<void> {
  let result = await withStdoutRedirected(() =>
    client.pull(realmUrl, workspaceDir),
  );
  if (result.error) {
    throw new Error(
      `Failed to pull target realm into workspace ${workspaceDir}: ${result.error}`,
    );
  }
  log.info(
    `Pulled ${result.files.length} file(s) from target realm into workspace`,
  );
}

async function defaultSyncWorkspaceToRealm(
  client: BoxelCLIClient,
  realmUrl: string,
  workspaceDir: string,
): Promise<void> {
  // `waitForIndex: true` makes the realm-server's `_atomic` handler block
  // on indexing before responding (`?waitForIndex=true` query param).
  // Required here because the next step is `runFactoryIssueLoop` →
  // `listIssues()`, which hits the realm's index. Without this the loop
  // would race CS-11003 PR 2's deferred `+source` POST and exit with
  // `outcome=all_issues_done, issues=0` despite a freshly-synced seed.
  let result = await withStdoutRedirected(() =>
    client.sync(realmUrl, workspaceDir, {
      preferLocal: true,
      waitForIndex: true,
    }),
  );
  if (result.error) {
    throw new Error(`Failed to sync workspace to realm: ${result.error}`);
  }
  // The initial post-seed sync is load-bearing: if any file failed to
  // upload, the seed issue isn't actually on the realm, and the loop
  // would immediately exit with `all_issues_done` and zero iterations —
  // silently masking the real failure. Fail fast instead.
  if (result.hasError) {
    throw new Error(
      'Initial workspace sync completed with per-file errors — see prior log lines. ' +
        'The seed issue and any other workspace state may not have reached the realm, ' +
        'which would cause the issue loop to exit immediately with zero issues.',
    );
  }
}

function requireBriefSource(options: FactoryEntrypointOptions): string {
  if (options.briefUrl) {
    return options.briefUrl;
  }
  throw new FactoryEntrypointUsageError(
    'Missing required input: pass --brief-url <brief card> or --repo-url <github repo>.',
  );
}

function requireStringValue(
  value: string | boolean | undefined,
  flagName: string,
): string {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }

  throw new FactoryEntrypointUsageError(`Missing required ${flagName}`);
}

function normalizeUrl(rawUrl: string, flagName: string): string {
  try {
    return new URL(rawUrl).href;
  } catch (_error) {
    throw new FactoryEntrypointUsageError(
      `Expected ${flagName} to be an absolute URL, received: ${rawUrl}`,
    );
  }
}
