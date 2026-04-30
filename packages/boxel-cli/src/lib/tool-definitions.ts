/**
 * Tool definitions that boxel-cli publishes for factory (and future MCP)
 * consumption. Each tool wraps a BoxelCLIClient method with name,
 * description, JSON Schema parameters, and an execute function.
 *
 * The factory imports `getToolDefinitions()` and spreads the result into
 * its FactoryTool[] array — no manual redefinition needed.
 *
 * Target-realm files live in the agent's local workspace directory; the
 * agent edits them with its native filesystem tools (no dedicated
 * read_file / write_file tool here, since wrapping fs in a tool is strictly
 * less capable than what the agent can do natively).
 *
 * The realm-server-side tools published here take an explicit `realm-url`
 * argument and hit the realm over HTTP. The factory's
 * `TARGET_REALM_BYPASS_TOOLS` guard rejects `realm_read_file` /
 * `realm_write_file` / `realm_delete_file` when `realm-url` matches the
 * target realm — those are reserved for non-target realms (scratch,
 * source, catalog, base, etc.) where the agent has no local workspace.
 */

import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import type { BoxelCLIClient } from './boxel-cli-client';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BoxelToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface BoxelToolConfig {
  targetRealmUrl: string;
  realmServerUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Enforce that a required string argument is present and non-empty. Returns
 * the trimmed value or throws a clear error that propagates back to the
 * model as a tool-call result.
 */
export function requireStringArg(
  args: Record<string, unknown>,
  name: string,
  toolName: string,
): string {
  let raw = args[name];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(
      `Tool "${toolName}" requires a non-empty string "${name}" argument; received ${JSON.stringify(raw)}. ` +
        `Re-send the tool call with every required argument filled in.`,
    );
  }
  return raw.trim();
}

function resolveRealmUrl(
  config: BoxelToolConfig,
  _realm: string | undefined,
): string {
  return config.targetRealmUrl;
}

// ---------------------------------------------------------------------------
// Realm API tools (parameterized — work on any realm; non-target only for
// read / write / delete via the factory's TARGET_REALM_BYPASS_TOOLS guard)
// ---------------------------------------------------------------------------

const NON_TARGET_GUIDANCE =
  'For target-realm I/O, edit files in the local workspace using your native filesystem tools — this tool is reserved for non-target realms (scratch, source, catalog, base, etc.).';

function buildRealmReadTool(client: BoxelCLIClient): BoxelToolDefinition {
  return {
    name: 'realm_read_file',
    description: `Read a file from a non-target realm as card source. ${NON_TARGET_GUIDANCE} Auth: per-realm JWT.`,
    parameters: {
      type: 'object',
      properties: {
        'realm-url': {
          type: 'string',
          description: 'Absolute URL of the realm to read from.',
        },
        path: {
          type: 'string',
          description: 'Realm-relative file path.',
        },
      },
      required: ['realm-url', 'path'],
    },
    execute: async (args) => {
      let realmUrl = requireStringArg(args, 'realm-url', 'realm_read_file');
      let path = requireStringArg(args, 'path', 'realm_read_file');
      let result = await client.read(realmUrl, path);
      if (!result.ok) {
        return { error: result.error, status: result.status };
      }
      try {
        return JSON.parse(result.content ?? '');
      } catch {
        return { content: result.content };
      }
    },
  };
}

function buildRealmWriteTool(client: BoxelCLIClient): BoxelToolDefinition {
  return {
    name: 'realm_write_file',
    description: `Write a file to a non-target realm. The path must include the file extension. ${NON_TARGET_GUIDANCE} Auth: per-realm JWT.`,
    parameters: {
      type: 'object',
      properties: {
        'realm-url': {
          type: 'string',
          description: 'Absolute URL of the realm to write to.',
        },
        path: {
          type: 'string',
          description:
            'Realm-relative file path with extension (e.g., "my-card.gts", "Card/1.json").',
        },
        content: { type: 'string', description: 'File content.' },
      },
      required: ['realm-url', 'path', 'content'],
    },
    execute: async (args) => {
      let realmUrl = requireStringArg(args, 'realm-url', 'realm_write_file');
      let path = requireStringArg(args, 'path', 'realm_write_file');
      let content = requireStringArg(args, 'content', 'realm_write_file');
      return client.write(realmUrl, path, content);
    },
  };
}

function buildRealmDeleteTool(client: BoxelCLIClient): BoxelToolDefinition {
  return {
    name: 'realm_delete_file',
    description: `Delete a file from a non-target realm. ${NON_TARGET_GUIDANCE} Auth: per-realm JWT.`,
    parameters: {
      type: 'object',
      properties: {
        'realm-url': {
          type: 'string',
          description: 'Absolute URL of the realm to delete from.',
        },
        path: {
          type: 'string',
          description: 'Realm-relative file path to delete.',
        },
      },
      required: ['realm-url', 'path'],
    },
    execute: async (args) => {
      let realmUrl = requireStringArg(args, 'realm-url', 'realm_delete_file');
      let path = requireStringArg(args, 'path', 'realm_delete_file');
      return client.delete(realmUrl, path);
    },
  };
}

function buildRealmSearchTool(client: BoxelCLIClient): BoxelToolDefinition {
  return {
    name: 'realm_search',
    description:
      'Search for cards in a realm using a structured query. Works for both target and non-target realms — realm-index queries have no workspace-fs equivalent. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        'realm-url': {
          type: 'string',
          description: 'Absolute URL of the realm to search.',
        },
        query: {
          type: ['object', 'string'],
          description:
            'Search query (filter, sort, page) — JSON object or JSON-encoded string.',
        },
      },
      required: ['realm-url', 'query'],
    },
    execute: async (args) => {
      let realmUrl = requireStringArg(args, 'realm-url', 'realm_search');
      let raw = args.query;
      let query: Record<string, unknown>;
      if (typeof raw === 'string') {
        try {
          query = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return {
            error:
              "Invalid JSON for 'query' in realm_search: expected valid JSON.",
          };
        }
      } else if (raw && typeof raw === 'object') {
        query = raw as Record<string, unknown>;
      } else {
        return {
          error:
            "Invalid 'query' argument for realm_search: expected a JSON object or JSON-encoded string.",
        };
      }
      let result = await client.search(realmUrl, query);
      return result.ok
        ? { data: result.data }
        : { error: result.error, status: result.status };
    },
  };
}

// ---------------------------------------------------------------------------
// Other client wrappers (kept target-bound — they have no non-target use case
// in the factory loop, or are server-level)
// ---------------------------------------------------------------------------

function buildFetchTranspiledModuleTool(
  client: BoxelCLIClient,
  config: BoxelToolConfig,
): BoxelToolDefinition {
  return {
    name: 'read_transpiled',
    description:
      "Debugging tool ONLY for investigating runtime errors in .gts modules you've written. Use when an eval or instantiate validation error reports a line/column number — those line numbers refer to the transpiled output, not your .gts source, so fetching the transpiled output is how you locate the offending source construct. Never use the transpiled output as a reference for how to write code. Do NOT copy its patterns (setComponentTemplate, precompileTemplate, wire-format templates, base64 CSS imports) into source — always write idiomatic Ember / <template>-tag / CardDef source. Editing: only edit the .gts source (the transpiled output is regenerated on the next write). Auth: per-realm JWT.",
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Realm-relative module path. The .gts extension is optional — the realm accepts either form.',
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
      let path = requireStringArg(args, 'path', 'read_transpiled');
      let realmUrl = resolveRealmUrl(config, args.realm as string | undefined);
      return client.readTranspiled(realmUrl, path);
    },
  };
}

function buildRunCommandTool(
  client: BoxelCLIClient,
  config: BoxelToolConfig,
): BoxelToolDefinition {
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
      return client.runCommand(
        config.realmServerUrl,
        config.targetRealmUrl,
        args.command as string,
        args.commandInput as Record<string, unknown> | undefined,
      );
    },
  };
}

function buildListFilesTool(
  client: BoxelCLIClient,
  config: BoxelToolConfig,
): BoxelToolDefinition {
  return {
    name: 'realm_list_files',
    description:
      'List all file paths in a realm. Returns relative paths. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        realm: {
          type: 'string',
          enum: ['target'],
          description: 'Which realm to list files from (default: target)',
        },
      },
    },
    execute: async (args) => {
      let realmUrl = resolveRealmUrl(config, args.realm as string | undefined);
      return client.listFiles(realmUrl);
    },
  };
}

function buildLintFileTool(
  client: BoxelCLIClient,
  config: BoxelToolConfig,
): BoxelToolDefinition {
  return {
    name: 'realm_lint_file',
    description:
      "Lint a single file's source code via the realm's lint endpoint. " +
      'Returns fixed output and lint messages (errors/warnings). Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'The source code to lint',
        },
        filename: {
          type: 'string',
          description: 'The filename (used to determine lint rules)',
        },
        realm: {
          type: 'string',
          enum: ['target'],
          description: 'Which realm to use for linting (default: target)',
        },
      },
      required: ['source', 'filename'],
    },
    execute: async (args) => {
      let source = requireStringArg(args, 'source', 'realm_lint_file');
      let filename = requireStringArg(args, 'filename', 'realm_lint_file');
      let realmUrl = resolveRealmUrl(config, args.realm as string | undefined);
      return client.lint(realmUrl, source, filename);
    },
  };
}

function buildWaitForReadyTool(
  client: BoxelCLIClient,
  config: BoxelToolConfig,
): BoxelToolDefinition {
  return {
    name: 'realm_wait_for_ready',
    description:
      'Poll a realm until it passes its readiness check. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        realm: {
          type: 'string',
          enum: ['target'],
          description: 'Which realm to check (default: target)',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
    },
    execute: async (args) => {
      let realmUrl = resolveRealmUrl(config, args.realm as string | undefined);
      let timeoutMs =
        typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined;
      return client.waitForReady(realmUrl, timeoutMs);
    },
  };
}

function buildCancelIndexingTool(
  client: BoxelCLIClient,
  config: BoxelToolConfig,
): BoxelToolDefinition {
  return {
    name: 'realm_cancel_indexing',
    description:
      'Cancel all running and pending indexing jobs for a realm. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        realm: {
          type: 'string',
          enum: ['target'],
          description: 'Which realm to cancel indexing for (default: target)',
        },
      },
    },
    execute: async (args) => {
      let realmUrl = resolveRealmUrl(config, args.realm as string | undefined);
      return client.cancelAllIndexingJobs(realmUrl);
    },
  };
}

function buildRealmCreateTool(client: BoxelCLIClient): BoxelToolDefinition {
  return {
    name: 'create_realm',
    description:
      "Create a new realm on the active profile's realm server. The supplied `realm-server-url` is validated against the active profile to prevent accidental cross-server creates. Auth: realm server token.",
    parameters: {
      type: 'object',
      properties: {
        'realm-server-url': {
          type: 'string',
          description:
            'Realm server base URL. Must match the active Boxel profile.',
        },
        name: {
          type: 'string',
          description: 'Display name for the new realm.',
        },
        endpoint: {
          type: 'string',
          description:
            'URL path segment for the new realm (e.g. "user/my-realm").',
        },
        iconURL: {
          type: 'string',
          description:
            'Optional icon URL. Defaults to a letter-based icon derived from the realm name.',
        },
        backgroundURL: {
          type: 'string',
          description:
            'Optional background image URL. Defaults to a random background image.',
        },
      },
      required: ['realm-server-url', 'name', 'endpoint'],
    },
    execute: async (args) => {
      let requestedServerUrl = ensureTrailingSlash(
        requireStringArg(args, 'realm-server-url', 'create_realm'),
      );
      let displayName = requireStringArg(args, 'name', 'create_realm');
      let realmName = requireStringArg(args, 'endpoint', 'create_realm');
      let active = client.getActiveProfile();
      if (
        active &&
        ensureTrailingSlash(active.realmServerUrl) !== requestedServerUrl
      ) {
        return {
          error: `create_realm cannot target "${requestedServerUrl}": active Boxel profile realm server is "${ensureTrailingSlash(active.realmServerUrl)}".`,
        };
      }
      let result = await client.createRealm({
        realmName,
        displayName,
        iconURL: args.iconURL as string | undefined,
        backgroundURL: args.backgroundURL as string | undefined,
      });
      return { data: { id: result.realmUrl } };
    },
  };
}

// ---------------------------------------------------------------------------
// Workspace ⇄ realm sync tools (parameterized — operate on any realm)
// ---------------------------------------------------------------------------

function buildRealmSyncTool(client: BoxelCLIClient): BoxelToolDefinition {
  return {
    name: 'realm_sync',
    description:
      'Bidirectional sync between a local workspace directory and a realm. Pushes local changes, pulls remote changes, resolves conflicts via the chosen strategy. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        'realm-url': {
          type: 'string',
          description: 'Absolute URL of the realm to sync with.',
        },
        'local-dir': {
          type: 'string',
          description: 'Local workspace directory path.',
        },
        prefer: {
          type: 'string',
          enum: ['local', 'remote', 'newest'],
          description:
            'Conflict-resolution strategy when both sides have changed (default: interactive prompt).',
        },
        delete: {
          type: 'boolean',
          description:
            'Propagate deletions in both directions (default: false).',
        },
        'dry-run': {
          type: 'boolean',
          description: 'Preview only — make no changes (default: false).',
        },
      },
      required: ['realm-url', 'local-dir'],
    },
    execute: async (args) => {
      let realmUrl = requireStringArg(args, 'realm-url', 'realm_sync');
      let localDir = requireStringArg(args, 'local-dir', 'realm_sync');
      let prefer = args.prefer as string | undefined;
      return client.sync(realmUrl, localDir, {
        preferLocal: prefer === 'local',
        preferRemote: prefer === 'remote',
        preferNewest: prefer === 'newest',
        delete: args.delete as boolean | undefined,
        dryRun: args['dry-run'] as boolean | undefined,
      });
    },
  };
}

function buildRealmPushTool(client: BoxelCLIClient): BoxelToolDefinition {
  return {
    name: 'realm_push',
    description:
      'One-way upload from a local workspace directory to a realm. Use when you know local should overwrite remote. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        'realm-url': {
          type: 'string',
          description: 'Absolute URL of the target realm.',
        },
        'local-dir': {
          type: 'string',
          description: 'Local directory containing files to upload.',
        },
        delete: {
          type: 'boolean',
          description:
            'Delete remote files that do not exist locally (default: false).',
        },
        'dry-run': {
          type: 'boolean',
          description: 'Preview only — make no changes (default: false).',
        },
        force: {
          type: 'boolean',
          description: 'Upload all files, even if unchanged (default: false).',
        },
      },
      required: ['realm-url', 'local-dir'],
    },
    execute: async (args) => {
      let realmUrl = requireStringArg(args, 'realm-url', 'realm_push');
      let localDir = requireStringArg(args, 'local-dir', 'realm_push');
      return client.push(realmUrl, localDir, {
        delete: args.delete as boolean | undefined,
        dryRun: args['dry-run'] as boolean | undefined,
        force: args.force as boolean | undefined,
      });
    },
  };
}

function buildRealmPullTool(client: BoxelCLIClient): BoxelToolDefinition {
  return {
    name: 'realm_pull',
    description:
      'One-way download from a realm to a local workspace directory. Use when you know remote should overwrite local. Auth: per-realm JWT.',
    parameters: {
      type: 'object',
      properties: {
        'realm-url': {
          type: 'string',
          description: 'Absolute URL of the source realm.',
        },
        'local-dir': {
          type: 'string',
          description: 'Local directory to download into.',
        },
        delete: {
          type: 'boolean',
          description:
            'Delete local files that do not exist on the realm (default: false).',
        },
      },
      required: ['realm-url', 'local-dir'],
    },
    execute: async (args) => {
      let realmUrl = requireStringArg(args, 'realm-url', 'realm_pull');
      let localDir = requireStringArg(args, 'local-dir', 'realm_pull');
      return client.pull(realmUrl, localDir, {
        delete: args.delete as boolean | undefined,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build tool definitions for all boxel-cli operations. The factory (or any
 * other consumer) calls this once and spreads the result into its tool array.
 *
 * Each tool's execute function is pre-bound to the provided client and config,
 * so the consumer never needs to know about realm URLs or auth.
 */
export function getToolDefinitions(
  client: BoxelCLIClient,
  config: BoxelToolConfig,
): BoxelToolDefinition[] {
  return [
    buildRealmReadTool(client),
    buildRealmWriteTool(client),
    buildRealmDeleteTool(client),
    buildRealmSearchTool(client),
    buildRealmCreateTool(client),
    buildRealmSyncTool(client),
    buildRealmPushTool(client),
    buildRealmPullTool(client),
    buildFetchTranspiledModuleTool(client, config),
    buildRunCommandTool(client, config),
    buildListFilesTool(client, config),
    buildLintFileTool(client, config),
    buildWaitForReadyTool(client, config),
    buildCancelIndexingTool(client, config),
  ];
}
