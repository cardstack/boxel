/**
 * OpencodeFactoryAgent — LoopAgent backed by the opencode SDK.
 *
 * Drives a session against an `opencode` subprocess so `--agent
 * openrouter` runs get native fs / Bash / Glob / Grep, with the 8
 * factory tools surfaced over MCP for schema lookup, validation, and
 * control signals.
 *
 * Two auth modes:
 *   - **Direct** — `openRouterApiKey` set: opencode's provider points
 *     at openrouter.ai with the user's bearer.
 *   - **Passthrough** — no key: opencode's provider points at the
 *     realm server's `_openrouter/chat/completions` with a server JWT;
 *     the realm applies the server-side OpenRouter key and bills
 *     credits to the operator.
 *
 * DONE / CLARIFICATION signals carry a Symbol that doesn't survive
 * JSON-RPC, so the MCP server re-tags them `factory:done` /
 * `factory:clarification` and the agent matches on the tag.
 */

import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';

import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Config as OpencodeConfig } from '@opencode-ai/sdk';

// `@opencode-ai/sdk` is ESM-only and the test runner uses ts-node in
// CommonJS mode, so a top-level `import` would fail at module-load
// time on every test that touches this file. Lazy-load via dynamic
// import inside `run()` so the type imports stay available at compile
// time and the runtime cost (one dynamic import per `factory:go`) is
// negligible.
async function loadOpencodeSdk() {
  let mod = await import('@opencode-ai/sdk');
  return {
    createOpencodeServer: mod.createOpencodeServer,
    createOpencodeClient: mod.createOpencodeClient,
  };
}

import {
  CLARIFICATION_SIGNAL,
  DONE_SIGNAL,
  type FactoryTool,
  type ToolCallEntry,
} from '../factory-tool-builder';
import { deriveCatalogRealmUrl } from '../factory-catalog-realm';
import { logger } from '../logger';
import {
  assembleBootstrapPrompt,
  assembleImplementPrompt,
  assembleIteratePrompt,
  FilePromptLoader,
  requireDarkfactoryModuleUrl,
  type PromptLoader,
} from '../factory-prompt-loader';
import type {
  AgentContext,
  AgentRunResult,
  LoopAgent,
  ResolvedSkill,
} from './types';

let log = logger('factory-agent-opencode');

const FACTORY_PROVIDER_ID = 'factory-openrouter';
const MCP_SERVER_NAME = 'factory';
const SIGNAL_DONE_TAG = 'factory:done';
const SIGNAL_CLARIFICATION_TAG = 'factory:clarification';

/**
 * Upper bound on the post-race finally drain. If the race above won
 * via the `waitForSessionIdle` fallback, the prompt + event-log
 * promises are very likely stuck on the opencode 1.14.34 dead-HTTP
 * bug; we let them try to settle for a beat, then move on.
 */
const POST_RACE_DRAIN_MS = 2000;

/**
 * The 8 factory tools exposed to the agent over MCP. Filesystem and
 * shell are owned by opencode's native `Read` / `Write` / `Edit` /
 * `Glob` / `Grep` / `Bash`.
 */
const FACTORY_MCP_TOOL_NAMES = new Set([
  'get_card_schema',
  'run_tests',
  'run_lint',
  'run_evaluate',
  'run_parse',
  'run_instantiate',
  'signal_done',
  'request_clarification',
]);

/**
 * Per-session tool whitelist for opencode. We need fs (`read` / `write` /
 * `edit`) for the workspace, `bash` to shell out to `boxel
 * read-transpiled` / `boxel search`, and `glob` / `grep` to inspect
 * existing state. Everything else opencode bundles by default
 * (`webfetch`, `task`, `todowrite`, `skill`, `question`, `invalid`)
 * costs tokens on every request without serving the factory's flow,
 * so we explicitly disable them. Our own factory MCP tools come
 * through the MCP transport and aren't affected by this map.
 */
const ENABLED_OPENCODE_TOOLS = {
  read: true,
  write: true,
  edit: true,
  bash: true,
  glob: true,
  grep: true,
  webfetch: false,
  task: false,
  todowrite: false,
  skill: false,
  question: false,
  invalid: false,
};

export interface OpencodeAgentConfig {
  /** OpenRouter model ID (e.g., `anthropic/claude-opus-4-7`). */
  model: string;
  /** Realm server URL — used in passthrough mode as the base for opencode's provider. */
  realmServerUrl: string;
  /** Boxel CLI client — used in passthrough mode to fetch the server JWT we hand opencode. */
  client: import('@cardstack/boxel-cli/api').BoxelCLIClient;
  /**
   * If set, opencode talks to OpenRouter directly with this key in
   * the Authorization header. If unset, the agent falls back to
   * passthrough mode (boxel JWT → realm-server
   * `/_openrouter/chat/completions`).
   */
  openRouterApiKey?: string;
  /**
   * Local workspace directory mirroring the target realm. Used as
   * the opencode subprocess `cwd` so native fs tools resolve realm-
   * relative paths inside the workspace. Combined with
   * `permission.external_directory: 'deny'` to scope writes.
   */
  workspaceDir: string;
  /** When true, log opencode events to stderr. */
  debug?: boolean;
}

interface CapturedSignal {
  kind: 'done' | 'clarification';
  message?: string;
}

interface RunHooks {
  onToolCall: (entry: ToolCallEntry) => void;
  onSignal: (signal: CapturedSignal) => void;
}

export class OpencodeFactoryAgent implements LoopAgent {
  private config: OpencodeAgentConfig;
  private promptLoader: PromptLoader;

  // Long-lived opencode subprocess + MCP server. Spawned once on the
  // first `run()` and reused for every subsequent iteration. opencode
  // 1.14.34 has rapid-restart failure modes (fresh-spawn `session.prompt`
  // POSTs return `TypeError: fetch failed` often enough to make a per-
  // iteration spawn unworkable), and tearing the subprocess down between
  // sessions is exactly the wrong shape for the SDK anyway — opencode is
  // a long-lived server with many short-lived sessions.
  private opencode?: { url: string; close: () => void };
  private mcp?: { url: string; close: () => Promise<void> };
  private client?: ReturnType<
    Awaited<ReturnType<typeof loadOpencodeSdk>>['createOpencodeClient']
  >;
  // Active per-run hooks the long-lived MCP server forwards into.
  private currentHooks?: RunHooks;
  private resolvedWorkspaceDir?: string;

  constructor(config: OpencodeAgentConfig, promptLoader?: PromptLoader) {
    this.config = config;
    this.promptLoader = promptLoader ?? new FilePromptLoader();
  }

  /**
   * Tear down the long-lived opencode subprocess + MCP server. The
   * orchestrator calls this in its outer `finally` after all issue
   * iterations are done.
   */
  async close(): Promise<void> {
    let opencode = this.opencode;
    let mcp = this.mcp;
    this.opencode = undefined;
    this.mcp = undefined;
    this.client = undefined;
    this.currentHooks = undefined;

    if (opencode) {
      // Parse the actual port from the SDK-returned URL rather than
      // assuming the SDK's default — `port: 0` would give us a random
      // port and a hardcoded 4096 would then SIGKILL whatever
      // unrelated process happens to be there. Falls back to no
      // escalation when parsing fails.
      let port = parseOpencodePort(opencode.url);
      try {
        opencode.close();
      } catch {
        // best-effort
      }
      // `opencode.close()` only sends SIGTERM, which the 1.14.34
      // binary ignores. waitForPortFree escalates to SIGKILL on the
      // process listening on this specific port.
      if (port !== undefined) {
        await waitForPortFree(port, 1000);
      }
    }
    if (mcp) {
      await mcp.close().catch(() => undefined);
    }
  }

  /**
   * Spin up the long-lived MCP server + opencode subprocess on first
   * use. The MCP server's tool-call / signal callbacks dispatch into
   * `currentHooks`, which `run()` swaps in / out around each session.
   */
  private async ensureStarted(mcpTools: FactoryTool[]): Promise<void> {
    if (this.opencode) return;

    this.mcp = await startFactoryMcpServer(mcpTools, {
      onToolCall: (entry) => this.currentHooks?.onToolCall(entry),
      onSignal: (signal) => this.currentHooks?.onSignal(signal),
    });

    let providerConfig: OpencodeConfig['provider'];
    if (this.config.openRouterApiKey) {
      providerConfig = buildProviderConfig(
        this.config.model,
        'https://openrouter.ai/api/v1',
        `Bearer ${this.config.openRouterApiKey}`,
        'OpenRouter (direct)',
      );
    } else {
      // Passthrough: realm-server validates the server JWT, applies
      // the server-side OpenRouter key, forwards verbatim, and bills
      // credits to the operator. The 7-day JWT TTL outlasts any single
      // factory:go run.
      let serverToken = await this.config.client.getServerToken();
      providerConfig = buildProviderConfig(
        this.config.model,
        new URL('_openrouter', this.config.realmServerUrl).toString(),
        serverToken,
        'OpenRouter (boxel passthrough)',
      );
    }

    let { createOpencodeServer, createOpencodeClient } =
      await loadOpencodeSdk();
    let resolvedDir = realpathSync(this.config.workspaceDir);
    // CRITICAL: opencode's `createOpencodeServer` spawns the subprocess
    // without a `cwd` option — it inherits the parent's cwd. The model
    // then resolves relative paths from its native fs tools (`Read`,
    // `Write`, `Edit`, …) against that inherited cwd. Without this
    // chdir the model would write files into the directory `factory:go`
    // was invoked from instead of the realm workspace, and we'd see
    // "Read /Users/.../packages/software-factory/Projects/foo.json"
    // (which doesn't exist) rather than the workspace path.
    let originalCwd = process.cwd();
    process.chdir(resolvedDir);
    try {
      this.opencode = await createOpencodeServer({
        config: {
          provider: providerConfig,
          mcp: {
            [MCP_SERVER_NAME]: {
              type: 'remote',
              url: this.mcp.url,
              enabled: true,
            },
          },
          permission: {
            edit: 'allow',
            // Opencode's bash permission accepts either a single mode
            // or a per-pattern map. We allow Bash unconditionally; the
            // model is told (via the prompt) to use it for read-only
            // inspection only. The `external_directory` knob is what
            // structurally prevents write escape.
            bash: 'allow',
            external_directory: 'deny',
          },
        },
      });
    } finally {
      process.chdir(originalCwd);
    }
    this.client = createOpencodeClient({ baseUrl: this.opencode.url });
    // Reuse the same canonical path for `session.list` / `session.status`
    // queries. opencode normalizes `directory` through its own realpath
    // (`/var/folders/...` → `/private/var/folders/...` on macOS), and
    // its filter is an exact-string match.
    this.resolvedWorkspaceDir = resolvedDir;

    if (this.config.debug) {
      log.info(
        `Agent backend: opencode (model=${this.config.model}, mode=${this.config.openRouterApiKey ? 'direct' : 'passthrough'})`,
      );
    }
    // Always print the opencode subprocess URL + log directory: when
    // `session.prompt rejected` warnings fire, the next thing the
    // operator wants is `tail -f ~/.local/share/opencode/log/<latest>`
    // to see what the subprocess was doing at the moment of failure.
    let opencodeLogDir = `${process.env.HOME ?? '~'}/.local/share/opencode/log`;
    log.info(
      `opencode subprocess at ${this.opencode!.url} | logs: ${opencodeLogDir} (newest = active)`,
    );
  }

  async run(
    context: AgentContext,
    tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    let mcpTools = tools.filter((t) => FACTORY_MCP_TOOL_NAMES.has(t.name));
    await this.ensureStarted(mcpTools);
    let client = this.client!;
    let workspaceDir = this.resolvedWorkspaceDir!;

    let toolCallLog: ToolCallEntry[] = [];
    let captured: CapturedSignal | undefined;
    let sessionErrorMessage: string | undefined;
    let resolveSignal: () => void;
    let signalCaptured = new Promise<void>((resolve) => {
      resolveSignal = resolve;
    });
    let resolveSessionError: () => void;
    let sessionErrored = new Promise<void>((resolve) => {
      resolveSessionError = resolve;
    });

    this.currentHooks = {
      onToolCall: (entry) => {
        toolCallLog.push(entry);
        log.info(
          `factory tool: ${entry.tool}(${summarizeArgs(entry.args)}) [${entry.durationMs}ms]`,
        );
      },
      onSignal: (signal) => {
        captured = signal;
        resolveSignal();
      },
    };

    try {
      let session = await client.session.create({
        query: { directory: workspaceDir },
      });
      let sessionId = (session.data as { id: string }).id;
      log.info(`session: ${sessionId}`);

      // Subscribe to opencode's per-directory event bus. Drives both
      // visibility (tool calls + step transitions logged) and error
      // propagation: a `session.error` (e.g. 401 from the model API)
      // resolves `sessionErrored`, which short-circuits the run below
      // and returns `blocked` instead of letting the loop spin.
      let stopEventLog = subscribeForLogging(client, sessionId, (message) => {
        sessionErrorMessage = message;
        resolveSessionError();
      }).catch(() => undefined);

      let prompt = this.buildPrompt(context);
      let systemPrompt = this.buildSystemPrompt(context);

      // The SDK's `session.prompt` HTTP call is *supposed* to block
      // until the model + tool loop completes, but in opencode
      // 1.14.34 the response often isn't flushed once the loop exits
      // — leaving the promise hanging long after the server-side
      // session is idle. The other obvious completion signals
      // (`client.event.subscribe` SSE stream and
      // `client.session.status` map) both turned out empty / racy in
      // this version too. Watching `session.list[id].time.updated`
      // through a stability window is the only signal that's both
      // present and reliable here. The prompt's return value is
      // unused — DONE / CLARIFICATION signals come back through the
      // MCP server, not the prompt.
      let promptPromise = client.session
        .prompt({
          path: { id: sessionId },
          body: {
            model: {
              providerID: FACTORY_PROVIDER_ID,
              modelID: this.config.model,
            },
            system: systemPrompt,
            // Trim opencode's default tool catalog to only what the
            // factory actually uses. Every tool definition costs
            // tokens on every chat completion — disabling the ones
            // we never need (webfetch, task, todowrite, skill,
            // question, invalid) cuts thousands of tokens out of
            // each request and keeps the model focused.
            tools: ENABLED_OPENCODE_TOOLS,
            parts: [{ type: 'text', text: prompt }],
          },
        })
        .catch(async (err) => {
          let liveness = await probeOpencode(this.opencode?.url);
          log.warn(
            `session.prompt rejected (session=${sessionId} url=${this.opencode?.url ?? '?'}): ${describeFetchError(err)} | opencode probe: ${liveness}`,
          );
        });

      try {
        // Happy path: the model calls `signal_done` (or
        // `request_clarification`), MCP captures it, and we return
        // instantly. Error path: a `session.error` event (model API
        // 401, etc.) short-circuits and we return `blocked`. Fallback
        // for when the model exits the loop silently: poll
        // `time.updated` for a stability window so we still return
        // rather than hang on the dead `prompt` HTTP promise.
        await Promise.race([
          signalCaptured,
          sessionErrored,
          waitForSessionIdle(client, sessionId, workspaceDir),
        ]);
      } finally {
        // Best-effort drain so sockets close cleanly when they can,
        // bounded so we never block on the documented opencode 1.14.34
        // bug where `session.prompt` returns but never flushes the HTTP
        // response. If the race above won via `waitForSessionIdle`,
        // both `promptPromise` and `stopEventLog` are likely stuck on
        // exactly that — letting them go after a short window is the
        // whole point of having a fallback signal in the first place.
        await Promise.race([promptPromise, delay(POST_RACE_DRAIN_MS)]);
        await Promise.race([stopEventLog, delay(POST_RACE_DRAIN_MS)]);
      }
    } finally {
      this.currentHooks = undefined;
    }

    if (captured?.kind === 'done') {
      return { status: 'done', toolCalls: toolCallLog };
    }
    if (captured?.kind === 'clarification') {
      return {
        status: 'blocked',
        toolCalls: toolCallLog,
        message: captured.message ?? '',
      };
    }
    if (sessionErrorMessage) {
      return {
        status: 'blocked',
        toolCalls: toolCallLog,
        message: `opencode session error: ${sessionErrorMessage}`,
      };
    }
    return {
      status: toolCallLog.length > 0 ? 'done' : 'needs_iteration',
      toolCalls: toolCallLog,
    };
  }

  private buildSystemPrompt(context: AgentContext): string {
    let skills = context.skills.map((s: ResolvedSkill) => ({
      name: s.name,
      content: s.content,
      references: s.references ?? [],
    }));
    return this.promptLoader.load('system', {
      targetRealm: context.targetRealm,
      catalogRealm: deriveCatalogRealmUrl(context.targetRealm),
      darkfactoryModuleUrl: requireDarkfactoryModuleUrl(context),
      enableBoxelUiDiscovery: context.enableBoxelUiDiscovery === true,
      skills,
    });
  }

  private buildPrompt(context: AgentContext): string {
    let issueType = (context.issue as Record<string, unknown>).issueType;
    if (issueType === 'bootstrap' && context.briefUrl) {
      return assembleBootstrapPrompt({ context, loader: this.promptLoader });
    }
    if (context.validationContext) {
      return assembleIteratePrompt({
        context,
        previousActions: [],
        iteration: context.iteration ?? 1,
        loader: this.promptLoader,
      });
    }
    return assembleImplementPrompt({ context, loader: this.promptLoader });
  }
}

/**
 * Build an opencode provider config for the OpenAI-compatible adapter.
 *
 * Used in two modes: direct (baseURL → openrouter.ai, auth → user's
 * bearer) and passthrough (baseURL → realm-server `/_openrouter`,
 * auth → server JWT). AI-SDK appends `/chat/completions` to baseURL.
 */
function buildProviderConfig(
  model: string,
  baseURL: string,
  authorization: string,
  displayName: string,
): OpencodeConfig['provider'] {
  return {
    [FACTORY_PROVIDER_ID]: {
      npm: '@ai-sdk/openai-compatible',
      name: displayName,
      options: { baseURL },
      models: {
        [model]: {
          name: model,
          tool_call: true,
          headers: { Authorization: authorization },
        },
      },
    },
  };
}

/**
 * Spin up a localhost HTTP MCP server exposing the 8 factory tools
 * (`get_card_schema`, 5 validators, 2 control signals) so opencode
 * can call them.
 *
 * Tool calls are forwarded to the supplied `FactoryTool.execute()`,
 * results are JSON-serialized back. DONE / CLARIFICATION signals
 * (which carry `Symbol`s that don't survive JSON-RPC) are tagged
 * with the static `factory:done` / `factory:clarification` strings;
 * the agent's signal-capture hook matches on the tag.
 */
async function startFactoryMcpServer(
  tools: FactoryTool[],
  hooks: {
    onToolCall: (entry: ToolCallEntry) => void;
    onSignal: (signal: CapturedSignal) => void;
  },
): Promise<{ url: string; close: () => Promise<void> }> {
  let byName = new Map(tools.map((t) => [t.name, t]));

  let server = new McpServer(
    { name: 'factory', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.parameters ?? {
        type: 'object',
        properties: {},
      }) as { type: 'object'; properties?: Record<string, unknown> },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    let { name, arguments: args } = request.params;
    let tool = byName.get(name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      };
    }
    let typedArgs = (args ?? {}) as Record<string, unknown>;
    let start = Date.now();
    let result: unknown;
    try {
      result = await tool.execute(typedArgs);
    } catch (error) {
      result = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
    let durationMs = Date.now() - start;
    hooks.onToolCall({ tool: name, args: typedArgs, result, durationMs });

    if (result && typeof result === 'object' && 'signal' in result) {
      let sig = (result as Record<string, unknown>).signal;
      if (sig === DONE_SIGNAL) {
        hooks.onSignal({ kind: 'done' });
      } else if (sig === CLARIFICATION_SIGNAL) {
        let message = String((result as Record<string, unknown>).message ?? '');
        hooks.onSignal({ kind: 'clarification', message });
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(serializeSignalResult(result)),
        },
      ],
    };
  });

  let transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);

  let httpServer = createHttpServer(async (req, res) => {
    let chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', async () => {
      let bodyText = Buffer.concat(chunks).toString('utf8');
      let body: unknown = undefined;
      if (bodyText.length > 0) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = undefined;
        }
      }
      try {
        await transport.handleRequest(
          req as Parameters<typeof transport.handleRequest>[0],
          res,
          body,
        );
      } catch (err) {
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.end(
            `mcp: handler error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  let port = (httpServer.address() as AddressInfo).port;
  let url = `http://127.0.0.1:${port}/`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      }),
  };
}

/** Stringify the symbol-bearing factory signals so they survive JSON-RPC. */
function serializeSignalResult(result: unknown): unknown {
  if (result && typeof result === 'object' && 'signal' in result) {
    let r = result as Record<string, unknown>;
    let signal = r.signal;
    let tag =
      signal === DONE_SIGNAL
        ? SIGNAL_DONE_TAG
        : signal === CLARIFICATION_SIGNAL
          ? SIGNAL_CLARIFICATION_TAG
          : String(signal);
    return { ...r, signal: tag };
  }
  return result;
}

/**
 * Watch `session.time.updated` via `client.session.list` until it stops
 * advancing for `STABILITY_WINDOW_MS` — opencode bumps it on every step
 * transition, so a few seconds of no change reliably means the model +
 * tool loop has gone idle. The `directory` query must match the
 * canonical realpath opencode normalized at create time (`/var →
 * /private/var` on macOS), already resolved by the caller.
 */
async function waitForSessionIdle(
  client: { session: { list: (opts?: any) => Promise<unknown> } },
  sessionId: string,
  workspaceDir: string,
): Promise<void> {
  const POLL_INTERVAL_MS = 750;
  // Generous: `time.updated` appears to tick on step boundaries rather
  // than per `message.part.delta`, and opus can sit 30+ seconds
  // "thinking" between steps. The polling is only a fallback for when
  // the model exits without calling `signal_done` / `request_clarification`,
  // so the wider window costs nothing on the happy path (signal-captured
  // race short-circuits this).
  const STABILITY_WINDOW_MS = 60_000;
  const MAX_WAIT_MS = 30 * 60 * 1000; // 30 minutes; comfortable upper bound for opus
  // After this many consecutive `session.list` failures, give up — the
  // opencode subprocess has almost certainly died (TypeError: fetch
  // failed). We return cleanly so the outer factory loop can continue
  // to the next iteration instead of crashing the whole run.
  const MAX_CONSECUTIVE_LIST_FAILURES = 5;
  // Periodic heartbeat so users running `factory:go` see proof the
  // model is making progress (or stuck) instead of staring at a
  // silent terminal for minutes.
  const HEARTBEAT_MS = 15_000;
  let started = Date.now();
  let lastUpdated: number | undefined;
  let stableSince: number | undefined;
  let consecutiveFailures = 0;
  let lastHeartbeat = Date.now();
  let lastHeartbeatUpdated: number | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error(
        `Timed out after ${MAX_WAIT_MS}ms waiting for opencode session ${sessionId} to settle.`,
      );
    }

    let res:
      | { data?: Array<{ id: string; time: { updated: number } }> }
      | undefined;
    try {
      res = (await client.session.list({
        query: { directory: workspaceDir },
      })) as {
        data?: Array<{ id: string; time: { updated: number } }>;
      };
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_LIST_FAILURES) {
        log.warn(
          `opencode session.list failed ${consecutiveFailures}× in a row (${describeFetchError(err)}); treating session as ended`,
        );
        return;
      }
    }

    if (res) {
      let session = res.data?.find((s) => s.id === sessionId);
      if (session) {
        let updated = session.time.updated;
        if (lastUpdated === undefined || updated !== lastUpdated) {
          lastUpdated = updated;
          stableSince = Date.now();
        } else if (
          stableSince !== undefined &&
          Date.now() - stableSince >= STABILITY_WINDOW_MS
        ) {
          return;
        }
      }
    }

    let now = Date.now();
    if (now - lastHeartbeat >= HEARTBEAT_MS) {
      let elapsedSec = Math.round((now - started) / 1000);
      let activity =
        lastUpdated === lastHeartbeatUpdated
          ? `idle ${Math.round((now - (stableSince ?? now)) / 1000)}s`
          : 'active';
      log.info(
        `waiting on opencode session [${elapsedSec}s elapsed, ${activity}]`,
      );
      lastHeartbeat = now;
      lastHeartbeatUpdated = lastUpdated;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Subscribe to opencode's `/event` SSE stream and log step transitions
 * + native tool invocations + session.idle for our session. Best-effort
 * — completion detection still uses `time.updated` polling, this is
 * purely for visibility into what the model is doing during long opus
 * runs.
 */
async function subscribeForLogging(
  client: { event: { subscribe: () => Promise<unknown> } },
  sessionId: string,
  onError?: (message: string) => void,
): Promise<void> {
  let events: { stream: AsyncIterable<unknown> };
  try {
    events = (await client.event.subscribe()) as {
      stream: AsyncIterable<unknown>;
    };
  } catch {
    return;
  }
  try {
    for await (let raw of events.stream) {
      let event = raw as {
        type?: string;
        properties?: Record<string, unknown>;
      };
      let props = event.properties ?? {};
      if (props.sessionID && props.sessionID !== sessionId) continue;
      switch (event.type) {
        case 'session.idle':
          log.info(`opencode session.idle`);
          return;
        case 'session.error': {
          let summary = summarizeSessionError(props.error);
          log.warn(`opencode session.error: ${summary}`);
          onError?.(summary);
          return;
        }
        case 'message.part.updated': {
          let part = props.part as
            | { type?: string; tool?: string; state?: { status?: string } }
            | undefined;
          if (
            part?.type === 'tool' &&
            part.tool &&
            part.state?.status === 'completed'
          ) {
            log.info(`opencode tool: ${part.tool}`);
          }
          break;
        }
        default:
          // ignore other events
          break;
      }
    }
  } catch {
    // SSE stream torn down — that's fine, the logging task is done.
  }
}

/**
 * opencode's `session.error` event carries an APIError payload with a
 * useful message + status code buried under nested `data` fields and a
 * lot of CDN noise. Pull out just the parts a human needs to diagnose.
 */
function summarizeSessionError(error: unknown): string {
  if (!error || typeof error !== 'object') return JSON.stringify(error);
  let e = error as Record<string, unknown>;
  let name = (e.name as string | undefined) ?? 'Error';
  let data = (e.data as Record<string, unknown> | undefined) ?? {};
  let message = (data.message as string | undefined) ?? 'unknown';
  let statusCode = data.statusCode as number | undefined;
  let url = (data.metadata as { url?: string } | undefined)?.url;
  let parts = [`${name}: ${message}`];
  if (statusCode !== undefined) parts.push(`status=${statusCode}`);
  if (url) parts.push(`url=${url}`);
  // The HTTP statusText (`message`) is usually generic ("Forbidden
  // Request"). The actual reason ("Insufficient credits", model-not-
  // available, upstream auth failure, ...) lives in the response body.
  // Surface it when it's small enough to be useful in a single-line log.
  let body = extractBodySummary(data.responseBody);
  if (body) parts.push(`body=${body}`);
  return parts.join(' ');
}

function extractBodySummary(rawBody: unknown): string | undefined {
  if (typeof rawBody !== 'string' || rawBody.length === 0) return undefined;
  try {
    let parsed = JSON.parse(rawBody);
    // Common shapes we want to surface:
    //   { errors: [string, ...] }  ← realm-server JSON:API error envelope
    //   { error: { message: string } } ← OpenRouter / OpenAI-style
    //   { error: string }          ← simpler form
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { errors?: unknown[] }).errors) &&
      (parsed as { errors: unknown[] }).errors.length > 0
    ) {
      let first = (parsed as { errors: unknown[] }).errors[0];
      return typeof first === 'string' ? first : JSON.stringify(first);
    }
    let err = (parsed as { error?: unknown }).error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      let msg = (err as { message?: unknown }).message;
      if (typeof msg === 'string') return msg;
      return JSON.stringify(err);
    }
  } catch {
    // Non-JSON body — fall through to raw truncation.
  }
  // Truncate raw body so a giant HTML error page doesn't drown the log.
  return rawBody.length > 200 ? rawBody.slice(0, 197) + '...' : rawBody;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeArgs(args: Record<string, unknown>): string {
  let entries = Object.entries(args).map(([k, v]) => {
    let s = typeof v === 'string' ? v : JSON.stringify(v);
    if (typeof s === 'string' && s.length > 60) s = s.slice(0, 57) + '...';
    return `${k}=${s}`;
  });
  return entries.join(', ');
}

/**
 * Extract the listening TCP port from the URL the opencode SDK
 * returns from `createOpencodeServer({ ... })`. Returns undefined for
 * malformed URLs or non-numeric ports so the caller can skip the
 * SIGKILL escalation safely (better than killing port 4096 blindly
 * when the SDK changed defaults or we passed `port: 0`).
 */
function parseOpencodePort(url: string): number | undefined {
  try {
    let port = Number.parseInt(new URL(url).port, 10);
    return Number.isFinite(port) ? port : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Block until a TCP port is free on localhost. Tries graceful drain
 * first, then escalates to SIGKILL on whoever is listening — opencode
 * 1.14.34 ignores the SIGTERM the SDK sends from `close()` (it spawns
 * a precompiled binary that doesn't honour the signal), so without
 * this the next iteration's `createOpencodeServer` always hits
 * EADDRINUSE.
 */
async function waitForPortFree(port: number, graceMs: number): Promise<void> {
  let graceDeadline = Date.now() + graceMs;
  while (Date.now() < graceDeadline) {
    if (await isPortFree(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Still held after the grace window — escalate to SIGKILL on
  // whoever is listening. Best-effort: if `lsof` isn't available or
  // finds nothing, leave the next iteration to throw a clearer
  // EADDRINUSE rather than silently fail here.
  let { execSync } = await import('node:child_process');
  try {
    let pids = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (let pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
        log.warn(
          `forced SIGKILL on stale opencode pid=${pid} holding port ${port}`,
        );
      } catch {
        // process already gone
      }
    }
  } catch {
    // lsof not on PATH or no listener — fall through to the post-kill
    // wait, which will return immediately if the port is free.
  }
  let killDeadline = Date.now() + 2000;
  while (Date.now() < killDeadline) {
    if (await isPortFree(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let probe = createHttpServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * Render an Error in a way that surfaces the underlying cause.
 *
 * Node's undici `fetch` wraps every network failure in
 * `TypeError: fetch failed` and stashes the real reason — `ECONNREFUSED`,
 * `ECONNRESET`, `UND_ERR_HEADERS_TIMEOUT`, `AbortError`, etc. — on
 * `err.cause`. The default `String(err)` throws all of that away. Use
 * this helper anywhere we log a fetch rejection so we can actually tell
 * what happened (subprocess died vs. socket timeout vs. user abort).
 */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  let parts = [err.message];
  let cause: unknown = (err as { cause?: unknown }).cause;
  let depth = 0;
  while (cause && depth < 4) {
    if (cause instanceof Error) {
      let causeCode =
        (cause as { code?: string }).code ??
        (cause as { name?: string }).name ??
        'Error';
      parts.push(`cause: ${causeCode}: ${cause.message}`);
      cause = (cause as { cause?: unknown }).cause;
    } else {
      parts.push(`cause: ${String(cause)}`);
      break;
    }
    depth++;
  }
  return parts.join(' / ');
}

/**
 * Best-effort liveness probe for the opencode subprocess. Hits
 * `${url}/app` (a cheap built-in endpoint) with a short timeout and
 * reports either "alive (status N)", "dead (cause)", or "unknown" if
 * the URL can't even be parsed.
 *
 * Logged alongside every `session.prompt` / `session.list` rejection so
 * we can immediately distinguish "subprocess crashed" from "transient
 * socket hiccup".
 */
async function probeOpencode(url: string | undefined): Promise<string> {
  if (!url) return 'unknown (no url)';
  let controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), 1500);
  try {
    let res = await fetch(`${url.replace(/\/+$/, '')}/app`, {
      signal: controller.signal,
    });
    return `alive (HTTP ${res.status})`;
  } catch (err) {
    return `dead (${describeFetchError(err)})`;
  } finally {
    clearTimeout(timer);
  }
}
