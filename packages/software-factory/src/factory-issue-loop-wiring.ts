/**
 * Issue-loop wiring for the factory:go entrypoint.
 *
 * Constructs all components needed for the issue-driven loop and runs it:
 * - BoxelCLIClient (auth is owned by the CLI profile, not the factory)
 * - RealmIssueStore for issue scheduling
 * - RealmIssueRelationshipLoader for context building
 * - ContextBuilder with issue-aware mode
 * - ToolRegistry, ToolExecutor, FactoryTool[] via buildFactoryTools
 * - ClaudeCodeFactoryAgent or OpencodeFactoryAgent as the LoopAgent
 * - ValidationPipeline as the Validator
 * - runIssueLoop() invocation
 */

import { resolve } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import { logger } from './logger.ts';
import {
  ValidationRunCache,
  WorkspaceSyncGate,
} from './validation-run-cache.ts';

import {
  ClaudeCodeFactoryAgent,
  OpencodeFactoryAgent,
  FACTORY_DEFAULT_OPENROUTER_MODEL,
  type FactoryAgentProvider,
  type LoopAgent,
} from './factory-agent/index.ts';
import { ContextBuilder } from './factory-context-builder.ts';
import { inferDarkfactoryModuleUrl } from './factory-seed.ts';
import { DefaultSkillResolver, SkillLoader } from './factory-skill-loader.ts';
import {
  buildFactoryTools,
  type FactoryTool,
  type ToolBuilderConfig,
} from './factory-tool-builder.ts';
import { ToolExecutor } from './factory-tool-executor.ts';
import { ToolRegistry, REALM_API_TOOLS } from './factory-tool-registry.ts';
import {
  runIssueLoop,
  createDefaultPipeline,
  type IssueLoopConfig,
  type IssueLoopResult,
} from './issue-loop.ts';
import { RealmIssueStore, type IssueStore } from './issue-scheduler.ts';
import { RealmIssueRelationshipLoader } from './realm-issue-relationship-loader.ts';
import { withStdoutRedirected } from './redirect-stdout.ts';

let log = logger('factory-issue-loop-wiring');

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueLoopWiringConfig {
  briefUrl: string;
  targetRealm: string;
  realmServerUrl: string;
  ownerUsername: string;
  /** Boxel CLI client — owns all realm auth and API calls. */
  client: BoxelCLIClient;
  /**
   * Local workspace directory mirroring the target realm. All target-realm
   * reads/writes happen here; `client.pull` / `client.sync` move bytes
   * between this directory and the realm.
   */
  workspaceDir: string;
  /** Which LLM backend to use. Defaults to 'claude'. */
  agent?: FactoryAgentProvider;
  /** Explicit OpenRouter model id; only honoured when agent === 'openrouter'. */
  openRouterModel?: string;
  /**
   * OpenRouter API key for direct billing. Only honoured when
   * `agent === 'openrouter'`. When unset, the OpenRouter path falls
   * back to the realm-server `/_openrouter/chat/completions`
   * passthrough (boxel tokens). The CLI plumbs this through from
   * `--openrouter-api-key` or env `OPENROUTER_API_KEY`.
   */
  openRouterApiKey?: string;
  debug?: boolean;
  /** Inject a pre-built LoopAgent instance (tests only). Wins over `agent`. */
  agentOverride?: LoopAgent;
  /** Host app URL for QUnit live-test page. */
  hostAppUrl?: string;
  /** Max inner-loop iterations per issue. Default: 5. */
  maxIterationsPerIssue?: number;
  /** Max outer-loop cycles. Default: 50. */
  maxOuterCycles?: number;
  /**
   * Reset blocked issues (without blockedBy dependencies) to backlog before
   * running the loop. Sets priority to critical for immediate pickup.
   */
  retryBlocked?: boolean;
  /**
   * Feature flag — enables the boxel-ui-component-discovery skill and the
   * system-prompt catalog-search exception. When omitted, the agent has no
   * awareness of boxel-ui components. See CS-10527.
   */
  enableBoxelUiDiscovery?: boolean;
  /**
   * Override skill-library directories (`--skills-dir`). When set, the
   * on-demand skill library (index + read_skill) comes EXCLUSIVELY from
   * these directories — nothing bundled is indexed or readable, and no
   * exclusion filtering applies. Front-loaded workflow skills still come
   * from the bundled sources. A library that yields zero skills fails the
   * run at startup.
   */
  skillLibraryDirs?: string[];
  /**
   * Invoked once, right after the bootstrap issue completes. The entrypoint
   * uses this to link the realm index's `board` relationship as soon as the
   * IssueTracker exists, instead of waiting for the entire loop to return.
   * Passed straight through to {@link runIssueLoop}.
   */
  onBootstrapComplete?: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runFactoryIssueLoop(
  config: IssueLoopWiringConfig,
): Promise<IssueLoopResult> {
  let targetRealm = ensureTrailingSlash(config.targetRealm);
  let realmServerUrl = ensureTrailingSlash(config.realmServerUrl);
  let client = config.client;
  let workspaceDir = config.workspaceDir;

  // 1. Issue store
  let darkfactoryModuleUrl = inferDarkfactoryModuleUrl(targetRealm);
  let issueStore = new RealmIssueStore({
    realmUrl: targetRealm,
    darkfactoryModuleUrl,
    client,
    workspaceDir,
  });

  // 1b. Retry blocked issues (default on, opt out with --no-retry-blocked)
  if (config.retryBlocked) {
    await retryBlockedIssues(issueStore);
  }

  // 2. Context builder with issue relationship loader
  let issueLoader = new RealmIssueRelationshipLoader({
    workspaceDir,
    realmUrl: targetRealm,
  });
  // One SkillLoader for both the context builder (front-loaded skills +
  // on-demand index) and the read_skill tool, so they share the same
  // library view and per-run cache.
  let skillLibraryDirs = (config.skillLibraryDirs ?? []).map((dir) =>
    resolve(dir),
  );
  let skillLoader = new SkillLoader(undefined, undefined, {
    libraryDirs: skillLibraryDirs,
  });
  if (skillLibraryDirs.length > 0) {
    // Fail fast on a misconfigured library (empty dir, wrong path, skills
    // without frontmatter descriptions) instead of surfacing it as a
    // skill-less agent mid-run. buildIndex throws in that case.
    let index = await skillLoader.buildIndex();
    log.info(
      `Skill library overridden by --skills-dir (${index.length} skill(s)): ` +
        skillLibraryDirs.join(', '),
    );
  }
  let contextBuilder = new ContextBuilder({
    skillResolver: new DefaultSkillResolver({
      enableBoxelUiDiscovery: config.enableBoxelUiDiscovery === true,
    }),
    skillLoader,
    issueLoader,
    enableBoxelUiDiscovery: config.enableBoxelUiDiscovery === true,
  });

  // 3. Tool infrastructure
  let toolRegistry = new ToolRegistry([...REALM_API_TOOLS]);
  let toolExecutor = new ToolExecutor(toolRegistry, {
    packageRoot: PACKAGE_ROOT,
    targetRealm,
    client,
    debug: config.debug,
  });

  let testResultsModuleUrl = new URL(
    'software-factory/test-results',
    realmServerUrl,
  ).href;
  let lintResultsModuleUrl = new URL(
    'software-factory/lint-result',
    realmServerUrl,
  ).href;
  let evalResultsModuleUrl = new URL(
    'software-factory/eval-result',
    realmServerUrl,
  ).href;
  let instantiateResultsModuleUrl = new URL(
    'software-factory/instantiate-result',
    realmServerUrl,
  ).href;
  let parseResultsModuleUrl = new URL(
    'software-factory/parse-result',
    realmServerUrl,
  ).href;
  let hostAppUrl = config.hostAppUrl ?? realmServerUrl;
  // One sync gate + one validation-run cache per loop: the gate skips
  // workspace→realm syncs when nothing changed since the last successful
  // sync, and the cache lets the post-signal_done validation pipeline reuse
  // engine runs the agent's mid-turn run_* tools already executed against
  // the same workspace state.
  let syncGate = new WorkspaceSyncGate(workspaceDir, () =>
    syncWorkspaceToRealm(client, targetRealm, workspaceDir),
  );
  // Time every sync through one stopwatch. Both the loop's own syncs and the
  // realm-touching `run_*` tool syncs (which fire inside `agent.run`) go
  // through this `syncWorkspace`, so the loop can read `getSyncElapsedMs()` to
  // attribute tool-triggered sync time to sync rather than agent time.
  let syncElapsedMs = 0;
  let syncWorkspace = async () => {
    let start = Date.now();
    try {
      return await syncGate.sync();
    } finally {
      syncElapsedMs += Date.now() - start;
    }
  };
  let getSyncElapsedMs = () => syncElapsedMs;
  let validationCache = new ValidationRunCache(workspaceDir, { syncGate });
  let toolBuilderConfig: ToolBuilderConfig = {
    targetRealm,
    realmServerUrl,
    client,
    workspaceDir,
    testResultsModuleUrl,
    hostAppUrl,
    syncWorkspace,
    validationCache,
    skillReader: skillLoader,
  };

  let tools: FactoryTool[] = buildFactoryTools(
    toolBuilderConfig,
    toolExecutor,
    toolRegistry,
  );

  // 4. Agent
  let provider: FactoryAgentProvider = config.agent ?? 'claude';
  let agent: LoopAgent;
  if (config.agentOverride) {
    agent = config.agentOverride;
    log.info(`Agent backend: override (${agent.constructor.name})`);
  } else {
    let built = createLoopAgentWithLabel({
      provider,
      openRouterModel: config.openRouterModel,
      openRouterApiKey: config.openRouterApiKey,
      realmServerUrl,
      client,
      debug: config.debug,
      workspaceDir,
    });
    agent = built.agent;
    // For the claude backend, the specific model is only known after the
    // Agent SDK's first `init` event — `ClaudeCodeFactoryAgent` logs a
    // single `Agent backend: claude (model=<id>)` line there to avoid a
    // redundant "backend without model" line here.
    if (provider !== 'claude') {
      log.info(`Agent backend: ${built.label}`);
    }
  }

  // 5. Validator factory
  let createValidator = (issueId: string) =>
    createDefaultPipeline({
      client,
      realmServerUrl,
      hostAppUrl,
      testResultsModuleUrl,
      lintResultsModuleUrl,
      evalResultsModuleUrl,
      instantiateResultsModuleUrl,
      parseResultsModuleUrl,
      workspaceDir,
      issueId,
      fetchFilenames: (realmUrl: string) => client.listFiles(realmUrl),
      cache: validationCache,
    });

  // 6. Run issue loop
  log.info(`Starting issue loop: targetRealm=${targetRealm}`);

  let issueLoopConfig: IssueLoopConfig = {
    agent,
    contextBuilder,
    tools,
    issueStore,
    createValidator,
    targetRealm,
    darkfactoryModuleUrl,
    workspaceDir,
    syncWorkspace,
    briefUrl: config.briefUrl,
    maxIterationsPerIssue: config.maxIterationsPerIssue,
    maxOuterCycles: config.maxOuterCycles,
    debug: config.debug,
    getSyncElapsedMs,
    onBootstrapComplete: config.onBootstrapComplete,
  };

  try {
    return await runIssueLoop(issueLoopConfig);
  } finally {
    // Some agents (notably `OpencodeFactoryAgent`) hold persistent
    // backend state across iterations — long-lived opencode subprocess
    // + MCP server + JWT'd HTTP client. Tear that down here so a
    // crash mid-loop doesn't orphan an opencode process holding
    // port 4096.
    if (typeof agent.close === 'function') {
      await agent.close().catch((err) => {
        log.warn(`agent.close() failed: ${String(err)}`);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Agent backend dispatcher
// ---------------------------------------------------------------------------

export interface CreateLoopAgentConfig {
  provider: FactoryAgentProvider;
  /** Only used when provider === 'openrouter'. */
  openRouterModel?: string;
  /**
   * Optional OpenRouter API key. When set, the opencode-backed
   * `--agent openrouter` path uses it directly; when unset, the agent
   * falls back to the realm-server `/_openrouter/chat/completions`
   * passthrough (boxel tokens). Read from CLI flag
   * `--openrouter-api-key` or env `OPENROUTER_API_KEY`.
   */
  openRouterApiKey?: string;
  realmServerUrl: string;
  client: BoxelCLIClient;
  debug?: boolean;
  /**
   * Factory workspace directory. Both the Claude path and the
   * opencode-backed OpenRouter path use this as their cwd so native
   * fs tools resolve realm-relative paths inside the workspace.
   */
  workspaceDir?: string;
}

/**
 * Fail fast when a `--agent` provider is recognized but not yet implemented.
 *
 * Call this before doing any work that has observable side effects (brief
 * fetch, realm bootstrap, seed-issue creation) so an unsupported backend
 * doesn't leave half-created state behind. It is also called defensively
 * inside `createLoopAgent()` so a caller that skips the early check still
 * errors out before the agent is used.
 */
export function assertAgentProviderImplemented(
  provider: FactoryAgentProvider,
): void {
  if (provider === 'codex') {
    throw new Error(
      'Codex CLI native agent is not yet implemented. ' +
        'Re-run with --agent openrouter.',
    );
  }
}

export function createLoopAgent(config: CreateLoopAgentConfig): LoopAgent {
  return createLoopAgentWithLabel(config).agent;
}

/**
 * Variant of `createLoopAgent` that also returns a human-readable label for
 * logging (e.g., `"openrouter (model=anthropic/claude-opus-4)"`). The wiring
 * logs the label so operators can tell at a glance which backend — and, for
 * OpenRouter, which model — is driving the run.
 */
export function createLoopAgentWithLabel(config: CreateLoopAgentConfig): {
  agent: LoopAgent;
  label: string;
} {
  assertAgentProviderImplemented(config.provider);
  switch (config.provider) {
    case 'claude':
      return {
        agent: new ClaudeCodeFactoryAgent({
          debug: config.debug,
          workspaceDir: config.workspaceDir,
        }),
        label: 'claude',
      };

    case 'codex':
      // Unreachable — assertAgentProviderImplemented() threw above. The
      // case remains so exhaustiveness checks on FactoryAgentProvider stay
      // meaningful if a future provider reuses this pattern.
      throw new Error('unreachable');

    case 'openrouter': {
      let model =
        config.openRouterModel && config.openRouterModel.trim() !== ''
          ? config.openRouterModel.trim()
          : FACTORY_DEFAULT_OPENROUTER_MODEL;
      if (!config.workspaceDir) {
        throw new Error(
          '--agent openrouter requires a workspaceDir — opencode mounts ' +
            'it as cwd for native fs tools.',
        );
      }
      let apiKey =
        config.openRouterApiKey && config.openRouterApiKey.trim() !== ''
          ? config.openRouterApiKey.trim()
          : (process.env.OPENROUTER_API_KEY?.trim() ?? undefined);
      let mode = apiKey ? 'direct' : 'passthrough';
      return {
        agent: new OpencodeFactoryAgent({
          model,
          realmServerUrl: config.realmServerUrl,
          client: config.client,
          openRouterApiKey: apiKey,
          workspaceDir: config.workspaceDir,
          debug: config.debug,
        }),
        label: `openrouter (model=${model}, mode=${mode})`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Workspace sync helper
// ---------------------------------------------------------------------------

/**
 * Push the factory workspace to the target realm, preferring local changes.
 *
 * Called after each agent turn (so prerenderer-backed validators see the
 * agent's writes) and after each validator run (so artifact cards appear
 * in the Boxel UI). Logs but never throws — sync issues should surface as
 * failed validation, not exceptions in the orchestrator.
 */
export interface WorkspaceSyncOutcome {
  ok: boolean;
  error?: string;
}

export async function syncWorkspaceToRealm(
  client: BoxelCLIClient,
  targetRealm: string,
  workspaceDir: string,
): Promise<WorkspaceSyncOutcome> {
  try {
    let result = await withStdoutRedirected(() =>
      client.sync(targetRealm, workspaceDir, { preferLocal: true }),
    );
    if (result.error || result.hasError) {
      // Emit a structured, attributed failure trace so a sync error leaves a
      // usable record on its own — instead of "see prior log lines", which
      // means scraping the CLI's interleaved progress output after the fact.
      let counts =
        `pushed=${result.pushed.length}, pulled=${result.pulled.length}, ` +
        `remoteDeleted=${result.remoteDeleted.length}, ` +
        `localDeleted=${result.localDeleted.length}, ` +
        `skippedConflicts=${result.skippedConflicts.length}`;
      log.warn(`Workspace sync FAILED — ${counts}`);
      if (result.error) {
        // The realm-server's JSON:API error payload (e.g. the 500 "Write
        // Error" body), not just the HTTP status line.
        log.warn(`  realm-server response: ${result.error}`);
      }
      if (result.skippedConflicts.length > 0) {
        log.warn(
          `  skipped (conflicting) paths: ${result.skippedConflicts.join(', ')}`,
        );
      }
      // Note: the attempted-batch manifest isn't in SyncResult — on a fatal
      // atomic upload nothing lands in `pushed`. The attempted paths appear in
      // the CLI progress lines (routed to stderr above); surfacing them in the
      // result itself is a boxel-cli follow-up.
      return {
        ok: false,
        error:
          result.error ??
          `Workspace sync completed with per-file errors (${counts}).`,
      };
    }
    return { ok: true };
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    log.warn(`Workspace sync threw: ${message}`);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Retry blocked issues
// ---------------------------------------------------------------------------

export async function retryBlockedIssues(
  issueStore: IssueStore,
): Promise<void> {
  let issues = await issueStore.listIssues();
  let resetCount = 0;

  // Build a status map so we can check if blockers are actually unresolved
  let statusMap = new Map<string, string>();
  for (let issue of issues) {
    statusMap.set(issue.id, issue.status);
  }

  for (let issue of issues) {
    if (issue.status !== 'blocked') continue;

    // Only retry issues blocked by validation/max-iterations,
    // NOT issues with unresolved dependency blockers.
    // blockedBy relationships persist even after blockers complete,
    // so we check whether any blocker is actually non-done.
    let hasUnresolvedBlocker = issue.blockedBy.some(
      (blockerId) => statusMap.get(blockerId) !== 'done',
    );
    if (hasUnresolvedBlocker) {
      log.info(
        `Retry: skipping "${issue.id}" — has unresolved dependency blockers`,
      );
      continue;
    }

    await issueStore.addComment(issue.id, {
      body: '**Retry:** resetting blocked status to backlog for another attempt.',
      author: 'orchestrator',
    });
    // Set priority to critical so the scheduler picks retried issues first
    await issueStore.updateIssue(issue.id, {
      status: 'backlog',
      priority: 'critical',
    });
    log.info(
      `Retry: reset blocked issue "${issue.id}" to backlog (priority: critical)`,
    );
    resetCount++;
  }

  if (resetCount > 0) {
    log.info(`Retry: reset ${resetCount} blocked issue(s) to backlog`);
  } else {
    log.info('Retry: no eligible blocked issues found to reset');
  }
}
