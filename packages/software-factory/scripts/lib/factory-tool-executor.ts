import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import type { AgentAction, ToolResult } from './factory-agent';
import type { ToolRegistry } from './factory-tool-registry';

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
  'pick-ticket': 'pick-ticket.ts',
  'get-session': 'boxel-session.ts',
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
  /** Test realm URL — tools may also target this realm. */
  testRealmUrl: string;
  /** Additional scratch realm URL prefixes that are allowed. */
  allowedRealmPrefixes?: string[];
  /** Source realm URL — tools must NEVER target this realm. */
  sourceRealmUrl?: string;
  /** Fetch implementation for realm API calls. */
  fetch?: typeof globalThis.fetch;
  /** Authorization header value for realm API calls. */
  authorization?: string;
  /** Per-invocation timeout in ms (default: 60 000). */
  timeoutMs?: number;
  /** Optional log function for auditability. */
  log?: (entry: ToolExecutionLogEntry) => void;
  /** Matrix homeserver URL (for post-create account data update). */
  matrixUrl?: string;
  /** Matrix access token (from Matrix login). */
  matrixAccessToken?: string;
  /** Matrix user ID (e.g. @factory:localhost). */
  matrixUserId?: string;
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
   * Execute a validated `invoke_tool` action and return the result.
   *
   * The executor:
   * 1. Validates the tool name against the registry
   * 2. Validates arguments against the manifest
   * 3. Enforces safety constraints (no source realm targeting)
   * 4. Dispatches to the appropriate sub-executor
   * 5. Captures output as a ToolResult
   */
  async execute(action: AgentAction): Promise<ToolResult> {
    let toolName = action.tool;
    if (!toolName) {
      throw new ToolNotFoundError('(empty)');
    }

    let manifest = this.registry.getManifest(toolName);
    if (!manifest) {
      throw new ToolNotFoundError(toolName);
    }

    let toolArgs = action.toolArgs ?? {};

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

    // Allowed-realm targeting for realm-api tools (always enforced)
    let manifest = this.registry.getManifest(toolName);
    if (manifest?.category === 'realm-api') {
      let realmUrl = toolArgs['realm-url'];
      if (typeof realmUrl === 'string' && looksLikeUrl(realmUrl)) {
        this.validateRealmTarget(toolName, realmUrl);
      }
    }

    // Extra validation for destructive operations
    this.validateDestructiveOps(toolName, toolArgs);
  }

  private validateRealmTarget(toolName: string, realmUrl: string): void {
    let normalized = ensureTrailingSlash(realmUrl);
    let target = ensureTrailingSlash(this.config.targetRealmUrl);
    let test = ensureTrailingSlash(this.config.testRealmUrl);

    // Exact realm matches (with trailing slash normalization)
    let exactAllowed = [target, test];

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

  private validateDestructiveOps(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): void {
    // realm-delete and realm-atomic with remove ops need extra care
    if (toolName === 'realm-delete') {
      let realmUrl = toolArgs['realm-url'];
      if (typeof realmUrl === 'string') {
        this.validateRealmTarget(toolName, realmUrl);
      }
    }

    if (toolName === 'realm-atomic') {
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

    // realm-create and realm-reindex require extra validation
    if (toolName === 'realm-create' || toolName === 'realm-reindex') {
      // These are allowed but logged — the orchestrator trusts the agent
      // chose them deliberately within the allowed realm set.
    }
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
    let fetchImpl = this.config.fetch ?? globalThis.fetch;
    let start = Date.now();

    let { url, method, headers, body } = buildRealmApiRequest(
      toolName,
      toolArgs,
      this.config.authorization,
    );

    let controller = new AbortController();
    let timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response = await fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      let durationMs = Date.now() - start;
      let responseBody: unknown;

      let contentType = response.headers.get('content-type') ?? '';
      let rawText = await response.text();
      if (contentType.includes('json') && rawText.length > 0) {
        try {
          responseBody = JSON.parse(rawText);
        } catch {
          responseBody = rawText;
        }
      } else {
        responseBody = rawText;
      }

      // Some endpoints return important values in headers (e.g. _server-session
      // returns the JWT in the Authorization header with an empty/null body).
      let authorizationHeader = response.headers.get('authorization');
      if (toolName === 'realm-server-session' && authorizationHeader) {
        responseBody = { token: authorizationHeader };
      }

      // After successful realm-create, update Matrix account data to include
      // the new realm in the user's realm list (matching host app behavior).
      if (toolName === 'realm-create' && response.ok) {
        let createdRealmUrl = extractCreatedRealmUrl(responseBody);
        if (createdRealmUrl) {
          await this.appendRealmToMatrixAccountData(fetchImpl, createdRealmUrl);
        }
      }

      return {
        tool: toolName,
        exitCode: response.ok ? 0 : 1,
        output: response.ok
          ? responseBody
          : {
              error: `HTTP ${response.status}`,
              body: responseBody,
            },
        durationMs,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ToolTimeoutError(toolName, this.timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
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

  // -------------------------------------------------------------------------
  // Matrix account data
  // -------------------------------------------------------------------------

  /**
   * After realm creation, append the new realm URL to the user's Matrix
   * account data so the realm appears in their realm list. Matches the host
   * app's `appendRealmToAccountData` behavior (matrix-service.ts:639-653).
   *
   * Silently skips when Matrix config is not provided.
   */
  private async appendRealmToMatrixAccountData(
    fetchImpl: typeof globalThis.fetch,
    newRealmUrl: string,
  ): Promise<void> {
    let { matrixUrl, matrixAccessToken, matrixUserId } = this.config;
    if (!matrixUrl || !matrixAccessToken || !matrixUserId) {
      return;
    }

    let baseUrl = ensureTrailingSlash(matrixUrl);
    let encodedUserId = encodeURIComponent(matrixUserId);
    let accountDataUrl = `${baseUrl}_matrix/client/v3/user/${encodedUserId}/account_data/app.boxel.realms`;
    let authHeaders = {
      Authorization: `Bearer ${matrixAccessToken}`,
      'Content-Type': 'application/json',
    };

    // GET current realm list
    let existingRealms: string[] = [];
    try {
      let getResponse = await fetchImpl(accountDataUrl, {
        method: 'GET',
        headers: authHeaders,
      });
      if (getResponse.ok) {
        let data = (await getResponse.json()) as { realms?: string[] };
        existingRealms = data.realms ?? [];
      }
      // 404 means no account data yet — start with empty list
    } catch {
      // Network error reading account data — proceed with empty list
    }

    // Append and PUT
    let updatedRealms = [...existingRealms, newRealmUrl];
    try {
      await fetchImpl(accountDataUrl, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ realms: updatedRealms }),
      });
    } catch {
      // Best-effort — don't fail the realm-create if account data update fails
    }
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
// Helpers: Realm API request building
// ---------------------------------------------------------------------------

interface RealmApiRequestParams {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function buildRealmApiRequest(
  toolName: string,
  toolArgs: Record<string, unknown>,
  authorization?: string,
): RealmApiRequestParams {
  let headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (authorization) {
    headers['Authorization'] = authorization;
  }

  switch (toolName) {
    case 'realm-read': {
      let realmUrl = ensureTrailingSlash(String(toolArgs['realm-url']));
      let path = String(toolArgs['path']);
      let accept =
        typeof toolArgs['accept'] === 'string'
          ? toolArgs['accept']
          : 'application/vnd.card+source';
      return {
        url: `${realmUrl}${path}`,
        method: 'GET',
        headers: { ...headers, Accept: accept },
      };
    }

    case 'realm-write': {
      let realmUrl = ensureTrailingSlash(String(toolArgs['realm-url']));
      let path = String(toolArgs['path']);
      let content = String(toolArgs['content']);
      let contentType =
        typeof toolArgs['content-type'] === 'string'
          ? toolArgs['content-type']
          : 'application/vnd.card+source';
      return {
        url: `${realmUrl}${path}`,
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType },
        body: content,
      };
    }

    case 'realm-delete': {
      let realmUrl = ensureTrailingSlash(String(toolArgs['realm-url']));
      let path = String(toolArgs['path']);
      return {
        url: `${realmUrl}${path}`,
        method: 'DELETE',
        headers,
      };
    }

    case 'realm-atomic': {
      let realmUrl = ensureTrailingSlash(String(toolArgs['realm-url']));
      let operations = String(toolArgs['operations']);
      return {
        url: `${realmUrl}_atomic`,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/vnd.api+json',
        },
        body: JSON.stringify({ 'atomic:operations': JSON.parse(operations) }),
      };
    }

    case 'realm-search': {
      let realmUrl = ensureTrailingSlash(String(toolArgs['realm-url']));
      let query = String(toolArgs['query']);
      return {
        url: `${realmUrl}_search`,
        method: 'QUERY',
        headers: {
          ...headers,
          Accept: 'application/vnd.card+json',
          'Content-Type': 'application/json',
        },
        body: query,
      };
    }

    case 'realm-create': {
      let serverUrl = ensureTrailingSlash(String(toolArgs['realm-server-url']));
      let name = String(toolArgs['name']);
      let endpoint = String(toolArgs['endpoint']);
      let iconURL =
        typeof toolArgs['iconURL'] === 'string'
          ? toolArgs['iconURL']
          : iconURLForName(name);
      let backgroundURL =
        typeof toolArgs['backgroundURL'] === 'string'
          ? toolArgs['backgroundURL']
          : getRandomBackgroundURL();
      return {
        url: `${serverUrl}_create-realm`,
        method: 'POST',
        headers: {
          ...headers,
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
        },
        body: JSON.stringify({
          data: {
            type: 'realm',
            attributes: {
              name,
              endpoint,
              ...(iconURL ? { iconURL } : {}),
              ...(backgroundURL ? { backgroundURL } : {}),
            },
          },
        }),
      };
    }

    case 'realm-server-session': {
      let serverUrl = ensureTrailingSlash(String(toolArgs['realm-server-url']));
      let openidToken = String(toolArgs['openid-token']);
      return {
        url: `${serverUrl}_server-session`,
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: openidToken }),
      };
    }

    case 'realm-auth': {
      let serverUrl = ensureTrailingSlash(String(toolArgs['realm-server-url']));
      return {
        url: `${serverUrl}_realm-auth`,
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      };
    }

    default:
      throw new Error(`Unknown realm-api tool: "${toolName}"`);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function looksLikeUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function extractCreatedRealmUrl(responseBody: unknown): string | undefined {
  if (
    typeof responseBody === 'object' &&
    responseBody !== null &&
    'data' in responseBody
  ) {
    let data = (responseBody as { data: unknown }).data;
    if (typeof data === 'object' && data !== null && 'id' in data) {
      let id = (data as { id: unknown }).id;
      if (typeof id === 'string') {
        return id;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Icon and background URL defaults
// TODO: Move iconURLForName / getRandomBackgroundURL to @cardstack/runtime-common
// so host (packages/host/app/lib/utils.ts) and software-factory share one copy.
// ---------------------------------------------------------------------------

const ICON_URLS: Record<string, string> = {
  a: 'https://boxel-images.boxel.ai/icons/Letter-a.png',
  b: 'https://boxel-images.boxel.ai/icons/Letter-b.png',
  c: 'https://boxel-images.boxel.ai/icons/Letter-c.png',
  d: 'https://boxel-images.boxel.ai/icons/Letter-d.png',
  e: 'https://boxel-images.boxel.ai/icons/Letter-e.png',
  f: 'https://boxel-images.boxel.ai/icons/Letter-f.png',
  g: 'https://boxel-images.boxel.ai/icons/Letter-g.png',
  h: 'https://boxel-images.boxel.ai/icons/Letter-h.png',
  i: 'https://boxel-images.boxel.ai/icons/Letter-i.png',
  j: 'https://boxel-images.boxel.ai/icons/Letter-j.png',
  k: 'https://boxel-images.boxel.ai/icons/Letter-k.png',
  l: 'https://boxel-images.boxel.ai/icons/Letter-l.png',
  m: 'https://boxel-images.boxel.ai/icons/Letter-m.png',
  n: 'https://boxel-images.boxel.ai/icons/Letter-n.png',
  o: 'https://boxel-images.boxel.ai/icons/Letter-o.png',
  p: 'https://boxel-images.boxel.ai/icons/Letter-p.png',
  q: 'https://boxel-images.boxel.ai/icons/Letter-q.png',
  r: 'https://boxel-images.boxel.ai/icons/Letter-r.png',
  s: 'https://boxel-images.boxel.ai/icons/Letter-s.png',
  t: 'https://boxel-images.boxel.ai/icons/Letter-t.png',
  u: 'https://boxel-images.boxel.ai/icons/Letter-u.png',
  v: 'https://boxel-images.boxel.ai/icons/Letter-v.png',
  w: 'https://boxel-images.boxel.ai/icons/Letter-w.png',
  x: 'https://boxel-images.boxel.ai/icons/Letter-x.png',
  y: 'https://boxel-images.boxel.ai/icons/Letter-y.png',
  z: 'https://boxel-images.boxel.ai/icons/letter-z.png',
};

const BACKGROUND_URLS: readonly string[] = [
  'https://boxel-images.boxel.ai/background-images/4k-arabic-teal.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-arrow-weave.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-atmosphere-curvature.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-brushed-slabs.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-coral-reefs.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-crescent-lake.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-curvilinear-stairs.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-desert-dunes.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-doodle-board.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-fallen-leaves.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-flowing-mesh.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-glass-reflection.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-glow-cells.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-granite-peaks.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-green-wormhole.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-joshua-dawn.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-lava-river.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-leaves-moss.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-light-streaks.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-lowres-glitch.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-marble-shimmer.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-metallic-leather.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-microscopic-crystals.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-moon-face.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-mountain-runway.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-origami-flock.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-paint-swirl.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-pastel-triangles.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-perforated-sheet.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-plastic-ripples.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-powder-puff.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-radiant-crystal.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-redrock-canyon.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-rock-portal.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-rolling-hills.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-sand-stone.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-silver-fur.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-spa-pool.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-stained-glass.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-stone-veins.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-tangerine-plains.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-techno-floor.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-thick-frost.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-water-surface.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-watercolor-splashes.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-wildflower-field.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-wood-grain.jpg',
];

export function iconURLForName(name: string): string | undefined {
  if (!name) {
    return undefined;
  }
  let cleansed = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^[0-9]+/, '');
  return ICON_URLS[cleansed.charAt(0)];
}

export function getRandomBackgroundURL(): string {
  let index = Math.floor(Math.random() * BACKGROUND_URLS.length);
  return BACKGROUND_URLS[index];
}
