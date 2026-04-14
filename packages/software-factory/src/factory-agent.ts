/**
 * Barrel re-exports for the factory agent system.
 *
 * Re-exports all types from factory-agent-types.ts and the tool-use agent
 * from factory-agent-tool-use.ts so that existing imports continue to work.
 */

// ---------------------------------------------------------------------------
// Re-exports — keep existing import paths working
// ---------------------------------------------------------------------------

export * from './factory-agent-types';
export { ToolUseFactoryAgent } from './factory-agent-tool-use';
export { MockFactoryAgent, MockLoopAgent } from './factory-agent-mocks';
