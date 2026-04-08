/**
 * Mock agent implementations for testing.
 *
 * These are deterministic agents that return pre-scripted responses,
 * used by unit tests and smoke tests to verify orchestration logic
 * without calling a real LLM.
 */

import type {
  AgentAction,
  AgentContext,
  FactoryAgent,
} from './factory-agent-types';
import type { LoopAgent, AgentRunResult } from './factory-loop';
import type { FactoryTool } from './factory-tool-builder';

// ---------------------------------------------------------------------------
// MockFactoryAgent — deterministic FactoryAgent for declarative model tests
// ---------------------------------------------------------------------------

export class MockFactoryAgent implements FactoryAgent {
  private responses: AgentAction[][];
  private callIndex = 0;

  /** All AgentContext inputs received, in order. */
  readonly receivedContexts: AgentContext[] = [];

  constructor(responses: AgentAction[][]) {
    this.responses = responses;
  }

  async plan(context: AgentContext): Promise<AgentAction[]> {
    this.receivedContexts.push(context);

    if (this.callIndex >= this.responses.length) {
      throw new Error(
        `MockFactoryAgent exhausted: called ${this.callIndex + 1} times ` +
          `but only ${this.responses.length} response(s) were configured`,
      );
    }

    let response = this.responses[this.callIndex];
    this.callIndex++;
    return response;
  }

  /** Number of times plan() has been called. */
  get callCount(): number {
    return this.callIndex;
  }
}

// ---------------------------------------------------------------------------
// MockLoopAgent — deterministic LoopAgent for tool-use model tests
// ---------------------------------------------------------------------------

export class MockLoopAgent implements LoopAgent {
  private responses: AgentRunResult[];
  private callIndex = 0;

  /** All inputs received, in order. */
  readonly receivedContexts: AgentContext[] = [];
  readonly receivedTools: FactoryTool[][] = [];

  constructor(responses: AgentRunResult[]) {
    this.responses = responses;
  }

  async run(
    context: AgentContext,
    tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    this.receivedContexts.push(context);
    this.receivedTools.push(tools);

    if (this.callIndex >= this.responses.length) {
      throw new Error(
        `MockLoopAgent exhausted: called ${this.callIndex + 1} times ` +
          `but only ${this.responses.length} response(s) were configured`,
      );
    }

    let response = this.responses[this.callIndex];
    this.callIndex++;
    return response;
  }

  get callCount(): number {
    return this.callIndex;
  }
}
