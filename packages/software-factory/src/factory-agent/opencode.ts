/**
 * OpencodeFactoryAgent — LoopAgent backed by the opencode SDK.
 *
 * **Status: skeleton / under construction (CS-11034).**
 *
 * Purpose: replace the direct-HTTP `OpenRouterFactoryAgent` so the
 * `--agent openrouter` path benefits from native fs / Bash / Glob / Grep
 * tools (the same set the Claude path already uses), unifying the two
 * backends on one tool surface and letting us delete the five
 * MCP wrappers (`read_file` / `write_file` / `search_realm` /
 * `fetch_transpiled_module` / `run_command`) that exist purely because
 * raw OpenRouter has no fs.
 *
 * Architecture (target — not all wired yet):
 *
 *   1. **Subprocess + local HTTP server.** The opencode SDK shells out
 *      to the `opencode` binary (installed via the `opencode-ai` npm
 *      dep, which auto-resolves the platform-specific binary). We call
 *      `createOpencodeServer({ config })`, which spawns the subprocess
 *      and waits for it to come up on a local HTTP port; the SDK then
 *      gives us an HTTP/SSE client.
 *
 *   2. **Provider config (auth modes).**
 *      - `openRouterApiKey` provided → configure opencode with a
 *        custom OpenAI-compatible provider whose `baseURL` points at
 *        OpenRouter and whose `Authorization: Bearer <key>` header is
 *        baked into the provider config. Direct user-pays mode.
 *      - No key provided → spin up a tiny in-process relay HTTP server
 *        that proxies OpenAI-style requests through the realm server's
 *        `_request-forward` endpoint with a boxel JWT. Configure
 *        opencode's provider to point at the relay's local URL. This
 *        mirrors the existing `OpenRouterFactoryAgent` proxy behavior
 *        — burn user's boxel tokens via the realm-server proxy.
 *
 *   3. **Path scoping.** Set opencode's `permission.external_directory:
 *      'deny'` and `cwd: workspaceDir`. opencode then refuses any
 *      Read/Write/Edit/Bash that would escape the workspace, replacing
 *      the `buildWorkspaceScopedCanUseTool` callback the Claude path
 *      uses. No plugin file required — it's a built-in permission
 *      knob.
 *
 *   4. **Factory tools (validators + signals) via MCP.** The Claude
 *      path exposes the 7 surviving factory tools (5 validators +
 *      `signal_done` + `request_clarification`) through an in-process
 *      MCP server (`createSdkMcpServer`). For opencode we spawn a small
 *      Node child process that runs an `@modelcontextprotocol/sdk`
 *      stdio MCP server over our `FactoryTool[]` and reference it as a
 *      `McpLocalConfig` in the opencode config.
 *
 *   5. **Run loop.** Create a session via `client.session.create`,
 *      submit the bootstrap/implement/iterate prompt via
 *      `client.session.prompt`, and consume `client.event` SSE to
 *      capture tool calls. When a tool result tagged `signal_done` /
 *      `signal_clarification` arrives, abort the session and return
 *      the matching AgentRunResult.
 *
 *   6. **Teardown.** Close the SDK server; the relay HTTP server (if
 *      any) is shut down via the same lifecycle.
 *
 * Pieces still to write before this is functional (tracked in
 * CS-11034):
 *   - The relay HTTP server for proxy mode.
 *   - The in-process / subprocess MCP server wrapper around
 *     `FactoryTool[]`.
 *   - Event-stream consumption + signal capture.
 *   - Wiring change in `factory-issue-loop-wiring.ts` to dispatch
 *     `--agent openrouter` here.
 *   - `--openrouter-api-key` CLI flag in `factory-entrypoint.ts`.
 *   - Deletion of `OpenRouterFactoryAgent`, the 5 OpenRouter-only
 *     tools, and the `CLAUDE_FILTERED_FACTORY_TOOLS` filter.
 *
 * Until those land this class is a typed stand-in so the design is
 * reviewable in isolation. `run()` throws so a misconfigured wiring
 * can't accidentally route to it.
 */

import type { LoopAgent, AgentRunResult, AgentContext } from './types';
import type { FactoryTool } from '../factory-tool-builder';
import { logger } from '../logger';

let log = logger('factory-agent-opencode');

/**
 * Configuration for the opencode-backed agent. Mirrors
 * `FactoryAgentConfig` so the wiring layer can swap between the two
 * with no per-field translation.
 */
export interface OpencodeAgentConfig {
  /** OpenRouter model ID (e.g., `anthropic/claude-opus-4-7`). */
  model: string;
  /** Realm server URL — used by the proxy-mode relay to reach `_request-forward`. */
  realmServerUrl: string;
  /** Boxel CLI client used by the proxy-mode relay for JWT-authed forward calls. */
  client: import('@cardstack/boxel-cli/api').BoxelCLIClient;
  /**
   * If set, opencode talks to OpenRouter directly with this key in the
   * Authorization header. If unset, the agent falls back to proxy mode
   * (boxel JWT → realm-server `_request-forward`).
   */
  openRouterApiKey?: string;
  /**
   * Local workspace directory mirroring the target realm. Used as the
   * opencode subprocess `cwd` so native fs tools resolve realm-relative
   * paths inside the workspace, plus combined with
   * `permission.external_directory: 'deny'` to scope writes.
   */
  workspaceDir?: string;
  /** When true, log opencode events to stderr. */
  debug?: boolean;
}

export class OpencodeFactoryAgent implements LoopAgent {
  // Stored for the future implementation; suppress unused-locals while
  // run() is still a stub.
  // @ts-expect-error config will be read once run() is implemented (CS-11034)
  private config: OpencodeAgentConfig;

  constructor(config: OpencodeAgentConfig) {
    this.config = config;
    log.warn(
      'OpencodeFactoryAgent is a skeleton (CS-11034). The full subprocess + ' +
        'SDK + relay implementation has not landed yet. Use --agent claude or ' +
        'leave the existing OpenRouterFactoryAgent in the wiring until this ' +
        'class is finished.',
    );
  }

  async run(
    _context: AgentContext,
    _tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    throw new Error(
      'OpencodeFactoryAgent.run() is not implemented yet (CS-11034). ' +
        'See the design notes at the top of opencode.ts. Until the full ' +
        'implementation lands, route --agent openrouter to ' +
        'OpenRouterFactoryAgent.',
    );
  }
}
