/**
 * Barrel re-exports for the factory agent system.
 *
 * One file per backend, each implementing the `LoopAgent` interface in
 * `./types.ts`:
 *   - `./opencode.ts` — opencode SDK driving an OpenRouter (or proxy)
 *     model. Backs the `--agent openrouter` CLI flag.
 *   - `./claude-code.ts` — Claude Code Agent SDK (in-process MCP).
 *     Backs the `--agent claude` CLI flag.
 *
 * `createLoopAgent()` in `../factory-issue-loop-wiring.ts` picks which to
 * instantiate based on the `--agent` flag.
 */

export * from './types.ts';
export { OpencodeFactoryAgent } from './opencode.ts';
export type { OpencodeAgentConfig } from './opencode.ts';
export { ClaudeCodeFactoryAgent } from './claude-code.ts';
export { MockLoopAgent } from './mocks.ts';
