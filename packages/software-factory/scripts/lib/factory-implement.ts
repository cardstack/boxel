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

import type {
  KnowledgeArticle,
  ProjectCard,
  TestResult,
  TicketCard,
} from './factory-agent';
import {
  resolveFactoryModel,
  ToolUseFactoryAgent,
  type FactoryAgentConfig,
} from './factory-agent';
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
} from './factory-tool-builder';
import { ToolExecutor, type ToolExecutorConfig } from './factory-tool-executor';
import {
  ToolRegistry,
  SCRIPT_TOOLS,
  REALM_API_TOOLS,
} from './factory-tool-registry';
import {
  ensureTrailingSlash,
  readFile,
  writeFile,
  type RealmFetchOptions,
} from './realm-operations';
import { executeTestRunFromRealm } from './test-run-execution';
import { fetchCardTypeSchema } from './darkfactory-schemas';

import type { FactoryBootstrapResult } from '../../src/factory-bootstrap';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = resolve(__dirname, '../..');

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
  /** Per-realm JWT for the target realm (from bootstrap). */
  authorization: string;
  /** Bootstrap result with project/ticket/knowledge IDs. */
  bootstrapResult: FactoryBootstrapResult;
  /** OpenRouter model ID (e.g., "anthropic/claude-sonnet-4"). */
  model?: string;
  /** Maximum loop iterations before giving up. Default: 5. */
  maxIterations?: number;
  /** Log LLM prompts and responses to stderr. */
  debug?: boolean;
  /** Fetch implementation (injectable for testing). */
  fetch?: typeof globalThis.fetch;
  /** Override the agent (injectable for testing). */
  agent?: LoopAgent;
  /** Override the test runner (injectable for testing). */
  testRunner?: TestRunner;
  /** Override Matrix auth (injectable for testing). */
  matrixAuth?: MatrixAuth;
  /** Override per-realm tokens (injectable for testing). */
  realmTokens?: RealmTokens;
  /** Override server token (injectable for testing). */
  serverToken?: string;
}

export interface ImplementResult {
  outcome: FactoryLoopResult['outcome'];
  iterations: number;
  toolCallLog: FactoryLoopResult['toolCallLog'];
  testResults?: TestResult;
  message?: string;
  /** The ticket that was worked on. */
  ticketId: string;
  /** The test realm URL used. */
  testRealmUrl: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runFactoryImplement(
  config: ImplementConfig,
): Promise<ImplementResult> {
  let targetRealmUrl = ensureTrailingSlash(config.targetRealmUrl);
  let realmServerUrl = ensureTrailingSlash(config.realmServerUrl);
  let fetchImpl = config.fetch ?? globalThis.fetch;

  // 1. Auth: get Matrix auth, server token, and per-realm JWTs
  let { matrixAuth, serverToken, realmTokens } = await resolveAuth(config);

  // 2. Derive test realm URL from target realm
  let testRealmUrl = deriveTestRealmUrl(targetRealmUrl);

  // 3. Fetch card data from the realm
  let fetchOptions: RealmFetchOptions = {
    authorization: config.authorization,
    fetch: fetchImpl,
  };
  let { project, ticket, knowledge } = await fetchCardData(
    targetRealmUrl,
    config.bootstrapResult,
    fetchOptions,
  );

  // 4. Build tool infrastructure
  let toolRegistry = new ToolRegistry([...SCRIPT_TOOLS, ...REALM_API_TOOLS]);
  let toolExecutor = new ToolExecutor(toolRegistry, {
    packageRoot: PACKAGE_ROOT,
    targetRealmUrl,
    testRealmUrl,
    fetch: fetchImpl,
    authorization: config.authorization,
  } satisfies ToolExecutorConfig);

  // Fetch card type schemas for typed tool parameters.
  // Uses the server token (not per-realm JWT) because _run-command is a
  // server-level endpoint.
  let cardTypeSchemas = await loadDarkFactorySchemas(
    realmServerUrl,
    targetRealmUrl,
    { authorization: serverToken, fetch: fetchImpl },
  );

  let toolBuilderConfig: ToolBuilderConfig = {
    targetRealmUrl,
    testRealmUrl,
    realmTokens,
    serverToken,
    fetch: fetchImpl,
    cardTypeSchemas,
    matrixAuth: matrixAuth
      ? {
          userId: matrixAuth.userId,
          accessToken: matrixAuth.accessToken,
          matrixUrl: matrixAuth.credentials.matrixUrl,
        }
      : undefined,
  };

  let tools: FactoryTool[] = buildFactoryTools(
    toolBuilderConfig,
    toolExecutor,
    toolRegistry,
  );

  // 5. Build context infrastructure
  let contextBuilder = new ContextBuilder({
    skillResolver: new DefaultSkillResolver(),
    skillLoader: new SkillLoader(),
  });

  // 6. Build agent
  let model = resolveFactoryModel(config.model);
  let agent: LoopAgent =
    config.agent ??
    new ToolUseFactoryAgent({
      model,
      realmServerUrl,
      authorization: config.authorization,
      debug: config.debug,
    } satisfies FactoryAgentConfig);

  // 7. Set up test runner
  let projectCardUrl = `${targetRealmUrl}${project.id}`;
  let testRunner: TestRunner =
    config.testRunner ??
    buildTestRunner(targetRealmUrl, testRealmUrl, ticket, {
      authorization: config.authorization,
      serverToken,
      matrixAuth: matrixAuth
        ? {
            userId: matrixAuth.userId,
            accessToken: matrixAuth.accessToken,
            matrixUrl: matrixAuth.credentials.matrixUrl,
          }
        : undefined,
      fetch: fetchImpl,
      realmServerUrl,
      projectCardUrl,
    });

  // 8. Run the execution loop
  let loopResult = await runFactoryLoop({
    agent,
    contextBuilder,
    tools,
    testRunner,
    project,
    ticket,
    knowledge,
    targetRealmUrl,
    testRealmUrl,
    maxIterations: config.maxIterations,
  });

  // 9. Post-loop: update ticket status on success
  if (loopResult.outcome === 'tests_passed' || loopResult.outcome === 'done') {
    try {
      await updateTicketStatus(targetRealmUrl, ticket.id, 'done', fetchOptions);
      console.error('[factory-implement] Updated ticket status to done');
    } catch (error) {
      console.warn(
        `[factory-implement] Could not update ticket status: ${
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
    ticketId: ticket.id,
    testRealmUrl,
  };
}

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

async function resolveAuth(config: ImplementConfig): Promise<{
  matrixAuth: MatrixAuth | undefined;
  serverToken: string | undefined;
  realmTokens: RealmTokens;
}> {
  // Allow full override for testing
  if (config.realmTokens) {
    return {
      matrixAuth: config.matrixAuth,
      serverToken: config.serverToken,
      realmTokens: config.realmTokens,
    };
  }

  // Production path: build a profile using the CLI-derived realmServerUrl
  // instead of relying on getActiveProfile() which requires REALM_SERVER_URL
  // env var. The realm server URL should always come from --realm-server-url
  // (or inferred from --target-realm-url), never from an env var.
  let matrixAuth: MatrixAuth;
  try {
    if (config.matrixAuth) {
      matrixAuth = config.matrixAuth;
    } else {
      let profile = buildProfileWithCliRealmServer(config.realmServerUrl);
      matrixAuth = await matrixLogin(profile);
    }
  } catch (error) {
    throw new Error(
      `Matrix login failed during implement mode. Ensure MATRIX_URL, MATRIX_USERNAME, and MATRIX_PASSWORD are set, ` +
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

/**
 * Build an ActiveBoxelProfile using the CLI-derived realmServerUrl.
 * Tries the active Boxel profile first (from ~/.boxel-cli/profiles.json),
 * then falls back to MATRIX_URL / MATRIX_USERNAME / MATRIX_PASSWORD env vars.
 * Never reads REALM_SERVER_URL from the environment.
 */
function buildProfileWithCliRealmServer(
  realmServerUrl: string,
): ActiveBoxelProfile {
  // Try active Boxel profile first
  try {
    let profile = getActiveProfile();
    // Override the profile's realmServerUrl with the CLI-derived one
    return { ...profile, realmServerUrl };
  } catch {
    // No active profile — fall back to env vars
  }

  let matrixUrl = process.env.MATRIX_URL?.trim();
  let username = process.env.MATRIX_USERNAME?.trim();
  let password = process.env.MATRIX_PASSWORD?.trim();

  if (!matrixUrl || !username || !password) {
    throw new Error(
      'No active Boxel profile found and MATRIX_URL/MATRIX_USERNAME/MATRIX_PASSWORD are not fully set. ' +
        'The realm server URL is taken from --realm-server-url (not from an env var).',
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
// Card data fetching
// ---------------------------------------------------------------------------

async function fetchCardData(
  targetRealmUrl: string,
  bootstrapResult: FactoryBootstrapResult,
  fetchOptions: RealmFetchOptions,
): Promise<{
  project: ProjectCard;
  ticket: TicketCard;
  knowledge: KnowledgeArticle[];
}> {
  // Fetch the project card
  let project = await fetchCard(
    targetRealmUrl,
    bootstrapResult.project.id,
    fetchOptions,
  );

  // Fetch the active ticket card
  let ticket = await fetchCard(
    targetRealmUrl,
    bootstrapResult.activeTicket.id,
    fetchOptions,
  );

  // Fetch all knowledge articles
  let knowledge: KnowledgeArticle[] = [];
  for (let ka of bootstrapResult.knowledgeArticles) {
    try {
      let card = await fetchCard(targetRealmUrl, ka.id, fetchOptions);
      knowledge.push(card);
    } catch {
      // Non-fatal: knowledge articles are supplementary
      console.warn(
        `[factory-implement] Could not fetch knowledge article: ${ka.id}`,
      );
    }
  }

  return { project, ticket, knowledge };
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
// Test realm URL derivation
// ---------------------------------------------------------------------------

/**
 * Derive the test realm URL from the target realm URL.
 * Convention: append "-test-artifacts" to the endpoint segment.
 * e.g., `http://localhost:4201/user/my-realm/` → `http://localhost:4201/user/my-realm-test-artifacts/`
 */
function deriveTestRealmUrl(targetRealmUrl: string): string {
  let parsed = new URL(targetRealmUrl);
  let segments = parsed.pathname.split('/').filter(Boolean);

  if (segments.length < 1) {
    throw new Error(
      `Cannot derive test realm URL from "${targetRealmUrl}": no path segments`,
    );
  }

  let lastSegment = segments[segments.length - 1];
  segments[segments.length - 1] = `${lastSegment}-test-artifacts`;

  return ensureTrailingSlash(`${parsed.origin}/${segments.join('/')}/`);
}

// ---------------------------------------------------------------------------
// Test runner builder
// ---------------------------------------------------------------------------

interface TestRunnerConfig {
  authorization?: string;
  serverToken?: string;
  matrixAuth?: { userId: string; accessToken: string; matrixUrl: string };
  fetch?: typeof globalThis.fetch;
  realmServerUrl: string;
  projectCardUrl?: string;
}

/**
 * Build a TestRunner that searches the target realm for Playwright spec files
 * in the Tests/ folder and executes them via executeTestRunFromRealm().
 *
 * Creates TestRun cards in the target realm's Test Runs/ folder, manages
 * the test artifacts realm, and returns structured TestResult for the
 * orchestrator's iterate-or-pass decision.
 */
function buildTestRunner(
  targetRealmUrl: string,
  testRealmUrl: string,
  ticket: TicketCard,
  runConfig: TestRunnerConfig,
): TestRunner {
  return async (): Promise<TestResult> => {
    let specPaths = await findSpecPaths(targetRealmUrl, {
      authorization: runConfig.authorization,
      fetch: runConfig.fetch,
    });

    if (specPaths.length === 0) {
      return {
        status: 'failed',
        passedCount: 0,
        failedCount: 1,
        failures: [
          {
            testName: 'test-discovery',
            error:
              'No Playwright test specs found in Tests/ folder. Every ticket must include at least one .spec.ts file.',
          },
        ],
        durationMs: 0,
      };
    }

    let slug = deriveTicketSlug(ticket.id);
    let start = Date.now();

    try {
      console.error(
        `[factory-implement] Running ${specPaths.length} test spec(s): ${specPaths.join(', ')}`,
      );

      let handle = await executeTestRunFromRealm({
        targetRealmUrl,
        testResultsModuleUrl: `${ensureTrailingSlash(targetRealmUrl)}test-results`,
        slug,
        specPaths,
        testNames: [],
        authorization: runConfig.authorization,
        fetch: runConfig.fetch,
        testRealmUrl,
        matrixAuth: runConfig.matrixAuth,
        serverToken: runConfig.serverToken,
        projectCardUrl: runConfig.projectCardUrl,
      });

      let durationMs = Date.now() - start;
      console.error(
        `[factory-implement] Test run complete: status=${handle.status} (${durationMs}ms)`,
      );

      if (handle.status === 'passed') {
        return {
          status: 'passed',
          passedCount: specPaths.length,
          failedCount: 0,
          failures: [],
          durationMs,
        };
      } else if (handle.status === 'failed') {
        return {
          status: 'failed',
          passedCount: 0,
          failedCount: specPaths.length,
          failures: [
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
      console.error(
        `[factory-implement] Test execution error: ${
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

/**
 * Find Playwright spec file paths in the target realm's Tests/ folder.
 * Uses the realm's _mtimes endpoint to list all files, then filters for
 * paths matching Tests/*.spec.ts.
 */
async function findSpecPaths(
  targetRealmUrl: string,
  fetchOptions: RealmFetchOptions,
): Promise<string[]> {
  let fetchImpl = fetchOptions.fetch ?? globalThis.fetch;
  let mtimesUrl = new URL('_mtimes', ensureTrailingSlash(targetRealmUrl)).href;

  try {
    let headers: Record<string, string> = {};
    if (fetchOptions.authorization) {
      headers['Authorization'] = fetchOptions.authorization;
    }

    let response = await fetchImpl(mtimesUrl, { headers });
    if (!response.ok) return [];

    let mtimes = (await response.json()) as Record<string, number>;
    return Object.keys(mtimes).filter(
      (p) => p.startsWith('Tests/') && p.endsWith('.spec.ts'),
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ticket slug derivation
// ---------------------------------------------------------------------------

/**
 * Derive a ticket slug from a ticket ID.
 * e.g., "Tickets/sticky-note-define-core" → "sticky-note-define-core"
 */
function deriveTicketSlug(ticketId: string): string {
  let parts = ticketId.split('/');
  return parts[parts.length - 1];
}

// ---------------------------------------------------------------------------
// Post-loop updates
// ---------------------------------------------------------------------------

/**
 * Update the status field on a ticket card in the target realm.
 * Reads the current card, sets the new status, and writes it back.
 */
async function updateTicketStatus(
  realmUrl: string,
  ticketId: string,
  status: string,
  fetchOptions: RealmFetchOptions,
): Promise<void> {
  let result = await readFile(realmUrl, ticketId, fetchOptions);
  if (!result.ok || !result.document) {
    throw new Error(
      `Cannot read ticket ${ticketId}: ${result.error ?? 'unknown'}`,
    );
  }

  let doc = result.document;
  doc.data.attributes = {
    ...doc.data.attributes,
    status,
  };

  let writeResult = await writeFile(
    realmUrl,
    ticketId,
    JSON.stringify(doc, null, 2),
    fetchOptions,
  );
  if (!writeResult.ok) {
    throw new Error(
      `Failed to write ticket ${ticketId}: ${writeResult.error ?? 'unknown'}`,
    );
  }
}

// ---------------------------------------------------------------------------
// DarkFactory schema loading
// ---------------------------------------------------------------------------

const DARKFACTORY_CARD_TYPES = ['Project', 'Ticket', 'KnowledgeArticle'];

/** Card types from base that the factory also needs schemas for. */
const BASE_CARD_TYPES: { module: string; name: string }[] = [
  { module: 'https://cardstack.com/base/spec', name: 'Spec' },
];

/**
 * Fetch JSON schemas for card types the factory uses. Includes both
 * DarkFactory types (Project, Ticket, KnowledgeArticle) from the target
 * realm and base types (Spec) from the base realm. Returns a Map
 * suitable for passing to ToolBuilderConfig.cardTypeSchemas.
 */
async function loadDarkFactorySchemas(
  realmServerUrl: string,
  targetRealmUrl: string,
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
  let darkfactoryModule = `${ensureTrailingSlash(targetRealmUrl)}darkfactory`;
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
        targetRealmUrl,
        { module: darkfactoryModule, name: cardName },
        options,
      );
      if (schema) {
        schemas.set(cardName, schema);
      }
    } catch (error) {
      console.warn(
        `[factory-implement] Could not fetch schema for ${cardName}: ${
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
        targetRealmUrl,
        { module: mod, name },
        options,
      );
      if (schema) {
        schemas.set(name, schema);
      }
    } catch (error) {
      console.warn(
        `[factory-implement] Could not fetch schema for ${name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return schemas.size > 0 ? schemas : undefined;
}

// Re-export for convenience
export type { FactoryLoopResult } from './factory-loop';
