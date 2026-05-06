/**
 * OpencodeFactoryAgent — LoopAgent backed by the opencode SDK.
 *
 * Replaces `OpenRouterFactoryAgent`'s direct-HTTP-to-OpenRouter loop
 * with an opencode-driven session so `--agent openrouter` runs benefit
 * from the same native fs / Bash / Glob / Grep tools the Claude path
 * already uses. The five MCP wrappers that exist purely for the
 * fs-less OpenRouter path (`read_file` / `write_file` / `search_realm`
 * / `fetch_transpiled_module` / `run_command`) get retired in the
 * same change.
 *
 * Architecture
 * ============
 *
 * Every `run()` does:
 *
 *   1. **Resolve auth.** Two modes:
 *      - **Direct API key** — `openRouterApiKey` is set (CLI flag or
 *        env). Configure opencode with a custom OpenAI-compatible
 *        provider whose baseURL is OpenRouter and Authorization is
 *        the user's bearer.
 *      - **Passthrough** — no key. Point opencode's provider straight
 *        at the realm server's `_openrouter/chat/completions`
 *        endpoint and stamp a freshly-fetched server JWT into the
 *        provider's static `Authorization` header. The realm server
 *        validates the JWT, looks up the OpenRouter API key
 *        server-side, forwards verbatim, and bills credits to the
 *        operator's boxel account — same model the previous
 *        `_request-forward`-based relay used, just without the
 *        in-process HTTP hop. The JWT is fetched once per `run()` and
 *        not refreshed mid-session, but the realm-server JWT lives
 *        for 7 days so a single ticket run is in no danger of
 *        outlasting it.
 *
 *   2. **Build MCP server for factory tools.** Spin up an in-process
 *      HTTP MCP server (`@modelcontextprotocol/sdk` Streamable HTTP
 *      transport) that exposes the surviving 7 factory tools (5
 *      validators + `signal_done` + `request_clarification`). opencode
 *      connects via `McpRemoteConfig`.
 *
 *   3. **Spawn opencode subprocess.** `createOpencodeServer({
 *      config })` starts the binary on a random local port and
 *      returns `{ url, close }`. `config.permission
 *      .external_directory: 'deny'` plus the workspace `cwd` give us
 *      built-in path scoping — replaces the
 *      `buildWorkspaceScopedCanUseTool` callback the Claude path
 *      uses.
 *
 *   4. **Drive a session.** `client.session.create` then `client
 *      .session.prompt` with the assembled prompt. We consume the
 *      `client.event` SSE stream to log tool calls and capture the
 *      DONE / CLARIFICATION signals the factory tools emit. (Symbols
 *      don't survive JSON-RPC, so the MCP server tags them
 *      `"factory:done"` / `"factory:clarification"` and we match on
 *      the tag.)
 *
 *   5. **Tear down.** Close opencode, stop the MCP HTTP server.
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
 * The 7 factory tools we still expose to the agent over MCP. Native
 * fs / Bash / Glob / Grep are owned by opencode; the 5 OpenRouter-only
 * fs wrappers are retired alongside this agent.
 */
const FACTORY_MCP_TOOL_NAMES = new Set([
  'run_tests',
  'run_lint',
  'run_evaluate',
  'run_parse',
  'run_instantiate',
  'signal_done',
  'request_clarification',
]);

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

export class OpencodeFactoryAgent implements LoopAgent {
  private config: OpencodeAgentConfig;
  private promptLoader: PromptLoader;

  constructor(config: OpencodeAgentConfig, promptLoader?: PromptLoader) {
    this.config = config;
    this.promptLoader = promptLoader ?? new FilePromptLoader();
  }

  async run(
    context: AgentContext,
    tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    let mcpTools = tools.filter((t) => FACTORY_MCP_TOOL_NAMES.has(t.name));
    let toolCallLog: ToolCallEntry[] = [];
    let captured: CapturedSignal | undefined;
    let resolveSignal: () => void;
    let signalCaptured = new Promise<void>((resolve) => {
      resolveSignal = resolve;
    });

    let mcp = await startFactoryMcpServer(mcpTools, {
      onToolCall: (entry) => toolCallLog.push(entry),
      onSignal: (signal) => {
        captured = signal;
        resolveSignal();
      },
    });

    let providerConfig: OpencodeConfig['provider'];
    if (this.config.openRouterApiKey) {
      providerConfig = buildDirectProviderConfig(
        this.config.model,
        this.config.openRouterApiKey,
      );
    } else {
      // Passthrough mode: fetch a server JWT once and stamp it into
      // the provider's static headers. The realm server's
      // `/_openrouter/chat/completions` endpoint validates the JWT,
      // applies the server-side OpenRouter key, and bills credits to
      // this user.
      let serverToken = await this.config.client.getServerToken();
      providerConfig = buildPassthroughProviderConfig(
        this.config.model,
        this.config.realmServerUrl,
        serverToken,
      );
    }

    let { createOpencodeServer, createOpencodeClient } =
      await loadOpencodeSdk();
    let opencode = await createOpencodeServer({
      config: {
        provider: providerConfig,
        mcp: {
          [MCP_SERVER_NAME]: {
            type: 'remote',
            url: mcp.url,
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
    let client = createOpencodeClient({ baseUrl: opencode.url });

    if (this.config.debug) {
      log.info(
        `Agent backend: opencode (model=${this.config.model}, mode=${this.config.openRouterApiKey ? 'direct' : 'passthrough'})`,
      );
    }

    try {
      // Resolve the workspace to its canonical real path. opencode
      // normalizes the directory query through its own realpath
      // before storing the session (e.g. `/var/folders/...` →
      // `/private/var/folders/...` on macOS). If we don't pre-
      // resolve, the directory we pass to `session.status` later
      // won't string-match the one opencode recorded at create
      // time, so the status map comes back empty.
      let workspaceDir = realpathSync(this.config.workspaceDir);
      let session = await client.session.create({
        query: { directory: workspaceDir },
      });
      let sessionId = (session.data as { id: string }).id;

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
      let promptBody = {
        path: { id: sessionId },
        body: {
          model: {
            providerID: FACTORY_PROVIDER_ID,
            modelID: this.config.model,
          },
          system: systemPrompt,
          parts: [{ type: 'text', text: prompt } as const],
        },
      };
      let promptPromise = (async () => {
        try {
          return await client.session.prompt(promptBody);
        } catch (err) {
          // opencode 1.14.34 occasionally fails the very first
          // `/session/{id}/message` POST on a freshly-spawned subprocess
          // with `TypeError: fetch failed`. A short delay + one retry
          // hides the flake.
          log.warn(
            `session.prompt rejected (${String(err)}), retrying once...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          try {
            return await client.session.prompt(promptBody);
          } catch (err2) {
            log.warn(`session.prompt rejected on retry: ${String(err2)}`);
            return undefined;
          }
        }
      })();

      try {
        // Happy path: the model calls `signal_done` (or
        // `request_clarification`), MCP captures it, and we return
        // instantly. Fallback for when the model exits the loop
        // without signaling: poll `time.updated` for a stability
        // window so we still return rather than hang on the dead
        // `prompt` HTTP promise.
        await Promise.race([
          signalCaptured,
          waitForSessionIdle(client, sessionId, workspaceDir),
        ]);
      } finally {
        // Best-effort: drain any pending prompt resolution before
        // teardown so its socket gets closed cleanly.
        await promptPromise;
      }
    } finally {
      try {
        opencode.close();
      } catch {
        // best-effort
      }
      // `opencode.close()` only sends SIGTERM and the binary in 1.14.34
      // ignores it. Wait briefly for graceful exit, then escalate to
      // SIGKILL if the port is still held — otherwise the next
      // iteration's `createOpencodeServer` always hits EADDRINUSE.
      await waitForPortFree(4096, 1000);
      await mcp.close().catch(() => undefined);
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
      targetRealmUrl: context.targetRealmUrl,
      darkfactoryModuleUrl: requireDarkfactoryModuleUrl(context),
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
 * Build the opencode provider config for direct-API-key mode.
 *
 * Routes the model call straight to OpenRouter using
 * `@ai-sdk/openai-compatible` so we don't need a custom provider
 * package. Authorization is baked into the static `headers` object on
 * the model entry, which is fine for long-lived bearer tokens.
 */
function buildDirectProviderConfig(
  model: string,
  apiKey: string,
): OpencodeConfig['provider'] {
  return {
    [FACTORY_PROVIDER_ID]: {
      npm: '@ai-sdk/openai-compatible',
      name: 'OpenRouter (direct)',
      options: {
        baseURL: 'https://openrouter.ai/api/v1',
      },
      models: {
        [model]: {
          name: model,
          tool_call: true,
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      },
    },
  };
}

/**
 * Build the opencode provider config for passthrough mode.
 *
 * Points opencode at the realm server's
 * `/_openrouter/chat/completions` endpoint and stamps a server JWT
 * into the provider's static `Authorization` header. AI-SDK's
 * OpenAI-compatible provider appends `/chat/completions` to whatever
 * `baseURL` we hand it, so we set `baseURL` to `<realmServerUrl>/_openrouter`.
 *
 * The realm server validates the JWT (via `jwtMiddleware`), applies
 * the server-side OpenRouter API key, forwards verbatim, and bills
 * the operator's credits — same auth + billing model as the previous
 * relay-based proxy mode, just without the in-process HTTP hop.
 */
function buildPassthroughProviderConfig(
  model: string,
  realmServerUrl: string,
  serverToken: string,
): OpencodeConfig['provider'] {
  let baseURL = new URL('_openrouter', realmServerUrl).toString();
  return {
    [FACTORY_PROVIDER_ID]: {
      npm: '@ai-sdk/openai-compatible',
      name: 'OpenRouter (boxel passthrough)',
      options: {
        baseURL,
      },
      models: {
        [model]: {
          name: model,
          tool_call: true,
          headers: {
            Authorization: serverToken,
          },
        },
      },
    },
  };
}

/**
 * Spin up a localhost HTTP MCP server exposing the 7 factory tools
 * (5 validators + 2 control signals) so opencode can call them.
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
 * Poll `client.session.list` and watch `session.time.updated` until it
 * stops advancing for `STABILITY_WINDOW_MS`. opencode bumps
 * `time.updated` on every `message.part.delta` (and every step
 * transition), so a few seconds of no change reliably means the model
 * + tool loop has gone idle.
 *
 * This is the third workaround attempt for unreliable opencode 1.14.34
 * completion signals, following the dead `await session.prompt` HTTP
 * response and the empty `/session/status` map (which appears to be
 * unused / always `{}` in this version regardless of canonical
 * directory). The `directory` query has to match the canonical realpath
 * opencode normalized at create time (`/var → /private/var` on macOS),
 * which the caller has already resolved.
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
  let started = Date.now();
  let lastUpdated: number | undefined;
  let stableSince: number | undefined;
  let consecutiveFailures = 0;

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
          `opencode session.list failed ${consecutiveFailures}× in a row (${String(err)}); treating session as ended`,
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

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
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
