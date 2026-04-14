/**
 * Issue-loop wiring for the factory:go entrypoint (Phase 2).
 *
 * Constructs all components needed for the issue-driven loop and runs it:
 * - RealmIssueStore for issue scheduling
 * - RealmIssueRelationshipLoader for context building
 * - ContextBuilder with issue-aware mode
 * - ToolRegistry, ToolExecutor, FactoryTool[] via buildFactoryTools
 * - ToolUseFactoryAgent as the LoopAgent
 * - ValidationPipeline as the Validator
 * - runIssueLoop() invocation
 *
 * Auth is owned by @cardstack/boxel-cli — this module never touches JWTs.
 */

import { resolve } from 'node:path';

import { logger } from './logger';

import {
  resolveFactoryModel,
  ToolUseFactoryAgent,
  type FactoryAgentConfig,
} from './factory-agent';
import type { LoopAgent } from './factory-agent-types';
import { createRealmFetch, createServerFetch } from '@cardstack/boxel-cli';
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
import { RealmIssueStore } from './issue-scheduler';
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
  model?: string;
  debug?: boolean;
  /**
   * Override fetch (testing only). Production uses createRealmFetch /
   * createServerFetch from @cardstack/boxel-cli for auth-aware requests.
   */
  fetch?: typeof globalThis.fetch;
  /** Override the agent (injectable for testing). */
  agent?: LoopAgent;
  /** Host app URL for QUnit live-test page. */
  hostAppUrl?: string;
  /** Max inner-loop iterations per issue. Default: 5. */
  maxIterationsPerIssue?: number;
  /** Max outer-loop cycles. Default: 50. */
  maxOuterCycles?: number;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runFactoryIssueLoop(
  config: IssueLoopWiringConfig,
): Promise<IssueLoopResult> {
  let targetRealmUrl = ensureTrailingSlash(config.targetRealmUrl);
  let realmServerUrl = ensureTrailingSlash(config.realmServerUrl);
  let fetchImpl = config.fetch ?? createRealmFetch(targetRealmUrl);
  let serverFetch = config.fetch ?? createServerFetch();

  let fetchOptions: RealmFetchOptions = { fetch: fetchImpl };

  // 1. Issue store
  let darkfactoryModuleUrl = inferDarkfactoryModuleUrl(targetRealmUrl);
  let issueStore = new RealmIssueStore({
    realmUrl: targetRealmUrl,
    darkfactoryModuleUrl,
    options: fetchOptions,
  });

  // 2. Context builder with issue relationship loader
  let issueLoader = new RealmIssueRelationshipLoader({
    realmUrl: targetRealmUrl,
    options: fetchOptions,
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
    fetch: fetchImpl,
  });

  let darkfactoryModuleBase = new URL('software-factory/', realmServerUrl).href;
  let cardTypeSchemas = await loadDarkFactorySchemas(
    realmServerUrl,
    targetRealmUrl,
    darkfactoryModuleBase,
    { fetch: serverFetch },
  );

  let testResultsModuleUrl = new URL(
    'software-factory/test-results',
    realmServerUrl,
  ).href;
  let hostAppUrl = config.hostAppUrl ?? realmServerUrl;
  let toolBuilderConfig: ToolBuilderConfig = {
    targetRealmUrl,
    realmServerUrl,
    testResultsModuleUrl,
    fetch: fetchImpl,
    serverFetch,
    cardTypeSchemas,
    hostAppUrl,
  };

  let tools: FactoryTool[] = buildFactoryTools(
    toolBuilderConfig,
    toolExecutor,
    toolRegistry,
  );

  // 4. Agent
  let model = resolveFactoryModel(config.model);
  let agent: LoopAgent =
    config.agent ??
    new ToolUseFactoryAgent({
      model,
      realmServerUrl,
      debug: config.debug,
    } satisfies FactoryAgentConfig);

  // 5. Validator factory
  let createValidator = (issueId: string) =>
    createDefaultPipeline({
      realmServerUrl,
      fetch: fetchImpl,
      hostAppUrl,
      testResultsModuleUrl,
      issueId,
      fetchFilenames: (realmUrl: string) =>
        fetchRealmFilenames(realmUrl, fetchOptions),
    });

  // 6. Run issue loop
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
// DarkFactory schema loading
// ---------------------------------------------------------------------------

const DARKFACTORY_CARD_TYPES = ['Project', 'Issue', 'KnowledgeArticle'];
const BASE_CARD_TYPES: { module: string; name: string }[] = [
  { module: 'https://cardstack.com/base/spec', name: 'Spec' },
];

async function loadDarkFactorySchemas(
  realmServerUrl: string,
  commandRealmUrl: string,
  darkfactoryModuleBase: string,
  options: { fetch?: typeof globalThis.fetch },
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
