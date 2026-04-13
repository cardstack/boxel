/**
 * Factory tool builder — builds FactoryTool[] from config.
 *
 * Wraps realm operations, script/realm-api tools, and control signals as
 * executable tool functions that the agent calls directly via the LLM's
 * native tool-use protocol. Each tool's execute function enforces safety
 * (realm protection, per-realm JWT auth, logging).
 */

import { logger } from './logger';
import type {
  LooseSingleCardDocument,
  Relationship,
} from '@cardstack/runtime-common';

import type { ToolResult } from './factory-agent';
import { buildCardDocument } from './darkfactory-schemas';
import type { ToolExecutor } from './factory-tool-executor';
import type { ToolRegistry } from './factory-tool-registry';
import {
  writeFile,
  readFile,
  searchRealm,
  runRealmCommand,
  ensureJsonExtension,
  type RealmFetchOptions,
} from './realm-operations';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

let log = logger('factory-tool-builder');

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
  /** The darkfactory module URL (lives in the software-factory realm, NOT the target realm). */
  darkfactoryModuleUrl: string;
  /** Per-realm JWTs obtained via getRealmScopedAuth(). */
  realmTokens: Record<string, string>;
  /** Realm server JWT for server-level operations (_create-realm, _realm-auth, _server-session). */
  serverToken?: string;
  /** Module URL for the TestRun card definition (e.g., `<realmUrl>test-results`). */
  testResultsModuleUrl?: string;
  /** Fetch implementation (injectable for testing). */
  fetch?: typeof globalThis.fetch;
  /** Realm server URL. Required — never inferred from realm URLs. */
  realmServerUrl: string;
  /** Host app URL for QUnit test runner. Defaults to realmServerUrl (compat proxy). */
  hostAppUrl?: string;
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
    buildRunCommandTool(config),
    buildSignalDoneTool(),
    buildRequestClarificationTool(),
  ];

  // add_comment doesn't need runtime schemas — it reads/patches directly.
  tools.push(buildAddCommentTool(config));

  // Card tools are only available when runtime schemas have been fetched.
  let schemas = config.cardTypeSchemas;
  let cardToolEntries: [string, string, () => FactoryTool][] = [
    ['Project', 'update_project', () => buildUpdateProjectTool(config)],
    ['Issue', 'update_issue', () => buildUpdateIssueTool(config)],
    [
      'KnowledgeArticle',
      'create_knowledge',
      () => buildCreateKnowledgeTool(config),
    ],
    ['Spec', 'create_catalog_spec', () => buildCreateCatalogSpecTool(config)],
  ];
  for (let [cardName, toolName, buildFn] of cardToolEntries) {
    if (schemas?.has(cardName)) {
      tools.push(buildFn());
    } else {
      log.warn(
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
          enum: ['target'],
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
      return writeFile(realmUrl, path, content, fetchOptions);
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
          enum: ['target'],
          description: 'Which realm to read from (default: target)',
        },
      },
      required: ['path'],
    },
    execute: async (args) => {
      let path = args.path as string;
      let realmUrl = resolveRealmUrl(config, args.realm as string | undefined);
      let fetchOptions = buildFetchOptions(config, realmUrl);
      return readFile(realmUrl, path, fetchOptions);
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
          enum: ['target'],
          description: 'Which realm to search (default: target)',
        },
      },
      required: ['query'],
    },
    execute: async (args) => {
      let query = args.query as Record<string, unknown>;
      let realmUrl = resolveRealmUrl(config, args.realm as string | undefined);
      let fetchOptions = buildFetchOptions(config, realmUrl);
      let result = await searchRealm(realmUrl, query, fetchOptions);
      return result.ok ? { data: result.data } : { error: result.error };
    },
  };
}

/**
 * Read-patch-write helper for card update tools.
 *
 * Reads the existing card source, merges the provided attributes and
 * relationships on top, and returns the merged document ready to write.
 * Only falls back to creating a fresh document on confirmed 404 (card
 * doesn't exist yet). Other read failures are surfaced as errors to
 * avoid clobbering existing cards on transient failures.
 */
async function readPatchDocument(
  realmUrl: string,
  path: string,
  cardName: string,
  darkfactoryModuleUrl: string,
  attributes: Record<string, unknown>,
  relationships: Record<string, unknown> | undefined,
  fetchOptions: RealmFetchOptions,
): Promise<LooseSingleCardDocument> {
  let existing = await readFile(realmUrl, path, fetchOptions);

  if (existing.ok && existing.document) {
    let doc = existing.document;
    let existingAttrs = (doc.data.attributes ?? {}) as Record<string, unknown>;
    doc.data.attributes = { ...existingAttrs, ...attributes };
    if (relationships && Object.keys(relationships).length > 0) {
      doc.data.relationships = {
        ...(doc.data.relationships ?? {}),
        ...relationships,
      } as typeof doc.data.relationships;
    }
    return doc;
  }

  // Only create fresh on 404 (card doesn't exist yet).
  // Other failures (auth, network, server error) are surfaced.
  let is404 = existing.error?.startsWith('HTTP 404');
  if (!existing.ok && is404) {
    return buildCardDocument(
      cardName,
      darkfactoryModuleUrl,
      attributes,
      relationships,
    );
  }

  throw new Error(
    `Failed to read existing ${cardName} at "${path}" before update: ${existing.error ?? 'unknown error'}`,
  );
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
      let path = ensureJsonExtension(args.path as string);
      let attributes = args.attributes as Record<string, unknown>;
      let relationships = args.relationships as
        | Record<string, unknown>
        | undefined;
      let realmUrl = config.targetRealmUrl;
      let fetchOptions = buildFetchOptions(config, realmUrl);

      // Read-patch-write: preserve attributes the agent didn't include.
      let doc = await readPatchDocument(
        realmUrl,
        path,
        'Project',
        config.darkfactoryModuleUrl,
        attributes,
        relationships,
        fetchOptions,
      );
      return writeFile(
        realmUrl,
        path,
        JSON.stringify(doc, null, 2),
        fetchOptions,
      );
    },
  };
}

function buildUpdateIssueTool(config: ToolBuilderConfig): FactoryTool {
  let schema = resolveCardSchema(config, 'Issue');
  return {
    name: 'update_issue',
    description:
      'Update an issue card in the target realm. Auth: per-realm JWT.',
    parameters: buildCardToolParams(
      'Realm-relative path to the issue card (e.g., "Issues/1.json")',
      schema,
    ),
    execute: async (args) => {
      let path = ensureJsonExtension(args.path as string);
      // Copy to avoid mutating the caller's args object
      let attributes = { ...(args.attributes as Record<string, unknown>) };
      // The loop owns issue status transitions (backlog → in_progress → done).
      // The agent may set status to "blocked" (cannot proceed) or "backlog"
      // (unblock). The "done" and "in_progress" transitions are managed by
      // the loop based on signal_done + validation results.
      let allowedAgentStatuses = ['blocked', 'backlog'];
      if (
        attributes.status &&
        !allowedAgentStatuses.includes(attributes.status as string)
      ) {
        delete attributes.status;
      }
      let relationships = args.relationships as
        | Record<string, unknown>
        | undefined;
      let realmUrl = config.targetRealmUrl;
      let fetchOptions = buildFetchOptions(config, realmUrl);

      let doc = await readPatchDocument(
        realmUrl,
        path,
        'Issue',
        config.darkfactoryModuleUrl,
        attributes,
        relationships,
        fetchOptions,
      );
      return writeFile(
        realmUrl,
        path,
        JSON.stringify(doc, null, 2),
        fetchOptions,
      );
    },
  };
}

function buildAddCommentTool(config: ToolBuilderConfig): FactoryTool {
  return {
    name: 'add_comment',
    description:
      'Append a comment to an existing issue. Use this to record context, feedback, or status updates without modifying the issue description.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Path to the issue card file (e.g., "Issues/bootstrap-seed.json")',
        },
        body: {
          type: 'string',
          description: 'The comment text (markdown supported)',
        },
        author: {
          type: 'string',
          description:
            'Who is writing this comment (e.g., "factory-agent", "human")',
        },
      },
      required: ['path', 'body', 'author'],
    },
    execute: async (args) => {
      let path = ensureJsonExtension(args.path as string);
      let body = args.body as string;
      let author = args.author as string;

      let realmUrl = config.targetRealmUrl;
      let fetchOptions = buildFetchOptions(config, realmUrl);

      // Read existing issue
      let existing = await readFile(realmUrl, path, fetchOptions);
      if (!existing.ok || !existing.document) {
        return {
          ok: false,
          error: `Failed to read issue at ${path}: ${existing.error ?? 'no document'}`,
        };
      }

      // Get existing comments or initialize empty array
      let existingComments =
        (existing.document.data?.attributes?.comments as unknown[]) ?? [];

      // Append new comment
      let newComment = {
        body,
        author,
        datetime: new Date().toISOString(),
      };
      existingComments.push(newComment);

      // Merge back
      let updatedAttributes = {
        ...existing.document.data?.attributes,
        comments: existingComments,
      };

      let document = buildCardDocument(
        'Issue',
        config.darkfactoryModuleUrl,
        updatedAttributes,
        existing.document.data?.relationships as
          | Record<string, unknown>
          | undefined,
      );

      return writeFile(
        realmUrl,
        path,
        JSON.stringify(document, null, 2),
        fetchOptions,
      );
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
      let path = ensureJsonExtension(args.path as string);
      let attributes = args.attributes as Record<string, unknown>;
      let relationships = args.relationships as
        | Record<string, unknown>
        | undefined;
      let realmUrl = config.targetRealmUrl;
      let fetchOptions = buildFetchOptions(config, realmUrl);

      let doc = await readPatchDocument(
        realmUrl,
        path,
        'KnowledgeArticle',
        config.darkfactoryModuleUrl,
        attributes,
        relationships,
        fetchOptions,
      );
      return writeFile(
        realmUrl,
        path,
        JSON.stringify(doc, null, 2),
        fetchOptions,
      );
    },
  };
}

function buildCreateCatalogSpecTool(config: ToolBuilderConfig): FactoryTool {
  let schema = resolveCardSchema(config, 'Spec');
  return {
    name: 'create_catalog_spec',
    description:
      "Create a Catalog Spec card in the target realm's Spec/ folder. " +
      'This makes a card definition discoverable in the Boxel catalog. ' +
      'Auth: per-realm JWT.',
    parameters: buildCardToolParams(
      'Realm-relative path for the Spec card (e.g., "Spec/sticky-note.json")',
      schema,
    ),
    execute: async (args) => {
      let path = ensureJsonExtension(args.path as string);
      let attributes = args.attributes as Record<string, unknown>;
      let relationships = args.relationships as
        | Record<string, unknown>
        | undefined;
      let realmUrl = config.targetRealmUrl;
      let fetchOptions = buildFetchOptions(config, realmUrl);
      // Spec cards adopt from https://cardstack.com/base/spec, not darkfactory
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes,
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/spec',
              name: 'Spec',
            },
          },
        },
      };
      if (relationships && Object.keys(relationships).length > 0) {
        doc.data.relationships = relationships as {
          [fieldName: string]: Relationship | Relationship[];
        };
      }
      return writeFile(
        realmUrl,
        path,
        JSON.stringify(doc, null, 2),
        fetchOptions,
      );
    },
  };
}

// Note: buildRunTestsTool was removed — the validation pipeline runs tests
// automatically via executeTestRunFromRealm after each agent turn.

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
      'Execute a Boxel host command on the realm server via the prerenderer. ' +
      'This runs Boxel host commands ONLY — not shell commands, scripts, or Node.js. ' +
      'Commands must be Boxel host command specifiers in the format ' +
      '"@cardstack/boxel-host/commands/<name>/default". ' +
      'Auth: realm server token.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'Boxel host command specifier — must be in the format "@cardstack/boxel-host/commands/<name>/default"',
        },
        commandInput: {
          type: 'object',
          description: 'Optional input for the command',
        },
      },
      required: ['command'],
    },
    execute: async (args) => {
      if (!config.serverToken) {
        return {
          status: 'error',
          error: 'run_command requires serverToken in config',
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
  _realm: string | undefined,
): string {
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
