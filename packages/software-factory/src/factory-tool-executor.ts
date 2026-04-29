import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import type { ToolResult } from './factory-agent';
import type { ToolRegistry } from './factory-tool-registry';
import { sourceRealmURLFor } from './harness/shared';
import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Tools that perform HTTP-direct card I/O. The safety guard rejects these
 * when they target the factory's target realm — target-realm I/O must go
 * through the workspace (via `write_file` / `read_file`) so local state
 * stays in sync with the realm between iterations.
 */
const TARGET_REALM_BYPASS_TOOLS = new Set([
  'realm_read_file',
  'realm_write_file',
  'realm_delete_file',
]);

/**
 * Map from script tool name to the script file that implements it.
 * Paths are relative to `packages/software-factory/scripts/`.
 */
const SCRIPT_FILE_MAP: Record<string, string> = {
  'search-realm': 'boxel-search.ts',
  'run-realm-tests': 'run-realm-tests.ts',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Realm-targeting safety configuration. Used both by the executor (for
 * subprocess-dispatched script tools) and by the boxel-cli tool adopter in
 * factory-tool-builder (for tools spread directly into the agent's
 * FactoryTool[]).
 */
export interface RealmSafetyConfig {
  /** Target realm URL — `realm-url` args may target this realm only when the
   * tool is NOT in TARGET_REALM_BYPASS_TOOLS. */
  targetRealmUrl: string;
  /** Optional source realm URL — tools must NEVER target this realm. */
  sourceRealmUrl?: string;
  /** Additional scratch realm URL prefixes that are allowed. */
  allowedRealmPrefixes?: string[];
}

/**
 * Derive the production safety config from the realm server URL. Source realm
 * is always `<realmServerUrl>/software-factory/` (the factory's own realm —
 * agent must never target it); allowed prefixes default to the realm server
 * itself, letting `realm_*` tools target any realm hosted there modulo the
 * source-realm rejection that fires first.
 *
 * Tests, smoke, and scenario harnesses construct `RealmSafetyConfig` directly
 * with their own values; this helper is for the live factory loop.
 */
export function buildRealmSafetyConfig(opts: {
  targetRealmUrl: string;
  realmServerUrl: string;
}): RealmSafetyConfig {
  return {
    targetRealmUrl: opts.targetRealmUrl,
    sourceRealmUrl: sourceRealmURLFor(new URL(opts.realmServerUrl)).href,
    allowedRealmPrefixes: [opts.realmServerUrl],
  };
}

export interface ToolExecutorConfig extends RealmSafetyConfig {
  /** Absolute path to the software-factory package root. */
  packageRoot: string;
  /**
   * Realm server URL (host of the target realm). Reserved for callers
   * that want to thread it through alongside the executor; the executor
   * itself never reads it.
   */
  realmServerUrl?: string;
  /** Boxel CLI client — owns all realm auth and API calls. */
  client: BoxelCLIClient;
  /** Per-invocation timeout in ms (default: 60 000). */
  timeoutMs?: number;
  /** Optional log function for auditability. */
  log?: (entry: ToolExecutionLogEntry) => void;
  /**
   * When true, boxel-cli invocations skip the `--quiet` flag so their
   * normal info/log output surfaces in the factory's tool output. Wired
   * to the factory's own `--debug` flag (see `factory-issue-loop-wiring`).
   */
  debug?: boolean;
}

export interface ToolExecutionLogEntry {
  tool: string;
  category: 'script';
  args: Record<string, unknown>;
  exitCode: number;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class ToolSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolSafetyError';
  }
}

export class ToolTimeoutError extends Error {
  constructor(tool: string, timeoutMs: number) {
    super(`Tool "${tool}" timed out after ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
  }
}

export class ToolNotFoundError extends Error {
  constructor(tool: string) {
    super(`Unregistered tool: "${tool}"`);
    this.name = 'ToolNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Standalone safety guard — exported so callers outside the executor
// (notably factory-tool-builder's adoption of boxel-cli tools) can apply
// the same checks before dispatching to a BoxelToolDefinition.execute.
// ---------------------------------------------------------------------------

/**
 * Apply realm-targeting safety checks to a tool invocation. Throws
 * `ToolSafetyError` if any check fails:
 *
 *   - Source realm rejection: `realm` / `realm-url` / `realm-server-url`
 *     / `local-dir` / `path` args matching the configured source realm.
 *   - TARGET_REALM_BYPASS_TOOLS check: realm_read_file / realm_write_file /
 *     realm_delete_file with `realm-url` matching the target realm.
 *   - Allowed-target validation: realm-url args must match the target
 *     realm exactly or one of the allowed scratch prefixes.
 *   - realm-server-url: must point to a server origin hosting an allowed
 *     realm.
 *   - Destructive ops: extra realm-target check for realm_delete_file.
 */
export function enforceRealmSafety(
  toolName: string,
  toolArgs: Record<string, unknown>,
  config: RealmSafetyConfig,
): void {
  // Source realm protection (when configured)
  let sourceUrl = config.sourceRealmUrl;
  if (sourceUrl) {
    let normalizedSource = ensureTrailingSlash(sourceUrl);
    let realmArgNames = [
      'realm',
      'realm-url',
      'realm-server-url',
      'local-dir',
      'path',
    ];
    for (let argName of realmArgNames) {
      let value = toolArgs[argName];
      if (typeof value === 'string' && looksLikeUrl(value)) {
        let normalizedValue = ensureTrailingSlash(value);
        if (normalizedValue === normalizedSource) {
          throw new ToolSafetyError(
            `Tool "${toolName}" cannot target the source realm: ${sourceUrl}`,
          );
        }
      }
    }
  }

  // Allowed-target validation for all URL args across all tool categories.
  // Prevents SSRF and token exfiltration via the propagated Authorization header.
  let urlArgNames = ['realm', 'realm-url'];
  for (let argName of urlArgNames) {
    let value = toolArgs[argName];
    if (typeof value === 'string' && looksLikeUrl(value)) {
      validateRealmTarget(toolName, value, config);
    }
  }

  // realm-server-url must match one of the allowed realm origins.
  let serverUrl = toolArgs['realm-server-url'];
  if (typeof serverUrl === 'string' && looksLikeUrl(serverUrl)) {
    validateRealmServerTarget(toolName, serverUrl, config);
  }

  // Extra validation for destructive operations.
  validateDestructiveOps(toolName, toolArgs, config);
}

function validateRealmTarget(
  toolName: string,
  realmUrl: string,
  config: RealmSafetyConfig,
): void {
  let normalized = ensureTrailingSlash(realmUrl);
  let target = ensureTrailingSlash(config.targetRealmUrl);

  // The HTTP-direct card I/O tools (realm_read_file / realm_write_file / realm_delete_file)
  // must NOT target the factory's target realm — those edits would bypass
  // the local workspace and diverge from the sync flow. Use write_file /
  // read_file (workspace-backed) for target-realm I/O.
  if (TARGET_REALM_BYPASS_TOOLS.has(toolName) && normalized === target) {
    throw new ToolSafetyError(
      `Tool "${toolName}" cannot target the target realm (${realmUrl}). ` +
        `Use write_file / read_file instead — they operate on the local ` +
        `workspace and sync to the realm between iterations. This tool is ` +
        `reserved for scratch / non-target realms.`,
    );
  }

  // Exact realm matches (with trailing slash normalization). For the
  // target-bypass tools the target is excluded from the exact-allowed set —
  // the rejection above fires first for target hits.
  let exactAllowed = TARGET_REALM_BYPASS_TOOLS.has(toolName) ? [] : [target];

  // Prefix matches (no trailing slash — these are URL path prefixes).
  let prefixAllowed = config.allowedRealmPrefixes ?? [];

  let isAllowed =
    exactAllowed.some((exact) => normalized === exact) ||
    prefixAllowed.some((prefix) => normalized.startsWith(prefix));

  if (!isAllowed) {
    throw new ToolSafetyError(
      `Tool "${toolName}" targets realm "${realmUrl}" which is not in the allowed list. ` +
        `Allowed: ${[...exactAllowed, ...prefixAllowed].join(', ')}`,
    );
  }
}

function validateRealmServerTarget(
  toolName: string,
  serverUrl: string,
  config: RealmSafetyConfig,
): void {
  let normalizedServer: string;
  try {
    normalizedServer = new URL(serverUrl).origin;
  } catch {
    throw new ToolSafetyError(
      `Tool "${toolName}" has invalid realm-server-url: "${serverUrl}"`,
    );
  }

  let allowedOrigins = new Set<string>();
  try {
    allowedOrigins.add(new URL(config.targetRealmUrl).origin);
  } catch {
    // skip invalid
  }
  for (let prefix of config.allowedRealmPrefixes ?? []) {
    try {
      allowedOrigins.add(new URL(prefix).origin);
    } catch {
      // skip invalid
    }
  }

  if (!allowedOrigins.has(normalizedServer)) {
    throw new ToolSafetyError(
      `Tool "${toolName}" targets server "${serverUrl}" which is not in the allowed origins. ` +
        `Allowed: ${[...allowedOrigins].join(', ')}`,
    );
  }
}

function validateDestructiveOps(
  toolName: string,
  toolArgs: Record<string, unknown>,
  config: RealmSafetyConfig,
): void {
  // Extra validation for destructive realm operations
  if (toolName === 'realm_delete_file') {
    let realmUrl = toolArgs['realm-url'];
    if (typeof realmUrl === 'string') {
      validateRealmTarget(toolName, realmUrl, config);
    }
  }
}

// ---------------------------------------------------------------------------
// ToolExecutor — dispatches subprocess-backed script tools. Realm-api
// tools (read/write/delete/search/sync/push/pull/etc.) live in boxel-cli's
// getToolDefinitions and are wrapped with `enforceRealmSafety` directly in
// factory-tool-builder without going through the executor.
// ---------------------------------------------------------------------------

export class ToolExecutor {
  private registry: ToolRegistry;
  private config: ToolExecutorConfig;
  private timeoutMs: number;

  constructor(registry: ToolRegistry, config: ToolExecutorConfig) {
    this.registry = registry;
    this.config = config;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Execute a registered subprocess-backed script tool by name. The executor:
   * 1. Validates the tool name against the registry
   * 2. Validates arguments against the manifest
   * 3. Enforces realm-targeting safety constraints
   * 4. Spawns the script subprocess (npx ts-node ...)
   * 5. Captures output as a ToolResult
   */
  async execute(
    toolName: string,
    toolArgs: Record<string, unknown> = {},
  ): Promise<ToolResult> {
    if (!toolName) {
      throw new ToolNotFoundError('(empty)');
    }

    let manifest = this.registry.getManifest(toolName);
    if (!manifest) {
      throw new ToolNotFoundError(toolName);
    }

    // Validate required args.
    let argErrors = this.registry.validateArgs(toolName, toolArgs);
    if (argErrors.length > 0) {
      throw new Error(
        `Invalid arguments for tool "${toolName}": ${argErrors.join('; ')}`,
      );
    }

    // Realm-targeting safety.
    enforceRealmSafety(toolName, toolArgs, this.config);

    let start = Date.now();
    let result: ToolResult;

    try {
      if (manifest.category !== 'script') {
        throw new Error(`Unknown tool category: ${manifest.category}`);
      }
      result = await this.executeScript(toolName, toolArgs);
    } catch (error) {
      let durationMs = Date.now() - start;
      let errorMessage = error instanceof Error ? error.message : String(error);

      this.logExecution({
        tool: toolName,
        category: 'script',
        args: toolArgs,
        exitCode: 1,
        durationMs,
        error: errorMessage,
      });

      // Re-throw safety and timeout errors as-is.
      if (
        error instanceof ToolSafetyError ||
        error instanceof ToolTimeoutError ||
        error instanceof ToolNotFoundError
      ) {
        throw error;
      }

      return {
        tool: toolName,
        exitCode: 1,
        output: { error: errorMessage },
        durationMs,
      };
    }

    this.logExecution({
      tool: toolName,
      category: 'script',
      args: toolArgs,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Sub-executors
  // -------------------------------------------------------------------------

  private async executeScript(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): Promise<ToolResult> {
    let scriptFile = SCRIPT_FILE_MAP[toolName];
    if (!scriptFile) {
      throw new Error(`No script file mapped for tool "${toolName}"`);
    }

    let scriptPath = resolve(this.config.packageRoot, 'scripts', scriptFile);

    let cliArgs = buildCliArgs(toolArgs);

    return this.spawnProcess(
      toolName,
      'npx',
      ['ts-node', '--transpileOnly', scriptPath, ...cliArgs],
      'json',
    );
  }

  // -------------------------------------------------------------------------
  // Process spawning
  // -------------------------------------------------------------------------

  private spawnProcess(
    toolName: string,
    command: string,
    args: string[],
    outputFormat: 'json' | 'text',
  ): Promise<ToolResult> {
    return new Promise((resolvePromise, reject) => {
      let start = Date.now();
      let stdout = '';
      let stderr = '';

      let child = spawn(command, args, {
        cwd: this.config.packageRoot,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timer = setTimeout(() => {
        child.kill('SIGTERM');
        // Give the process a moment to clean up, then force kill
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
        reject(new ToolTimeoutError(toolName, this.timeoutMs));
      }, this.timeoutMs);

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        let durationMs = Date.now() - start;
        let exitCode = code ?? 1;

        let output: unknown;
        if (outputFormat === 'json') {
          try {
            output = JSON.parse(stdout.trim());
          } catch {
            output = {
              raw: stdout.trim(),
              ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
            };
          }
        } else {
          output = stdout.trim();
          if (stderr.trim() && exitCode !== 0) {
            output = `${stdout.trim()}\n\nSTDERR:\n${stderr.trim()}`;
          }
        }

        resolvePromise({
          tool: toolName,
          exitCode,
          output,
          durationMs,
        });
      });
    });
  }

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  private logExecution(entry: ToolExecutionLogEntry): void {
    this.config.log?.(entry);
  }
}

// ---------------------------------------------------------------------------
// Helpers: CLI arg building
// ---------------------------------------------------------------------------

function buildCliArgs(toolArgs: Record<string, unknown>): string[] {
  let args: string[] = [];

  for (let [key, value] of Object.entries(toolArgs)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'boolean') {
      if (value) {
        args.push(`--${key}`);
      }
    } else if (Array.isArray(value)) {
      for (let item of value) {
        args.push(`--${key}`, String(item));
      }
    } else {
      args.push(`--${key}`, String(value));
    }
  }

  return args;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
