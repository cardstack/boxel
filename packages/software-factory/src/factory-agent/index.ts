/**
 * Barrel re-exports for the factory agent system.
 *
 * One file per backend, each implementing the `LoopAgent` interface in
 * `./types.ts`:
 *   - `./openrouter.ts` — OpenRouter (OpenAI-compat tool-use protocol)
 *   - `./claude-code.ts` — Claude Code Agent SDK (in-process MCP)
 *   - (future) `./codex-cli.ts` — Codex CLI, tracked in CS-10594
 *
 * `createLoopAgent()` in `../factory-issue-loop-wiring.ts` picks which to
 * instantiate based on the `--agent` flag.
 */

// ---------------------------------------------------------------------------
// Re-exports — existing `import from '../factory-agent'` continues to work
// by resolving to this index.
// ---------------------------------------------------------------------------

export * from './types';
export { OpenRouterFactoryAgent } from './openrouter';
export { ClaudeCodeFactoryAgent } from './claude-code';
export { MockFactoryAgent, MockLoopAgent } from './mocks';
