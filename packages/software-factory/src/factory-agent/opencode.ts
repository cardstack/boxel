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
 *      - **Proxy** — no key. Spin up a tiny localhost HTTP server
 *        that translates OpenAI-style requests into the realm
 *        server's `_request-forward` shape (`{ url, method,
 *        requestBody }`), forwards via JWT-authed `BoxelCLIClient
 *        .authedServerFetch`, and returns the response. Configure
 *        opencode's provider to point at the relay's local URL.
 *        Burns the operator's boxel tokens — same as the prior
 *        `OpenRouterFactoryAgent` proxy mode.
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
 *   5. **Tear down.** Close opencode, stop the relay server (if any),
 *      stop the MCP HTTP server.
 */

import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

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
import { OPENROUTER_CHAT_URL } from './types';
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
  /** Realm server URL — used by the proxy-mode relay to reach `_request-forward`. */
  realmServerUrl: string;
  /** Boxel CLI client used by the proxy-mode relay for JWT-authed forward calls. */
  client: import('@cardstack/boxel-cli/api').BoxelCLIClient;
  /**
   * If set, opencode talks to OpenRouter directly with this key in
   * the Authorization header. If unset, the agent falls back to
   * proxy mode (boxel JWT → realm-server `_request-forward`).
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

    let mcp = await startFactoryMcpServer(mcpTools, {
      onToolCall: (entry) => toolCallLog.push(entry),
      onSignal: (signal) => {
        captured = signal;
      },
    });

    let relay: { url: string; close: () => Promise<void> } | undefined;
    let providerConfig: OpencodeConfig['provider'];
    if (this.config.openRouterApiKey) {
      providerConfig = buildDirectProviderConfig(
        this.config.model,
        this.config.openRouterApiKey,
      );
    } else {
      relay = await startProxyRelayServer(
        this.config.realmServerUrl,
        this.config.client,
      );
      providerConfig = buildRelayProviderConfig(this.config.model, relay.url);
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
        `Agent backend: opencode (model=${this.config.model}, mode=${this.config.openRouterApiKey ? 'direct' : 'proxy'})`,
      );
    }

    try {
      let session = await client.session.create({
        query: { directory: this.config.workspaceDir },
      });
      let sessionId = (session.data as { id: string }).id;

      let prompt = this.buildPrompt(context);
      let systemPrompt = this.buildSystemPrompt(context);

      // Submit the prompt. SDK's `session.prompt` blocks until the
      // model + tool loop completes (or aborts on signal).
      await client.session.prompt({
        path: { id: sessionId },
        body: {
          model: {
            providerID: FACTORY_PROVIDER_ID,
            modelID: this.config.model,
          },
          system: systemPrompt,
          parts: [{ type: 'text', text: prompt }],
        },
      });
    } finally {
      try {
        opencode.close();
      } catch {
        // best-effort
      }
      await mcp.close().catch(() => undefined);
      if (relay) {
        await relay.close().catch(() => undefined);
      }
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
 * Build the opencode provider config for proxy mode.
 *
 * Points opencode at the local relay server (started by
 * `startProxyRelayServer`) which re-shapes OpenAI-style requests into
 * the realm server's `_request-forward` proxy shape.
 */
function buildRelayProviderConfig(
  model: string,
  relayUrl: string,
): OpencodeConfig['provider'] {
  return {
    [FACTORY_PROVIDER_ID]: {
      npm: '@ai-sdk/openai-compatible',
      name: 'OpenRouter (boxel proxy)',
      options: {
        baseURL: relayUrl,
      },
      models: {
        [model]: {
          name: model,
          tool_call: true,
        },
      },
    },
  };
}

/**
 * Spin up a localhost HTTP relay server that translates OpenAI-style
 * `/chat/completions` requests into the boxel realm server's
 * `_request-forward` proxy shape, forwards them via the JWT-authed
 * `BoxelCLIClient.authedServerFetch`, and returns the response body
 * verbatim.
 *
 * The relay listens on `127.0.0.1:<random>` and shuts down when
 * `close()` resolves. opencode points its provider at the relay's
 * URL, so from the model's perspective it's just talking to a normal
 * OpenAI-compatible endpoint.
 */
async function startProxyRelayServer(
  realmServerUrl: string,
  client: import('@cardstack/boxel-cli/api').BoxelCLIClient,
): Promise<{ url: string; close: () => Promise<void> }> {
  let proxyUrl = new URL('_request-forward', realmServerUrl).toString();

  let server: HttpServer = createHttpServer((req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('relay: only POST is supported');
      return;
    }

    let chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', async () => {
      try {
        let body = Buffer.concat(chunks).toString('utf8');
        let response = await client.authedServerFetch(proxyUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: OPENROUTER_CHAT_URL,
            method: 'POST',
            requestBody: body,
          }),
        });
        let text = await response.text();
        res.statusCode = response.status;
        res.setHeader(
          'Content-Type',
          response.headers.get('Content-Type') ?? 'application/json',
        );
        res.end(text);
      } catch (err) {
        res.statusCode = 502;
        res.end(
          `relay: forward failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  let port = (server.address() as AddressInfo).port;
  let url = `http://127.0.0.1:${port}`;

  return {
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
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
