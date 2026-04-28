/**
 * Barrel re-exports for the factory agent system.
 *
 * One file per backend, each implementing the `LoopAgent` interface in
 * `./types.ts`:
 *   - `./openrouter.ts` — OpenRouter (OpenAI-compat tool-use protocol)
 *   - `./claude-code.ts` — Claude Code Agent SDK (in-process MCP)
 *
 * `createLoopAgent()` in `../factory-issue-loop-wiring.ts` picks which to
 * instantiate based on the `--agent` flag.
 */

export * from './types';
export { OpenRouterFactoryAgent } from './openrouter';
export { ClaudeCodeFactoryAgent } from './claude-code';
export { MockFactoryAgent, MockLoopAgent } from './mocks';
