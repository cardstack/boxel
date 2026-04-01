/**
 * Factory tool builder — builds FactoryTool[] from config.
 *
 * Wraps realm operations, script/realm-api tools, and control signals as
 * executable tool functions that the agent calls directly via the LLM's
 * native tool-use protocol. Each tool's execute function enforces safety
 * (realm protection, per-realm JWT auth, logging).
 */

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import type { ToolResult } from './factory-agent';
import type { ToolExecutor } from './factory-tool-executor';
import type { ToolRegistry } from './factory-tool-registry';
import {
  writeModuleSource,
  writeCardSource,
  readCardSource,
  searchRealm,
  type RealmFetchOptions,
} from './realm-operations';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODULE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.gts',
  '.ts',
  '.js',
  '.gjs',
]);

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
  /** Fetch implementation (injectable for testing). */
  fetch?: typeof globalThis.fetch;
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
    buildUpdateTicketTool(config),
    buildCreateKnowledgeTool(config),
    buildSignalDoneTool(),
    buildRequestClarificationTool(),
  ];

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
      'Write a file to a realm. Routes .gts/.ts files as raw module source, .json files as card source.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Realm-relative file path (e.g., "my-card.gts" or "Card/1.json")',
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

      if (isModuleFile(path)) {
        return writeModuleSource(realmUrl, path, content, fetchOptions);
      } else {
        let document: LooseSingleCardDocument;
        try {
          document = JSON.parse(content) as LooseSingleCardDocument;
        } catch {
          return {
            ok: false,
            error: `Failed to parse content as JSON for card write: ${path}`,
          };
        }
        return writeCardSource(realmUrl, path, document, fetchOptions);
      }
    },
  };
}

function buildReadFileTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'read_file',
    description: 'Read a file from a realm as card source JSON.',
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
    description: 'Search for cards in a realm using a structured query.',
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

function buildUpdateTicketTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'update_ticket',
    description: 'Update a ticket card in the target realm.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Realm-relative path to the ticket card (e.g., "Ticket/1.json")',
        },
        content: {
          type: 'string',
          description: 'Card source JSON content',
        },
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      let path = args.path as string;
      let content = args.content as string;
      let realmUrl = config.targetRealmUrl;
      let fetchOptions = buildFetchOptions(config, realmUrl);

      let document: LooseSingleCardDocument;
      try {
        document = JSON.parse(content) as LooseSingleCardDocument;
      } catch {
        return {
          ok: false,
          error: `Failed to parse update_ticket content as JSON: ${path}`,
        };
      }
      return writeCardSource(realmUrl, path, document, fetchOptions);
    },
  };
}

function buildCreateKnowledgeTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'create_knowledge',
    description:
      'Create or update a knowledge article card in the target realm.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Realm-relative path for the knowledge card (e.g., "Knowledge/deploy.json")',
        },
        content: {
          type: 'string',
          description: 'Card source JSON content',
        },
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      let path = args.path as string;
      let content = args.content as string;
      let realmUrl = config.targetRealmUrl;
      let fetchOptions = buildFetchOptions(config, realmUrl);

      let document: LooseSingleCardDocument;
      try {
        document = JSON.parse(content) as LooseSingleCardDocument;
      } catch {
        return {
          ok: false,
          error: `Failed to parse create_knowledge content as JSON: ${path}`,
        };
      }
      return writeCardSource(realmUrl, path, document, fetchOptions);
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
    authorization: config.realmTokens[realmUrl],
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

function isModuleFile(path: string): boolean {
  let dotIndex = path.lastIndexOf('.');
  if (dotIndex === -1) {
    return false;
  }
  let ext = path.slice(dotIndex);
  return MODULE_EXTENSIONS.has(ext);
}
