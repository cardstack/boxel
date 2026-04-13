/**
 * Factory implement wiring module (CS-10569).
 *
 * Wires the execution loop into `factory:go --mode implement`. Constructs
 * all the components needed for the loop and runs it:
 *
 * - ToolRegistry (SCRIPT_TOOLS + REALM_API_TOOLS)
 * - ToolExecutor for subprocess/HTTP execution
 * - FactoryTool[] via buildFactoryTools
 * - ContextBuilder for AgentContext assembly
 * - LoopAgent (ToolUseFactoryAgent)
 * - TestRunner callback
 * - runFactoryLoop() invocation
 */

import { resolve } from 'node:path';

import { logger } from './logger';

import type {
  IssueData,
  KnowledgeArticleData,
  ProjectData,
  TestResult,
} from './factory-agent';
import {
  resolveFactoryModel,
  ToolUseFactoryAgent,
  type FactoryAgentConfig,
} from './factory-agent';
import { createRealmFetch, createServerFetch } from '@cardstack/boxel-cli';
import { ContextBuilder } from './factory-context-builder';
import {
  runFactoryLoop,
  type FactoryLoopResult,
  type LoopAgent,
  type TestRunner,
} from './factory-loop';
import { DefaultSkillResolver, SkillLoader } from './factory-skill-loader';
import {
  buildFactoryTools,
  type FactoryTool,
  type ToolBuilderConfig,
  type ToolCallEntry,
} from './factory-tool-builder';
import { ToolExecutor } from './factory-tool-executor';
import {
  ToolRegistry,
  SCRIPT_TOOLS,
  REALM_API_TOOLS,
} from './factory-tool-registry';
import {
  ensureTrailingSlash,
  readFile,
  waitForRealmFile,
  writeFile,
  type RealmFetchOptions,
} from './realm-operations';
import { executeTestRunFromRealm } from './test-run-execution';
import { fetchCardTypeSchema } from './darkfactory-schemas';

import type { FactoryBootstrapResult } from './factory-bootstrap';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

let log = logger('factory-implement');

const PACKAGE_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImplementConfig {
  /** URL of the brief card that drives the flow. */
  briefUrl: string;
  /** Target realm URL where implementation artifacts land. */
  targetRealmUrl: string;
  /** Realm server URL for management operations. */
  realmServerUrl: string;
  /** Owner username (Matrix user). */
  ownerUsername: string;
  /** Bootstrap result with project/ticket/knowledge IDs. */
  bootstrapResult: FactoryBootstrapResult;
  /** OpenRouter model ID (e.g., "anthropic/claude-sonnet-4"). */
  model?: string;
  /** Maximum loop iterations before giving up. Default: 5. */
  maxIterations?: number;
  /** Log LLM prompts and responses to stderr. */
  debug?: boolean;
  /**
   * Override fetch (testing only). Production code uses createRealmFetch /
   * createServerFetch from @cardstack/boxel-cli, which already attach the
   * correct JWT for each call.
   */
  fetch?: typeof globalThis.fetch;
  /** Override the agent (injectable for testing). */
  agent?: LoopAgent;
  /** Override the test runner (injectable for testing). */
  testRunner?: TestRunner;
  /** Host app URL for QUnit live-test page. Defaults to compat proxy URL. */
  hostAppUrl?: string;
}

export interface ImplementResult {
  outcome: FactoryLoopResult['outcome'];
  iterations: number;
  toolCallLog: FactoryLoopResult['toolCallLog'];
  testResults?: TestResult;
  message?: string;
  /** The issue that was worked on. */
  issueId: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runFactoryImplement(
  config: ImplementConfig,
): Promise<ImplementResult> {
  let targetRealmUrl = ensureTrailingSlash(config.targetRealmUrl);
  let realmServerUrl = ensureTrailingSlash(config.realmServerUrl);
  // Production: an auth-aware fetch bound to the target realm. Tests can
  // inject a stub via config.fetch to bypass the network entirely.
  let fetchImpl = config.fetch ?? createRealmFetch(targetRealmUrl);
  let serverFetch = config.fetch ?? createServerFetch();

  // 1. Fetch card data from the realm
  let fetchOptions: RealmFetchOptions = { fetch: fetchImpl };
  let { project, issue, knowledge } = await fetchCardData(
    targetRealmUrl,
    config.bootstrapResult,
    fetchOptions,
  );

  // 2. Build tool infrastructure
  let toolRegistry = new ToolRegistry([...SCRIPT_TOOLS, ...REALM_API_TOOLS]);
  let toolExecutor = new ToolExecutor(toolRegistry, {
    packageRoot: PACKAGE_ROOT,
    targetRealmUrl,
    fetch: fetchImpl,
  });

  // Fetch card type schemas for typed tool parameters.
  // The _run-command targets the user's target realm (where they have
  // permissions). The codeRef module URLs point to the source realm
  // (software-factory/) where darkfactory.gts lives — the card loader
  // resolves cross-realm module references.
  let darkfactoryModuleBase = new URL('software-factory/', realmServerUrl).href;
  let cardTypeSchemas = await loadDarkFactorySchemas(
    realmServerUrl,
    targetRealmUrl,
    darkfactoryModuleBase,
    { fetch: serverFetch },
  );

  let testResultsModuleUrl = `${new URL('software-factory/test-results', realmServerUrl).href}`;
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

  // 3. Build context infrastructure
  let contextBuilder = new ContextBuilder({
    skillResolver: new DefaultSkillResolver(),
    skillLoader: new SkillLoader(),
  });

  // 4. Build agent
  let model = resolveFactoryModel(config.model);
  let agent: LoopAgent =
    config.agent ??
    new ToolUseFactoryAgent({
      model,
      realmServerUrl,
      debug: config.debug,
    } satisfies FactoryAgentConfig);

  // 5. Set up test runner with a shared tool call log.
  // Wrap the agent to intercept tool calls so the TestRunner
  // can find which test files the agent wrote.
  let sharedToolCallLog: ToolCallEntry[] = [];
  let wrappedAgent: LoopAgent = {
    async run(ctx, t) {
      let result = await agent.run(ctx, t);
      sharedToolCallLog.push(...result.toolCalls);
      return result;
    },
  };
  let testRunner: TestRunner =
    config.testRunner ??
    buildTestRunner(targetRealmUrl, issue, sharedToolCallLog, {
      fetch: fetchImpl,
      realmServerUrl,
      hostAppUrl,
    });

  // 7. Run the execution loop
  let loopResult = await runFactoryLoop({
    agent: wrappedAgent,
    contextBuilder,
    tools,
    testRunner,
    project,
    issue,
    knowledge,
    targetRealmUrl,
    maxIterations: config.maxIterations,
  });

  // 6. Post-loop: update issue status on success
  if (loopResult.outcome === 'tests_passed' || loopResult.outcome === 'done') {
    try {
      await updateIssueStatus(targetRealmUrl, issue.id, 'done', fetchOptions);
      log.info('Updated issue status to done');
    } catch (error) {
      log.warn(
        `Could not update issue status: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    outcome: loopResult.outcome,
    iterations: loopResult.iterations,
    toolCallLog: loopResult.toolCallLog,
    testResults: loopResult.testResults,
    message: loopResult.message,
    issueId: issue.id,
  };
}

// ---------------------------------------------------------------------------
// Card data fetching
// ---------------------------------------------------------------------------

async function fetchCardData(
  targetRealmUrl: string,
  bootstrapResult: FactoryBootstrapResult,
  fetchOptions: RealmFetchOptions,
): Promise<{
  project: ProjectData;
  issue: IssueData;
  knowledge: KnowledgeArticleData[];
}> {
  // Fetch the project card
  let project = await fetchCard(
    targetRealmUrl,
    bootstrapResult.project.id,
    fetchOptions,
  );

  // Fetch the active issue card
  let issue = await fetchCard(
    targetRealmUrl,
    bootstrapResult.activeIssue.id,
    fetchOptions,
  );

  // Fetch all knowledge articles
  let knowledge: KnowledgeArticleData[] = [];
  for (let ka of bootstrapResult.knowledgeArticles) {
    try {
      let card = await fetchCard(targetRealmUrl, ka.id, fetchOptions);
      knowledge.push(card);
    } catch {
      // Non-fatal: knowledge articles are supplementary
      log.warn(`Could not fetch knowledge article: ${ka.id}`);
    }
  }

  return { project, issue, knowledge };
}

async function fetchCard(
  realmUrl: string,
  cardId: string,
  fetchOptions: RealmFetchOptions,
): Promise<{ id: string; [key: string]: unknown }> {
  let result = await readFile(realmUrl, cardId, fetchOptions);

  if (!result.ok || !result.document) {
    throw new Error(
      `Failed to fetch card ${cardId} from ${realmUrl}: ${result.error ?? 'unknown error'}`,
    );
  }

  let doc = result.document;
  return {
    id: cardId,
    ...doc.data.attributes,
    ...(doc.data.relationships
      ? { relationships: doc.data.relationships }
      : {}),
    meta: doc.data.meta,
  };
}

// ---------------------------------------------------------------------------
// Test runner builder
// ---------------------------------------------------------------------------

interface TestRunnerConfig {
  fetch?: typeof globalThis.fetch;
  realmServerUrl: string;
  hostAppUrl: string;
}

/**
 * Build a TestRunner that checks the tool call log for QUnit test files
 * and executes them via executeTestRunFromRealm().
 *
 * Creates TestRun cards in the target realm's Test Runs/ folder and
 * returns structured TestResult for the orchestrator's iterate-or-pass
 * decision.
 */
function buildTestRunner(
  targetRealmUrl: string,
  issue: IssueData,
  toolCallLog: ToolCallEntry[],
  runConfig: TestRunnerConfig,
): TestRunner {
  let lastSequenceNumber = 0;
  return async (): Promise<TestResult> => {
    let wroteTestFiles = toolCallLog.some(
      (entry) =>
        entry.tool === 'write_file' &&
        typeof entry.args.path === 'string' &&
        entry.args.path.endsWith('.test.gts'),
    );

    if (!wroteTestFiles) {
      return {
        status: 'failed',
        passedCount: 0,
        failedCount: 1,
        failures: [
          {
            testName: 'test-discovery',
            error:
              'No .test.gts test files found. Every issue must include at least one test file.',
          },
        ],
        durationMs: 0,
      };
    }

    // Wait for written test files to be accessible in the realm before
    // launching QUnit. Realm indexing is asynchronous, so newly written
    // files may not appear in _mtimes immediately.
    let testFilePaths = toolCallLog
      .filter(
        (entry) =>
          entry.tool === 'write_file' &&
          typeof entry.args.path === 'string' &&
          entry.args.path.endsWith('.test.gts'),
      )
      .map((entry) => entry.args.path as string);

    for (let testPath of testFilePaths) {
      await waitForRealmFile(targetRealmUrl, testPath, {
        fetch: runConfig.fetch,
        pollMs: 300,
        timeoutMs: 30_000,
      });
    }

    let slug = deriveIssueSlug(issue.id);
    let start = Date.now();

    try {
      log.info(`Running test file(s) for issue: ${slug}`);

      let handle = await executeTestRunFromRealm({
        targetRealmUrl,
        testResultsModuleUrl: `${ensureTrailingSlash(runConfig.realmServerUrl)}software-factory/test-results`,
        slug,
        testNames: [],
        fetch: runConfig.fetch,
        realmServerUrl: runConfig.realmServerUrl,
        hostAppUrl: runConfig.hostAppUrl,
        forceNew: true,
        lastSequenceNumber,
      });

      // Track the sequence number so the next iteration doesn't reuse it
      // even if the realm search index hasn't caught up yet.
      if (handle.sequenceNumber != null) {
        lastSequenceNumber = handle.sequenceNumber;
      }

      let durationMs = Date.now() - start;
      log.info(`Test run complete: status=${handle.status} (${durationMs}ms)`);

      if (handle.status === 'passed') {
        return {
          status: 'passed',
          passedCount: 1,
          failedCount: 0,
          failures: [],
          durationMs,
        };
      } else if (handle.status === 'failed') {
        // Read the TestRun card to get detailed failure info
        let failures = await readTestRunFailures(
          targetRealmUrl,
          handle.testRunId,
          { fetch: runConfig.fetch },
        );
        return {
          status: 'failed',
          passedCount: 0,
          failedCount: failures.length || 1,
          failures:
            failures.length > 0
              ? failures
              : [
                  {
                    testName: slug,
                    error: handle.errorMessage ?? 'Tests failed',
                  },
                ],
          durationMs,
        };
      } else {
        return {
          status: 'error',
          passedCount: 0,
          failedCount: 0,
          failures: [
            {
              testName: slug,
              error: handle.errorMessage ?? 'Test execution error',
            },
          ],
          durationMs,
        };
      }
    } catch (error) {
      let durationMs = Date.now() - start;
      log.error(
        `Test execution error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        status: 'error',
        passedCount: 0,
        failedCount: 0,
        failures: [
          {
            testName: slug,
            error: error instanceof Error ? error.message : String(error),
          },
        ],
        durationMs,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// TestRun failure extraction
// ---------------------------------------------------------------------------

/**
 * Read a TestRun card from the realm and extract failure details.
 * The TestRun card has moduleResults containing individual test results.
 */
async function readTestRunFailures(
  realmUrl: string,
  testRunId: string,
  fetchOptions: RealmFetchOptions,
): Promise<{ testName: string; error: string; stackTrace?: string }[]> {
  try {
    // testRunId is a full URL — extract the realm-relative path
    let path: string;
    try {
      let url = new URL(testRunId);
      let realmBase = ensureTrailingSlash(realmUrl);
      path = url.href.startsWith(realmBase)
        ? url.href.slice(realmBase.length)
        : url.pathname.slice(1);
    } catch {
      path = testRunId;
    }

    let result = await readFile(realmUrl, path, fetchOptions);
    if (!result.ok || !result.document) {
      return [];
    }

    let attrs = result.document.data.attributes as Record<string, unknown>;
    let moduleResults = attrs.moduleResults as
      | {
          results?: {
            testName?: string;
            status?: string;
            message?: string;
            stackTrace?: string;
          }[];
        }[]
      | undefined;

    if (!moduleResults) return [];

    let failures: { testName: string; error: string; stackTrace?: string }[] =
      [];
    for (let mod of moduleResults) {
      for (let r of mod.results ?? []) {
        if (r.status === 'failed' || r.status === 'error') {
          failures.push({
            testName: r.testName ?? 'unknown',
            error: r.message ?? 'Test failed',
            stackTrace: r.stackTrace,
          });
        }
      }
    }

    return failures;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Issue slug derivation
// ---------------------------------------------------------------------------

/**
 * Derive an issue slug from an issue ID.
 * e.g., "Issues/sticky-note-define-core" → "sticky-note-define-core"
 */
function deriveIssueSlug(issueId: string): string {
  let parts = issueId.split('/');
  return parts[parts.length - 1];
}

// ---------------------------------------------------------------------------
// Post-loop updates
// ---------------------------------------------------------------------------

/**
 * Update the status field on an issue card in the target realm.
 * Reads the current card, sets the new status, and writes it back.
 */
async function updateIssueStatus(
  realmUrl: string,
  issueId: string,
  status: string,
  fetchOptions: RealmFetchOptions,
): Promise<void> {
  let result = await readFile(realmUrl, issueId, fetchOptions);
  if (!result.ok || !result.document) {
    throw new Error(
      `Cannot read issue ${issueId}: ${result.error ?? 'unknown'}`,
    );
  }

  let doc = result.document;
  doc.data.attributes = {
    ...doc.data.attributes,
    status,
  };

  let writeResult = await writeFile(
    realmUrl,
    issueId,
    JSON.stringify(doc, null, 2),
    fetchOptions,
  );
  if (!writeResult.ok) {
    throw new Error(
      `Failed to write issue ${issueId}: ${writeResult.error ?? 'unknown'}`,
    );
  }
}

// ---------------------------------------------------------------------------
// DarkFactory schema loading
// ---------------------------------------------------------------------------

const DARKFACTORY_CARD_TYPES = ['Project', 'Issue', 'KnowledgeArticle'];

/** Card types from base that the factory also needs schemas for. */
const BASE_CARD_TYPES: { module: string; name: string }[] = [
  { module: 'https://cardstack.com/base/spec', name: 'Spec' },
];

/**
 * Fetch JSON schemas for card types the factory uses. Includes both
 * DarkFactory types (Project, Issue, KnowledgeArticle) from the target
 * realm and base types (Spec) from the base realm. Returns a Map
 * suitable for passing to ToolBuilderConfig.cardTypeSchemas.
 */
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

  // Fetch base card type schemas (e.g., Spec from cardstack.com/base)
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

// Re-export for convenience
export type { FactoryLoopResult } from './factory-loop';
