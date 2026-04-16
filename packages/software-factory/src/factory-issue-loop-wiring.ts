/**
 * Issue-loop wiring for the factory:go entrypoint (Phase 2).
 *
 * Constructs all components needed for the issue-driven loop and runs it:
 * - Auth resolution
 * - RealmIssueStore for issue scheduling
 * - RealmIssueRelationshipLoader for context building
 * - ContextBuilder with issue-aware mode
 * - ToolRegistry, ToolExecutor, FactoryTool[] via buildFactoryTools
 * - ToolUseFactoryAgent as the LoopAgent
 * - ValidationPipeline as the Validator
 * - runIssueLoop() invocation
 */

import { resolve } from 'node:path';

import { logger } from './logger';

import {
  resolveFactoryModel,
  ToolUseFactoryAgent,
  type FactoryAgentConfig,
} from './factory-agent';
import type { LoopAgent } from './factory-agent-types';
import {
  getActiveProfile,
  matrixLogin,
  getRealmServerToken,
  getAccessibleRealmTokens,
  type ActiveBoxelProfile,
  type MatrixAuth,
  type RealmTokens,
} from './boxel';
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
import {
  ensureTrailingSlash,
  fetchRealmFilenames,
  type RealmFetchOptions,
} from './realm-operations';
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
  authorization: string;
  model?: string;
  debug?: boolean;
  fetch?: typeof globalThis.fetch;
  /** Override the agent (injectable for testing). */
  agent?: LoopAgent;
  /** Override Matrix auth (injectable for testing). */
  matrixAuth?: MatrixAuth;
  /** Override per-realm tokens (injectable for testing). */
  realmTokens?: RealmTokens;
  /** Override server token (injectable for testing). */
  serverToken?: string;
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
  let fetchImpl = config.fetch ?? globalThis.fetch;

  // 1. Auth
  let { serverToken, realmTokens } = await resolveAuth(config);

  let fetchOptions: RealmFetchOptions = {
    authorization: config.authorization,
    fetch: fetchImpl,
  };

  // 2. Issue store
  let darkfactoryModuleUrl = inferDarkfactoryModuleUrl(targetRealmUrl);
  let issueStore = new RealmIssueStore({
    realmUrl: targetRealmUrl,
    darkfactoryModuleUrl,
    options: fetchOptions,
  });

  // 2b. Retry blocked issues (default on, opt out with --no-retry-blocked)
  if (config.retryBlocked) {
    await retryBlockedIssues(issueStore);
  }

  // 3. Context builder with issue relationship loader
  let issueLoader = new RealmIssueRelationshipLoader({
    realmUrl: targetRealmUrl,
    options: fetchOptions,
  });
  let contextBuilder = new ContextBuilder({
    skillResolver: new DefaultSkillResolver(),
    skillLoader: new SkillLoader(),
    issueLoader,
  });

  // 4. Tool infrastructure
  let toolRegistry = new ToolRegistry([...SCRIPT_TOOLS, ...REALM_API_TOOLS]);
  let toolExecutor = new ToolExecutor(toolRegistry, {
    packageRoot: PACKAGE_ROOT,
    targetRealmUrl,
    fetch: fetchImpl,
    authorization: config.authorization,
  });

  let darkfactoryModuleBase = new URL('software-factory/', realmServerUrl).href;
  let cardTypeSchemas = await loadDarkFactorySchemas(
    realmServerUrl,
    targetRealmUrl,
    darkfactoryModuleBase,
    { authorization: serverToken, fetch: fetchImpl },
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
    realmTokens,
    serverToken,
    testResultsModuleUrl,
    fetch: fetchImpl,
    cardTypeSchemas,
    hostAppUrl,
  };

  let tools: FactoryTool[] = buildFactoryTools(
    toolBuilderConfig,
    toolExecutor,
    toolRegistry,
  );

  // 5. Agent
  let model = resolveFactoryModel(config.model);
  let agent: LoopAgent =
    config.agent ??
    new ToolUseFactoryAgent({
      model,
      realmServerUrl,
      authorization: config.authorization,
      debug: config.debug,
    } satisfies FactoryAgentConfig);

  // 6. Validator factory
  let createValidator = (issueId: string) =>
    createDefaultPipeline({
      realmServerUrl,
      authorization: config.authorization,
      serverToken,
      fetch: fetchImpl,
      hostAppUrl,
      testResultsModuleUrl,
      lintResultsModuleUrl,
      evalResultsModuleUrl,
      instantiateResultsModuleUrl,
      parseResultsModuleUrl,
      issueId,
      fetchFilenames: (realmUrl: string) =>
        fetchRealmFilenames(realmUrl, fetchOptions),
    });

  // 7. Run issue loop
  log.info(
    `Starting issue loop: targetRealm=${targetRealmUrl}, model=${model}`,
  );

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
// Auth resolution (adapted from factory-implement.ts)
// ---------------------------------------------------------------------------

async function resolveAuth(config: IssueLoopWiringConfig): Promise<{
  matrixAuth: MatrixAuth | undefined;
  serverToken: string | undefined;
  realmTokens: RealmTokens;
}> {
  if (config.realmTokens) {
    return {
      matrixAuth: config.matrixAuth,
      serverToken: config.serverToken,
      realmTokens: config.realmTokens,
    };
  }

  let matrixAuth: MatrixAuth;
  try {
    if (config.matrixAuth) {
      matrixAuth = config.matrixAuth;
    } else {
      let profile = buildProfileWithCliRealmServer(
        ensureTrailingSlash(config.realmServerUrl),
      );
      matrixAuth = await matrixLogin(profile);
    }
  } catch (error) {
    throw new Error(
      `Matrix login failed. Ensure MATRIX_URL, MATRIX_USERNAME, and MATRIX_PASSWORD are set, ` +
        `and pass --realm-server-url on the CLI.\n${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }

  let serverToken: string;
  try {
    serverToken = config.serverToken ?? (await getRealmServerToken(matrixAuth));
  } catch (error) {
    throw new Error(
      `Failed to get realm server token: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let realmTokens: RealmTokens;
  try {
    realmTokens = await getAccessibleRealmTokens(matrixAuth);
  } catch (error) {
    throw new Error(
      `Failed to get realm tokens: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return { matrixAuth, serverToken, realmTokens };
}

function buildProfileWithCliRealmServer(
  realmServerUrl: string,
): ActiveBoxelProfile {
  try {
    let profile = getActiveProfile();
    return { ...profile, realmServerUrl };
  } catch {
    // No active profile — fall back to env vars
  }

  let matrixUrl = process.env.MATRIX_URL?.trim();
  let username = process.env.MATRIX_USERNAME?.trim();
  let password = process.env.MATRIX_PASSWORD?.trim();

  if (!matrixUrl || !username || !password) {
    throw new Error(
      'No active Boxel profile found and MATRIX_URL/MATRIX_USERNAME/MATRIX_PASSWORD are not fully set.',
    );
  }

  return {
    profileId: null,
    username,
    matrixUrl,
    realmServerUrl,
    password,
  };
}

// ---------------------------------------------------------------------------
// DarkFactory schema loading (adapted from factory-implement.ts)
// ---------------------------------------------------------------------------

const DARKFACTORY_CARD_TYPES = ['Project', 'Issue', 'KnowledgeArticle'];
const BASE_CARD_TYPES: { module: string; name: string }[] = [
  { module: 'https://cardstack.com/base/spec', name: 'Spec' },
];

async function loadDarkFactorySchemas(
  realmServerUrl: string,
  commandRealmUrl: string,
  darkfactoryModuleBase: string,
  options: { authorization?: string; fetch?: typeof globalThis.fetch },
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
        realmServerUrl,
        commandRealmUrl,
        { module: darkfactoryModule, name: cardName },
        options,
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
        realmServerUrl,
        commandRealmUrl,
        { module: mod, name },
        options,
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
