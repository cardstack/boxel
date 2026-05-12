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

export * from './types';
export { OpencodeFactoryAgent } from './opencode';
export type { OpencodeAgentConfig } from './opencode';
export { ClaudeCodeFactoryAgent } from './claude-code';
export { MockLoopAgent } from './mocks';
