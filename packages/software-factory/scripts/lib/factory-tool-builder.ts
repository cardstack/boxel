/**
 * Factory tool builder — builds FactoryTool[] from config.
 *
 * Wraps realm operations, script/realm-api tools, and control signals as
 * executable tool functions that the agent calls directly via the LLM's
 * native tool-use protocol. Each tool's execute function enforces safety
 * (realm protection, per-realm JWT auth, logging).
 */

import type { ToolResult } from './factory-agent';
import { buildCardDocument } from './darkfactory-schemas';
import type { ToolExecutor } from './factory-tool-executor';
import type { ToolRegistry } from './factory-tool-registry';
import { executeTestRunFromRealm } from './test-run-execution';
import type { ExecuteTestRunOptions, TestRunHandle } from './test-run-types';
import {
  writeModuleSource,
  writeCardSource,
  readCardSource,
  searchRealm,
  runRealmCommand,
  ensureTrailingSlash,
  type RealmFetchOptions,
} from './realm-operations';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FactoryTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolBuilderConfig {
  targetRealmUrl: string;
  testRealmUrl: string;
  /** Per-realm JWTs obtained via getRealmScopedAuth(). */
  realmTokens: Record<string, string>;
  /** Realm server JWT for server-level operations (_create-realm, _realm-auth, _server-session). */
  serverToken?: string;
  /** Module URL for the TestRun card definition (e.g., `<realmUrl>test-results`). */
  testResultsModuleUrl?: string;
  /** Fetch implementation (injectable for testing). */
  fetch?: typeof globalThis.fetch;
  /** Matrix auth for test realm creation (required for run_tests when project card is provided). */
  matrixAuth?: {
    userId: string;
    accessToken: string;
    matrixUrl: string;
  };
  /** Override for executeTestRunFromRealm (injectable for testing). */
  executeTestRun?: (options: ExecuteTestRunOptions) => Promise<TestRunHandle>;
  /** Realm server URL for /_run-command calls (e.g., "http://localhost:4201/"). */
  realmServerUrl?: string;
  /** Pre-fetched runtime schemas keyed by card name (e.g., "Project"). */
  cardTypeSchemas?: Map<
    string,
    {
      attributes: Record<string, unknown>;
      relationships?: Record<string, unknown>;
    }
  >;
}

export interface ToolCallEntry {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Signals — returned by signal tools to indicate control flow
// ---------------------------------------------------------------------------

export const DONE_SIGNAL = Symbol.for('factory:done');
export const CLARIFICATION_SIGNAL = Symbol.for('factory:clarification');

export interface DoneResult {
  signal: typeof DONE_SIGNAL;
}

export interface ClarificationResult {
  signal: typeof CLARIFICATION_SIGNAL;
  message: string;
}

// ---------------------------------------------------------------------------
// ToolBuilder
// ---------------------------------------------------------------------------

/**
 * Build the set of FactoryTool[] that the agent can call during its turn.
 * Each tool wraps a realm operation or script execution with auth + safety.
 */
export function buildFactoryTools(
  config: ToolBuilderConfig,
  toolExecutor: ToolExecutor,
  toolRegistry: ToolRegistry,
): FactoryTool[] {
  let tools: FactoryTool[] = [
    buildWriteFileTool(config),
    buildReadFileTool(config),
    buildSearchRealmTool(config),
    buildRunTestsTool(config),
    buildRunCommandTool(config),
    buildSignalDoneTool(),
    buildRequestClarificationTool(),
  ];

  // Card tools are only available when runtime schemas have been fetched.
  let schemas = config.cardTypeSchemas;
  let cardToolEntries: [string, string, () => FactoryTool][] = [
    ['Project', 'update_project', () => buildUpdateProjectTool(config)],
    ['Ticket', 'update_ticket', () => buildUpdateTicketTool(config)],
    [
      'KnowledgeArticle',
      'create_knowledge',
      () => buildCreateKnowledgeTool(config),
    ],
  ];
  for (let [cardName, toolName, buildFn] of cardToolEntries) {
    if (schemas?.has(cardName)) {
      tools.push(buildFn());
    } else {
      console.warn(
        `[factory-tool-builder] Omitting ${toolName} tool: no schema for ${cardName}`,
      );
    }
  }

  // Add registered script/realm-api tools as FactoryTool wrappers.
  // Realm-api tools get the config so they can resolve per-realm JWTs.
  for (let manifest of toolRegistry.getManifests()) {
    if (manifest.category === 'script' || manifest.category === 'realm-api') {
      tools.push(buildRegisteredTool(manifest, toolExecutor, config));
    }
  }

  return tools;
}

// ---------------------------------------------------------------------------
// Factory-level tools
// ---------------------------------------------------------------------------

function buildWriteFileTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'write_file',
    description:
      'Write a file to a realm. The path must include the file extension. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Realm-relative file path with extension (e.g., "my-card.gts", "Card/1.json")',
        },
        content: { type: 'string', description: 'File content' },
        realm: {
          type: 'string',
          enum: ['target', 'test'],
          description: 'Which realm to write to (default: target)',
        },
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      let path = args.path as string;
      let content = args.content as string;
      let realmUrl = resolveRealmUrl(config, args.realm as string | undefined);
      let fetchOptions = buildFetchOptions(config, realmUrl);
      return writeModuleSource(realmUrl, path, content, fetchOptions);
    },
  };
}

function buildReadFileTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'read_file',
    description:
      'Read a file from a realm as card source JSON. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Realm-relative file path',
        },
        realm: {
          type: 'string',
          enum: ['target', 'test'],
          description: 'Which realm to read from (default: target)',
        },
      },
      required: ['path'],
    },
    execute: async (args) => {
      let path = args.path as string;
      let realmUrl = resolveRealmUrl(config, args.realm as string | undefined);
      let fetchOptions = buildFetchOptions(config, realmUrl);
      return readCardSource(realmUrl, path, fetchOptions);
    },
  };
}

function buildSearchRealmTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'search_realm',
    description:
      'Search for cards in a realm using a structured query. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'object',
          description: 'Search query object (filter, sort, page)',
        },
        realm: {
          type: 'string',
          enum: ['target', 'test'],
          description: 'Which realm to search (default: target)',
        },
      },
      required: ['query'],
    },
    execute: async (args) => {
      let query = args.query as Record<string, unknown>;
      let realmUrl = resolveRealmUrl(config, args.realm as string | undefined);
      let fetchOptions = buildFetchOptions(config, realmUrl);
      return searchRealm(realmUrl, query, fetchOptions);
    },
  };
}

/**
 * Resolve the schema for a card type from the runtime cache.
 * Only called when the card type is known to exist in cardTypeSchemas
 * (callers check before building the tool).
 */
function resolveCardSchema(config: ToolBuilderConfig, cardName: string) {
  let cached = config.cardTypeSchemas!.get(cardName)!;
  return {
    attributes: cached.attributes,
    relationships: cached.relationships,
  };
}

function buildCardToolParams(
  pathDescription: string,
  schema: {
    attributes: Record<string, unknown>;
    relationships?: Record<string, unknown>;
  },
) {
  let properties: Record<string, unknown> = {
    path: { type: 'string', description: pathDescription },
    attributes: schema.attributes,
  };
  if (schema.relationships) {
    properties.relationships = schema.relationships;
  }
  return { type: 'object', properties, required: ['path', 'attributes'] };
}

function buildUpdateProjectTool(config: ToolBuilderConfig): FactoryTool {
  let schema = resolveCardSchema(config, 'Project');
  return {
    name: 'update_project',
    description:
      'Update a project card in the target realm (e.g., update status or success criteria). Auth: per-realm JWT.',
    parameters: buildCardToolParams(
      'Realm-relative path to the project card (e.g., "Projects/sticky-note-mvp.json")',
      schema,
    ),
    execute: async (args) => {
      let path = args.path as string;
      let attributes = args.attributes as Record<string, unknown>;
      let relationships = args.relationships as
        | Record<string, unknown>
        | undefined;
      let realmUrl = config.targetRealmUrl;
      let fetchOptions = buildFetchOptions(config, realmUrl);
      let document = buildCardDocument(
        'Project',
        realmUrl,
        attributes,
        relationships,
      );
      return writeCardSource(realmUrl, path, document, fetchOptions);
    },
  };
}

function buildUpdateTicketTool(config: ToolBuilderConfig): FactoryTool {
  let schema = resolveCardSchema(config, 'Ticket');
  return {
    name: 'update_ticket',
    description:
      'Update a ticket card in the target realm. Auth: per-realm JWT.',
    parameters: buildCardToolParams(
      'Realm-relative path to the ticket card (e.g., "Ticket/1.json")',
      schema,
    ),
    execute: async (args) => {
      let path = args.path as string;
      let attributes = args.attributes as Record<string, unknown>;
      let relationships = args.relationships as
        | Record<string, unknown>
        | undefined;
      let realmUrl = config.targetRealmUrl;
      let fetchOptions = buildFetchOptions(config, realmUrl);
      let document = buildCardDocument(
        'Ticket',
        realmUrl,
        attributes,
        relationships,
      );
      return writeCardSource(realmUrl, path, document, fetchOptions);
    },
  };
}

function buildCreateKnowledgeTool(config: ToolBuilderConfig): FactoryTool {
  let schema = resolveCardSchema(config, 'KnowledgeArticle');
  return {
    name: 'create_knowledge',
    description:
      'Create or update a knowledge article card in the target realm. Auth: per-realm JWT.',
    parameters: buildCardToolParams(
      'Realm-relative path for the knowledge card (e.g., "Knowledge/deploy.json")',
      schema,
    ),
    execute: async (args) => {
      let path = args.path as string;
      let attributes = args.attributes as Record<string, unknown>;
      let relationships = args.relationships as
        | Record<string, unknown>
        | undefined;
      let realmUrl = config.targetRealmUrl;
      let fetchOptions = buildFetchOptions(config, realmUrl);
      let document = buildCardDocument(
        'KnowledgeArticle',
        realmUrl,
        attributes,
        relationships,
      );
      return writeCardSource(realmUrl, path, document, fetchOptions);
    },
  };
}

function buildRunTestsTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'run_tests',
    description:
      'Execute Playwright tests against the target realm. Pulls test spec files from the realm, ' +
      'runs them via the Playwright harness, and returns structured test results (pass/fail counts, ' +
      'failure details with error messages and stack traces). Auth: per-realm JWT for target realm, ' +
      'realm server token for test artifacts realm creation.',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description:
            'Ticket slug used to name the test run (e.g., "define-sticky-note-core")',
        },
        specPaths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Realm-relative paths to Playwright test files (e.g., ["Tests/sticky-note.spec.ts"])',
        },
        testNames: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Specific test names to run (empty array runs all tests in the spec files)',
        },
        projectCardUrl: {
          type: 'string',
          description:
            'URL to the Project card (used to read/write testArtifactsRealmUrl)',
        },
      },
      required: ['slug', 'specPaths'],
    },
    execute: async (args) => {
      let targetRealmUrl = config.targetRealmUrl;
      let authorization = resolveAuthForUrl(config, targetRealmUrl);
      let testResultsModuleUrl =
        config.testResultsModuleUrl ??
        `${ensureTrailingSlash(targetRealmUrl)}test-results`;

      let executeFn = config.executeTestRun ?? executeTestRunFromRealm;
      let result = await executeFn({
        targetRealmUrl,
        testResultsModuleUrl,
        slug: args.slug as string,
        specPaths: args.specPaths as string[],
        testNames: (args.testNames as string[]) ?? [],
        authorization,
        fetch: config.fetch,
        projectCardUrl: args.projectCardUrl as string | undefined,
        testRealmUrl: config.testRealmUrl,
        matrixAuth: config.matrixAuth,
        serverToken: config.serverToken,
      });

      return result;
    },
  };
}

function buildSignalDoneTool(): FactoryTool {
  return {
    name: 'signal_done',
    description:
      'Signal that the current ticket is complete. Call this when all implementation and test files have been written.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      return { signal: DONE_SIGNAL } as DoneResult;
    },
  };
}

function buildRequestClarificationTool(): FactoryTool {
  return {
    name: 'request_clarification',
    description:
      'Signal that you cannot proceed and need human input. Provide a description of what is blocking.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Description of what clarification is needed',
        },
      },
      required: ['message'],
    },
    execute: async (args) => {
      return {
        signal: CLARIFICATION_SIGNAL,
        message: args.message as string,
      } as ClarificationResult;
    },
  };
}

function buildRunCommandTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'run_command',
    description:
      'Execute a host command on the realm server via the prerenderer. ' +
      'Commands run in browser context with full card runtime access. ' +
      'Use "@cardstack/boxel-host/commands/<name>/default" as the command specifier. ' +
      'Auth: realm server token.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'Command specifier (e.g., "@cardstack/boxel-host/commands/get-card-type-schema/default")',
        },
        commandInput: {
          type: 'object',
          description: 'Optional input for the command',
        },
      },
      required: ['command'],
    },
    execute: async (args) => {
      if (!config.realmServerUrl || !config.serverToken) {
        return {
          status: 'error',
          error:
            'run_command requires realmServerUrl and serverToken in config',
        };
      }
      return runRealmCommand(
        config.realmServerUrl,
        config.targetRealmUrl,
        args.command as string,
        args.commandInput as Record<string, unknown> | undefined,
        {
          authorization: config.serverToken,
          fetch: config.fetch,
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Registered tool wrappers (script + realm-api)
// ---------------------------------------------------------------------------

function buildRegisteredTool(
  manifest: {
    name: string;
    description: string;
    category: string;
    args: {
      name: string;
      type: string;
      required: boolean;
      description: string;
    }[];
  },
  toolExecutor: ToolExecutor,
  config: ToolBuilderConfig,
): FactoryTool {
  let properties: Record<string, unknown> = {};
  let required: string[] = [];

  for (let arg of manifest.args) {
    properties[arg.name] = {
      type: arg.type,
      description: arg.description,
    };
    if (arg.required) {
      required.push(arg.name);
    }
  }

  return {
    name: manifest.name,
    description: manifest.description,
    parameters: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
    execute: async (args) => {
      // For realm-api tools, resolve the correct JWT:
      // - Tools with realm-server-url (realm-create, realm-server-session,
      //   realm-auth) use the server JWT
      // - Tools with realm-url use the per-realm JWT
      let authorization: string | undefined;
      if (manifest.category === 'realm-api') {
        let serverUrl = args['realm-server-url'] as string | undefined;
        let realmUrl = args['realm-url'] as string | undefined;
        if (serverUrl) {
          authorization = config.serverToken;
        } else if (realmUrl) {
          authorization = resolveAuthForUrl(config, realmUrl);
        }
      }

      let result: ToolResult = await toolExecutor.execute(
        manifest.name,
        args,
        authorization ? { authorization } : undefined,
      );
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveRealmUrl(
  config: ToolBuilderConfig,
  realm: string | undefined,
): string {
  if (realm === 'test') {
    return config.testRealmUrl;
  }
  return config.targetRealmUrl;
}

function buildFetchOptions(
  config: ToolBuilderConfig,
  realmUrl: string,
): RealmFetchOptions {
  return {
    authorization: resolveAuthForUrl(config, realmUrl),
    fetch: config.fetch,
  };
}

/**
 * Resolve the correct JWT for a realm URL. Tries an exact match in
 * realmTokens first, then tries with trailing slash normalization.
 */
function resolveAuthForUrl(
  config: ToolBuilderConfig,
  url: string,
): string | undefined {
  // Exact match
  if (config.realmTokens[url]) {
    return config.realmTokens[url];
  }
  // Try with/without trailing slash
  let normalized = url.endsWith('/') ? url : `${url}/`;
  if (config.realmTokens[normalized]) {
    return config.realmTokens[normalized];
  }
  let withoutSlash = url.endsWith('/') ? url.slice(0, -1) : url;
  if (config.realmTokens[withoutSlash]) {
    return config.realmTokens[withoutSlash];
  }
  return undefined;
}
