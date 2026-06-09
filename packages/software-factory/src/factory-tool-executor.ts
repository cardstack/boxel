import type { ToolResult } from './factory-agent/index.ts';
import type { ToolRegistry } from './factory-tool-registry.ts';
import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolExecutorConfig {
  /** Absolute path to the software-factory package root. */
  packageRoot: string;
  /** Target realm URL — tools may only target this realm. */
  targetRealm: string;
  /** Additional scratch realm URL prefixes that are allowed. */
  allowedRealmPrefixes?: string[];
  /** Source realm URL — tools must NEVER target this realm. */
  sourceRealm?: string;
  /** Boxel CLI client — owns all realm auth and API calls. */
  client: BoxelCLIClient;
  /** Per-invocation timeout in ms (default: 60 000). */
  timeoutMs?: number;
  /** Optional log function for auditability. */
  log?: (entry: ToolExecutionLogEntry) => void;
  /** Reserved for future use. */
  debug?: boolean;
}

export interface ToolExecutionLogEntry {
  tool: string;
  category: 'realm-api';
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
   * 3. Enforces safety constraints (no source realm targeting,
   *    realm-server-url must match an allowed origin)
   * 4. Dispatches to the realm-api sub-executor
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

    let argErrors = this.registry.validateArgs(toolName, toolArgs);
    if (argErrors.length > 0) {
      throw new Error(
        `Invalid arguments for tool "${toolName}": ${argErrors.join('; ')}`,
      );
    }

    this.enforceRealmSafety(toolName, toolArgs);

    let start = Date.now();
    let result: ToolResult;

    try {
      result = await this.executeRealmApi(toolName, toolArgs);
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
    // Source realm protection (when configured).
    let sourceUrl = this.config.sourceRealm;
    if (sourceUrl) {
      let normalizedSource = ensureTrailingSlash(sourceUrl);

      let realmArgNames = ['realm', 'realm-url', 'realm-server-url'];

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

    // realm-server-url must match one of the allowed realm origins.
    let serverUrl = toolArgs['realm-server-url'];
    if (typeof serverUrl === 'string' && looksLikeUrl(serverUrl)) {
      this.validateRealmServerTarget(toolName, serverUrl);
    }
  }

  /**
   * Validate that a realm-server-url arg points to a server that hosts
   * one of the allowed realms (origin match against target / scratch
   * realm prefixes).
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
      allowedOrigins.add(new URL(this.config.targetRealm).origin);
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

  // -------------------------------------------------------------------------
  // Sub-executor
  // -------------------------------------------------------------------------

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
  // Logging
  // -------------------------------------------------------------------------

  private logExecution(entry: ToolExecutionLogEntry): void {
    this.config.log?.(entry);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function looksLikeUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}
