import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import type { ToolResult } from './factory-agent';
import type { ToolRegistry } from './factory-tool-registry';
import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Map from script tool name to the script file that implements it.
 * Paths are relative to `packages/software-factory/scripts/`.
 */
const SCRIPT_FILE_MAP: Record<string, string> = {
  'search-realm': 'boxel-search.ts',
  'run-realm-tests': 'run-realm-tests.ts',
};

/**
 * Map from boxel-cli tool name to the `npx boxel` subcommand.
 */
const BOXEL_CLI_COMMAND_MAP: Record<string, string> = {
  'boxel-sync': 'sync',
  'boxel-push': 'push',
  'boxel-pull': 'pull',
  'boxel-status': 'status',
  'boxel-create': 'create',
  'boxel-history': 'history',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolExecutorConfig {
  /** Absolute path to the software-factory package root. */
  packageRoot: string;
  /** Target realm URL — tools may only target this realm. */
  targetRealmUrl: string;
  /** Additional scratch realm URL prefixes that are allowed. */
  allowedRealmPrefixes?: string[];
  /** Source realm URL — tools must NEVER target this realm. */
  sourceRealmUrl?: string;
  /** Boxel CLI client — owns all realm auth and API calls. */
  client: BoxelCLIClient;
  /** Per-invocation timeout in ms (default: 60 000). */
  timeoutMs?: number;
  /** Optional log function for auditability. */
  log?: (entry: ToolExecutionLogEntry) => void;
}

export interface ToolExecutionLogEntry {
  tool: string;
  category: 'script' | 'boxel-cli' | 'realm-api';
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
// ToolExecutor
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
   * Execute a tool by name with the given arguments and return the result.
   *
   * The executor:
   * 1. Validates the tool name against the registry
   * 2. Validates arguments against the manifest
   * 3. Enforces safety constraints (no source realm targeting)
   * 4. Dispatches to the appropriate sub-executor
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

    // Validate required args
    let argErrors = this.registry.validateArgs(toolName, toolArgs);
    if (argErrors.length > 0) {
      throw new Error(
        `Invalid arguments for tool "${toolName}": ${argErrors.join('; ')}`,
      );
    }

    // Safety: reject source realm targeting
    this.enforceRealmSafety(toolName, toolArgs);

    let start = Date.now();
    let result: ToolResult;

    try {
      switch (manifest.category) {
        case 'script':
          result = await this.executeScript(toolName, toolArgs);
          break;
        case 'boxel-cli':
          result = await this.executeBoxelCli(toolName, toolArgs);
          break;
        case 'realm-api':
          result = await this.executeRealmApi(toolName, toolArgs);
          break;
        default:
          throw new Error(`Unknown tool category: ${manifest.category}`);
      }
    } catch (error) {
      let durationMs = Date.now() - start;
      let errorMessage = error instanceof Error ? error.message : String(error);

      this.logExecution({
        tool: toolName,
        category: manifest.category,
        args: toolArgs,
        exitCode: 1,
        durationMs,
        error: errorMessage,
      });

      // Re-throw safety and timeout errors as-is
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
      category: manifest.category,
      args: toolArgs,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Safety
  // -------------------------------------------------------------------------

  private enforceRealmSafety(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): void {
    // Source realm protection (when configured)
    let sourceUrl = this.config.sourceRealmUrl;
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
        this.validateRealmTarget(toolName, value);
      }
    }

    // realm-server-url must match one of the allowed realm origins
    let serverUrl = toolArgs['realm-server-url'];
    if (typeof serverUrl === 'string' && looksLikeUrl(serverUrl)) {
      this.validateRealmServerTarget(toolName, serverUrl);
    }

    // Extra validation for destructive operations
    this.validateDestructiveOps(toolName, toolArgs);
  }

  private validateRealmTarget(toolName: string, realmUrl: string): void {
    let normalized = ensureTrailingSlash(realmUrl);
    let target = ensureTrailingSlash(this.config.targetRealmUrl);

    // Exact realm matches (with trailing slash normalization)
    let exactAllowed = [target];

    // Prefix matches (no trailing slash — these are URL path prefixes)
    let prefixAllowed = this.config.allowedRealmPrefixes ?? [];

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

  /**
   * Validate that a realm-server-url arg points to a server that hosts
   * one of the allowed realms (origin match against target/test/prefixes).
   */
  private validateRealmServerTarget(toolName: string, serverUrl: string): void {
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
      allowedOrigins.add(new URL(this.config.targetRealmUrl).origin);
    } catch {
      // skip invalid
    }
    for (let prefix of this.config.allowedRealmPrefixes ?? []) {
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

  private validateDestructiveOps(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): void {
    // Extra validation for destructive realm operations
    if (toolName === 'realm-delete') {
      let realmUrl = toolArgs['realm-url'];
      if (typeof realmUrl === 'string') {
        this.validateRealmTarget(toolName, realmUrl);
      }
    }

    // boxel-push with --delete
    if (toolName === 'boxel-push' && toolArgs['delete']) {
      let realmUrl = toolArgs['realm-url'];
      if (typeof realmUrl === 'string' && looksLikeUrl(realmUrl)) {
        this.validateRealmTarget(toolName, realmUrl);
      }
    }

    // realm-create is allowed but logged — the orchestrator trusts the agent
    // chose it deliberately within the allowed realm set.
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

  private async executeBoxelCli(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): Promise<ToolResult> {
    let subcommand = BOXEL_CLI_COMMAND_MAP[toolName];
    if (!subcommand) {
      throw new Error(`No boxel-cli command mapped for tool "${toolName}"`);
    }

    let cliArgs = buildBoxelCliArgs(toolName, subcommand, toolArgs);

    return this.spawnProcess(toolName, 'npx', ['boxel', ...cliArgs], 'text');
  }

  private async executeRealmApi(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): Promise<ToolResult> {
    return this.withTimeout(
      toolName,
      this.executeRealmApiInner(toolName, toolArgs),
    );
  }

  /**
   * Race an operation against `this.timeoutMs` and throw `ToolTimeoutError`
   * if the timeout wins. `BoxelCLIClient` methods don't accept an
   * AbortSignal (auth + retry live inside ProfileManager), so we enforce
   * the timeout at the executor boundary — the in-flight request becomes
   * best-effort and is reaped by the GC.
   */
  private async withTimeout<T>(toolName: string, op: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ToolTimeoutError(toolName, this.timeoutMs));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([op, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async executeRealmApiInner(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): Promise<ToolResult> {
    let client = this.config.client;
    let start = Date.now();

    let output: unknown;
    let ok: boolean;

    switch (toolName) {
      case 'realm-read': {
        let result = await client.read(
          String(toolArgs['realm-url']),
          String(toolArgs['path']),
        );
        ok = result.ok;
        output = ok ? result.document : { error: result.error };
        break;
      }

      case 'realm-write': {
        let result = await client.write(
          String(toolArgs['realm-url']),
          String(toolArgs['path']),
          String(toolArgs['content']),
        );
        ok = result.ok;
        output = ok ? result : { error: result.error };
        break;
      }

      case 'realm-delete': {
        let result = await client.delete(
          String(toolArgs['realm-url']),
          String(toolArgs['path']),
        );
        ok = result.ok;
        output = ok ? result : { error: result.error };
        break;
      }

      case 'realm-search': {
        let rawQuery = toolArgs['query'];
        if (typeof rawQuery !== 'string') {
          ok = false;
          output = {
            error:
              "Invalid 'query' argument for realm-search: expected a JSON string.",
          };
          break;
        }
        let query: Record<string, unknown>;
        try {
          query = JSON.parse(rawQuery);
        } catch {
          ok = false;
          output = {
            error:
              "Invalid JSON for 'query' in realm-search: expected valid JSON.",
          };
          break;
        }
        let result = await client.search(String(toolArgs['realm-url']), query);
        ok = result.ok;
        output = result.ok
          ? { data: result.data }
          : { error: result.error, status: result.status };
        break;
      }

      case 'realm-create': {
        let displayName = String(toolArgs['name']);
        let realmName = String(toolArgs['endpoint']);
        let requestedServerUrl = ensureTrailingSlash(
          String(toolArgs['realm-server-url']),
        );
        try {
          let active = client.getActiveProfile();
          if (
            active &&
            ensureTrailingSlash(active.realmServerUrl) !== requestedServerUrl
          ) {
            throw new Error(
              `realm-create cannot target "${requestedServerUrl}": active Boxel profile realm server is "${ensureTrailingSlash(active.realmServerUrl)}".`,
            );
          }
          let result = await client.createRealm({
            realmName,
            displayName,
            iconURL: toolArgs['iconURL'] as string | undefined,
            backgroundURL: toolArgs['backgroundURL'] as string | undefined,
          });
          ok = true;
          output = { data: { id: result.realmUrl } };
        } catch (error) {
          ok = false;
          output = {
            error: error instanceof Error ? error.message : String(error),
          };
        }
        break;
      }

      default:
        throw new Error(`Unknown realm-api tool: "${toolName}"`);
    }

    return {
      tool: toolName,
      exitCode: ok ? 0 : 1,
      output,
      durationMs: Date.now() - start,
    };
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

function buildBoxelCliArgs(
  _toolName: string,
  subcommand: string,
  toolArgs: Record<string, unknown>,
): string[] {
  let args: string[] = [subcommand];

  // Certain tools use positional args rather than flags
  switch (subcommand) {
    case 'sync': {
      let path = toolArgs['path'];
      if (typeof path === 'string') {
        args.push(path);
      }
      if (typeof toolArgs['prefer'] === 'string') {
        args.push(`--prefer-${toolArgs['prefer']}`);
      }
      if (toolArgs['dry-run']) {
        args.push('--dry-run');
      }
      break;
    }
    case 'push': {
      let localDir = toolArgs['local-dir'];
      let realmUrl = toolArgs['realm-url'];
      if (typeof localDir === 'string') {
        args.push(localDir);
      }
      if (typeof realmUrl === 'string') {
        args.push(realmUrl);
      }
      if (toolArgs['delete']) {
        args.push('--delete');
      }
      if (toolArgs['dry-run']) {
        args.push('--dry-run');
      }
      break;
    }
    case 'pull': {
      let realmUrl = toolArgs['realm-url'];
      let localDir = toolArgs['local-dir'];
      if (typeof realmUrl === 'string') {
        args.push(realmUrl);
      }
      if (typeof localDir === 'string') {
        args.push(localDir);
      }
      if (toolArgs['delete']) {
        args.push('--delete');
      }
      if (toolArgs['dry-run']) {
        args.push('--dry-run');
      }
      break;
    }
    case 'status': {
      let path = toolArgs['path'];
      if (typeof path === 'string') {
        args.push(path);
      }
      if (toolArgs['all']) {
        args.push('--all');
      }
      if (toolArgs['pull']) {
        args.push('--pull');
      }
      break;
    }
    case 'create': {
      let endpoint = toolArgs['endpoint'];
      let name = toolArgs['name'];
      if (typeof endpoint === 'string') {
        args.push(endpoint);
      }
      if (typeof name === 'string') {
        args.push(name);
      }
      break;
    }
    case 'history': {
      let path = toolArgs['path'];
      if (typeof path === 'string') {
        args.push(path);
      }
      if (typeof toolArgs['message'] === 'string') {
        args.push('-m', toolArgs['message']);
      }
      break;
    }
    default:
      // Fall through to generic flag building
      args.push(...buildCliArgs(toolArgs));
  }

  return args;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function looksLikeUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}
