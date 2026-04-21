/**
 * Issue-loop wiring for the factory:go entrypoint.
 *
 * Constructs all components needed for the issue-driven loop and runs it:
 * - BoxelCLIClient (auth is owned by the CLI profile, not the factory)
 * - RealmIssueStore for issue scheduling
 * - RealmIssueRelationshipLoader for context building
 * - ContextBuilder with issue-aware mode
 * - ToolRegistry, ToolExecutor, FactoryTool[] via buildFactoryTools
 * - OpenRouterFactoryAgent as the LoopAgent
 * - ValidationPipeline as the Validator
 * - runIssueLoop() invocation
 */

import { resolve } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import { logger } from './logger';

import {
  ClaudeCodeFactoryAgent,
  OpenRouterFactoryAgent,
  FACTORY_DEFAULT_OPENROUTER_MODEL,
  type FactoryAgentConfig,
  type FactoryAgentProvider,
  type LoopAgent,
} from './factory-agent';
import { ContextBuilder } from './factory-context-builder';
import { inferDarkfactoryModuleUrl } from './factory-seed';
import { DefaultSkillResolver, SkillLoader } from './factory-skill-loader';
import {
  buildFactoryTools,
  type FactoryTool,
  type ToolBuilderConfig,
} from './factory-tool-builder';
import { ToolExecutor } from './factory-tool-executor';
import {
  ToolRegistry,
  SCRIPT_TOOLS,
  REALM_API_TOOLS,
} from './factory-tool-registry';
import {
  runIssueLoop,
  createDefaultPipeline,
  type IssueLoopConfig,
  type IssueLoopResult,
} from './issue-loop';
import { RealmIssueStore, type IssueStore } from './issue-scheduler';
import { RealmIssueRelationshipLoader } from './realm-issue-relationship-loader';
import { fetchCardTypeSchema } from './darkfactory-schemas';

let log = logger('factory-issue-loop-wiring');

const PACKAGE_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueLoopWiringConfig {
  briefUrl: string;
  targetRealmUrl: string;
  realmServerUrl: string;
  ownerUsername: string;
  /** Boxel CLI client — owns all realm auth and API calls. */
  client: BoxelCLIClient;
  /** Which LLM backend to use. Defaults to 'claude'. */
  agent?: FactoryAgentProvider;
  /** Explicit OpenRouter model id; only honoured when agent === 'openrouter'. */
  openRouterModel?: string;
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
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runFactoryIssueLoop(
  config: IssueLoopWiringConfig,
): Promise<IssueLoopResult> {
  let targetRealmUrl = ensureTrailingSlash(config.targetRealmUrl);
  let realmServerUrl = ensureTrailingSlash(config.realmServerUrl);
  let client = config.client;

  // 1. Issue store
  let darkfactoryModuleUrl = inferDarkfactoryModuleUrl(targetRealmUrl);
  let issueStore = new RealmIssueStore({
    realmUrl: targetRealmUrl,
    darkfactoryModuleUrl,
    client,
  });

  // 1b. Retry blocked issues (default on, opt out with --no-retry-blocked)
  if (config.retryBlocked) {
    await retryBlockedIssues(issueStore);
  }

  // 2. Context builder with issue relationship loader
  let issueLoader = new RealmIssueRelationshipLoader({
    realmUrl: targetRealmUrl,
    client,
  });
  let contextBuilder = new ContextBuilder({
    skillResolver: new DefaultSkillResolver(),
    skillLoader: new SkillLoader(),
    issueLoader,
  });

  // 3. Tool infrastructure
  let toolRegistry = new ToolRegistry([...SCRIPT_TOOLS, ...REALM_API_TOOLS]);
  let toolExecutor = new ToolExecutor(toolRegistry, {
    packageRoot: PACKAGE_ROOT,
    targetRealmUrl,
    client,
  });

  let darkfactoryModuleBase = new URL('software-factory/', realmServerUrl).href;
  let cardTypeSchemas = await loadDarkFactorySchemas(
    client,
    realmServerUrl,
    targetRealmUrl,
    darkfactoryModuleBase,
  );

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
  let toolBuilderConfig: ToolBuilderConfig = {
    targetRealmUrl,
    darkfactoryModuleUrl,
    realmServerUrl,
    client,
    testResultsModuleUrl,
    cardTypeSchemas,
    hostAppUrl,
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
      realmServerUrl,
      client,
      debug: config.debug,
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
      issueId,
      fetchFilenames: (realmUrl: string) => client.listFiles(realmUrl),
    });

  // 6. Run issue loop
  log.info(`Starting issue loop: targetRealm=${targetRealmUrl}`);

  let issueLoopConfig: IssueLoopConfig = {
    agent,
    contextBuilder,
    tools,
    issueStore,
    createValidator,
    targetRealmUrl,
    briefUrl: config.briefUrl,
    maxIterationsPerIssue: config.maxIterationsPerIssue,
    maxOuterCycles: config.maxOuterCycles,
  };

  return runIssueLoop(issueLoopConfig);
}

// ---------------------------------------------------------------------------
// Agent backend dispatcher
// ---------------------------------------------------------------------------

export interface CreateLoopAgentConfig {
  provider: FactoryAgentProvider;
  /** Only used when provider === 'openrouter'. */
  openRouterModel?: string;
  realmServerUrl: string;
  client: BoxelCLIClient;
  debug?: boolean;
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
        'Re-run with --agent openrouter (tracked in CS-10594).',
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
        agent: new ClaudeCodeFactoryAgent({ debug: config.debug }),
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
      return {
        agent: new OpenRouterFactoryAgent({
          model,
          realmServerUrl: config.realmServerUrl,
          client: config.client,
          debug: config.debug,
        } satisfies FactoryAgentConfig),
        label: `openrouter (model=${model})`,
      };
    }
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

// ---------------------------------------------------------------------------
// DarkFactory schema loading
// ---------------------------------------------------------------------------

const DARKFACTORY_CARD_TYPES = ['Project', 'Issue', 'KnowledgeArticle'];
const BASE_CARD_TYPES: { module: string; name: string }[] = [
  { module: 'https://cardstack.com/base/spec', name: 'Spec' },
];

async function loadDarkFactorySchemas(
  client: BoxelCLIClient,
  realmServerUrl: string,
  commandRealmUrl: string,
  darkfactoryModuleBase: string,
): Promise<
  | Map<
      string,
      {
        attributes: Record<string, unknown>;
        relationships?: Record<string, unknown>;
      }
    >
  | undefined
> {
  let darkfactoryModule = `${ensureTrailingSlash(darkfactoryModuleBase)}darkfactory`;
  let schemas = new Map<
    string,
    {
      attributes: Record<string, unknown>;
      relationships?: Record<string, unknown>;
    }
  >();

  for (let cardName of DARKFACTORY_CARD_TYPES) {
    try {
      let schema = await fetchCardTypeSchema(
        client,
        realmServerUrl,
        commandRealmUrl,
        { module: darkfactoryModule, name: cardName },
      );
      if (schema) {
        schemas.set(cardName, schema);
      }
    } catch (error) {
      log.warn(
        `Could not fetch schema for ${cardName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  for (let { module: mod, name } of BASE_CARD_TYPES) {
    try {
      let schema = await fetchCardTypeSchema(
        client,
        realmServerUrl,
        commandRealmUrl,
        { module: mod, name },
      );
      if (schema) {
        schemas.set(name, schema);
      }
    } catch (error) {
      log.warn(
        `Could not fetch schema for ${name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return schemas.size > 0 ? schemas : undefined;
}
