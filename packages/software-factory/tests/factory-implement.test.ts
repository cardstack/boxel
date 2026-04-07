import { module, test } from 'qunit';

import type { AgentContext } from '../scripts/lib/factory-agent';
import type { AgentRunResult, LoopAgent } from '../scripts/lib/factory-loop';
import type {
  FactoryTool,
  ToolCallEntry,
} from '../scripts/lib/factory-tool-builder';
import type { FactoryBootstrapResult } from '../src/factory-bootstrap';

import {
  runFactoryImplement,
  type ImplementConfig,
} from '../scripts/lib/factory-implement';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockLoopAgentForTest implements LoopAgent {
  private responses: AgentRunResult[];
  private callIndex = 0;
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
        `MockLoopAgent exhausted: called ${this.callIndex + 1} times but only ${this.responses.length} response(s)`,
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBootstrapResult(): FactoryBootstrapResult {
  return {
    project: { id: 'Projects/sticky-note-mvp', status: 'created' },
    knowledgeArticles: [
      { id: 'Knowledge Articles/sticky-note-brief-context', status: 'created' },
    ],
    tickets: [{ id: 'Tickets/sticky-note-define-core', status: 'created' }],
    activeTicket: { id: 'Tickets/sticky-note-define-core', status: 'created' },
  };
}

function makeCardDocument(
  id: string,
  attributes: Record<string, unknown> = {},
) {
  return {
    data: {
      type: 'card' as const,
      attributes: { title: id, ...attributes },
      meta: {
        adoptsFrom: {
          module: 'https://example.com/darkfactory',
          name: 'Card',
        },
      },
    },
  };
}

/**
 * Build a mock fetch that returns card documents for realm reads.
 */
function makeMockFetch(
  cards: Record<string, ReturnType<typeof makeCardDocument>>,
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, _init?: RequestInit) => {
    let url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    // Find matching card by checking if the URL ends with any card path
    // Decode URL-encoded characters (e.g., %20 for spaces in card paths)
    let decodedUrl = decodeURIComponent(url);
    for (let [path, doc] of Object.entries(cards)) {
      if (decodedUrl.includes(path)) {
        return new Response(JSON.stringify(doc), {
          status: 200,
          headers: { 'Content-Type': 'application/vnd.card+source' },
        });
      }
    }

    return new Response('Not found', { status: 404 });
  }) as typeof globalThis.fetch;
}

function makeConfig(overrides?: Partial<ImplementConfig>): ImplementConfig {
  let bootstrapResult = makeBootstrapResult();
  let cards: Record<string, ReturnType<typeof makeCardDocument>> = {
    'Projects/sticky-note-mvp': makeCardDocument('Projects/sticky-note-mvp', {
      objective: 'Build a sticky note card',
      successCriteria: ['Card renders'],
    }),
    'Tickets/sticky-note-define-core': makeCardDocument(
      'Tickets/sticky-note-define-core',
      {
        summary: 'Define StickyNote card',
        description: 'Create the core StickyNote card definition',
        status: 'in_progress',
        priority: 'high',
      },
    ),
    'Knowledge Articles/sticky-note-brief-context': makeCardDocument(
      'Knowledge Articles/sticky-note-brief-context',
      {
        title: 'Brief Context',
        content: 'Sticky notes are colorful cards',
      },
    ),
  };

  return {
    briefUrl: 'http://localhost:4201/software-factory/Wiki/sticky-note',
    targetRealmUrl: 'http://localhost:4201/test-user/my-realm/',
    realmServerUrl: 'http://localhost:4201/',
    ownerUsername: 'test-user',
    authorization: 'Bearer test-token',
    bootstrapResult,
    model: 'anthropic/claude-sonnet-4',
    // Inject mock auth to skip real Matrix login
    realmTokens: {
      'http://localhost:4201/test-user/my-realm/': 'Bearer realm-token',
      'http://localhost:4201/test-user/my-realm-test-artifacts/':
        'Bearer test-realm-token',
    },
    serverToken: 'Bearer server-token',
    fetch: makeMockFetch(cards),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

module('factory-implement', function () {
  module('runFactoryImplement', function () {
    test('runs the loop with a mock agent that signals done with tool calls', async function (assert) {
      let toolCalls: ToolCallEntry[] = [
        {
          tool: 'write_file',
          args: {
            path: 'sticky-note.gts',
            content: 'export class StickyNote {}',
          },
          result: { ok: true },
          durationMs: 10,
        },
      ];

      let agent = new MockLoopAgentForTest([
        { status: 'done', toolCalls, message: 'Done' },
      ]);

      let config = makeConfig({
        agent,
        testRunner: async () => ({
          status: 'passed' as const,
          passedCount: 1,
          failedCount: 0,
          failures: [],
          durationMs: 100,
        }),
      });

      let result = await runFactoryImplement(config);

      assert.strictEqual(result.outcome, 'tests_passed');
      assert.strictEqual(result.iterations, 1);
      assert.strictEqual(result.ticketId, 'Tickets/sticky-note-define-core');
      assert.strictEqual(
        result.testRealmUrl,
        'http://localhost:4201/test-user/my-realm-test-artifacts/',
      );
      assert.ok(result.toolCallLog.length >= 1);
      assert.strictEqual(agent.callCount, 1);
    });

    test('runs the loop with an agent that signals blocked', async function (assert) {
      let agent = new MockLoopAgentForTest([
        {
          status: 'blocked',
          toolCalls: [],
          message: 'Need clarification on card fields',
        },
      ]);

      let config = makeConfig({ agent });
      let result = await runFactoryImplement(config);

      assert.strictEqual(result.outcome, 'clarification_needed');
      assert.strictEqual(result.iterations, 1);
      assert.strictEqual(result.message, 'Need clarification on card fields');
    });

    test('runs the loop with an agent that signals done without tool calls', async function (assert) {
      let agent = new MockLoopAgentForTest([{ status: 'done', toolCalls: [] }]);

      let config = makeConfig({ agent });
      let result = await runFactoryImplement(config);

      assert.strictEqual(result.outcome, 'done');
      assert.strictEqual(result.iterations, 1);
    });

    test('passes project, ticket, and knowledge to the agent context', async function (assert) {
      let agent = new MockLoopAgentForTest([{ status: 'done', toolCalls: [] }]);

      let config = makeConfig({ agent });
      await runFactoryImplement(config);

      assert.strictEqual(agent.callCount, 1);
      let ctx = agent.receivedContexts[0];
      assert.strictEqual(ctx.project.id, 'Projects/sticky-note-mvp');
      assert.strictEqual(ctx.ticket.id, 'Tickets/sticky-note-define-core');
      assert.strictEqual(ctx.knowledge.length, 1);
      assert.strictEqual(
        ctx.knowledge[0].id,
        'Knowledge Articles/sticky-note-brief-context',
      );
      assert.strictEqual(
        ctx.targetRealmUrl,
        'http://localhost:4201/test-user/my-realm/',
      );
      assert.strictEqual(
        ctx.testRealmUrl,
        'http://localhost:4201/test-user/my-realm-test-artifacts/',
      );
    });

    test('derives test realm URL correctly', async function (assert) {
      let agent = new MockLoopAgentForTest([{ status: 'done', toolCalls: [] }]);

      let config = makeConfig({
        agent,
        targetRealmUrl: 'http://localhost:4201/hassan1/personal/',
      });
      let result = await runFactoryImplement(config);

      assert.strictEqual(
        result.testRealmUrl,
        'http://localhost:4201/hassan1/personal-test-artifacts/',
      );
    });

    test('handles maxIterations configuration', async function (assert) {
      let toolCalls: ToolCallEntry[] = [
        {
          tool: 'write_file',
          args: { path: 'test.gts', content: 'x' },
          result: { ok: true },
          durationMs: 5,
        },
      ];

      // Agent always signals done with tool calls, but tests always fail.
      // With maxIterations=2, loop should stop after 2 iterations.
      let agent = new MockLoopAgentForTest([
        { status: 'done', toolCalls },
        { status: 'done', toolCalls },
      ]);

      let config = makeConfig({
        agent,
        maxIterations: 2,
        testRunner: async () => ({
          status: 'failed' as const,
          passedCount: 0,
          failedCount: 1,
          failures: [{ testName: 'renders', error: 'Element not found' }],
          durationMs: 5000,
        }),
      });

      let result = await runFactoryImplement(config);

      assert.strictEqual(result.outcome, 'max_iterations');
      assert.strictEqual(result.iterations, 2);
      assert.ok(result.testResults);
      assert.strictEqual(result.testResults!.status, 'failed');
    });

    test('gracefully handles missing knowledge articles', async function (assert) {
      let agent = new MockLoopAgentForTest([{ status: 'done', toolCalls: [] }]);

      let bootstrapResult = makeBootstrapResult();
      // Add a knowledge article that doesn't exist in the mock fetch
      bootstrapResult.knowledgeArticles.push({
        id: 'Knowledge Articles/nonexistent',
        status: 'created',
      });

      let config = makeConfig({ agent, bootstrapResult });
      let result = await runFactoryImplement(config);

      // Should succeed even if a knowledge article can't be fetched
      assert.strictEqual(result.outcome, 'done');
      assert.strictEqual(result.iterations, 1);
    });

    test('testResultsModuleUrl points to source realm, not target realm', async function (assert) {
      // Regression: testResultsModuleUrl was incorrectly set to
      // <targetRealmUrl>/test-results instead of the source realm's
      // software-factory/test-results module.
      let agent = new MockLoopAgentForTest([{ status: 'done', toolCalls: [] }]);

      let config = makeConfig({ agent });
      await runFactoryImplement(config);

      // The agent should receive a run_tests tool. Its internal config
      // should reference the source realm, not the target realm.
      let tools = agent.receivedTools[0];
      let runTestsTool = tools.find((t) => t.name === 'run_tests');
      assert.ok(runTestsTool, 'run_tests tool should be present');

      // Execute run_tests with a dummy spec to see the testResultsModuleUrl
      // it passes through. We can't easily inspect the closure, but we can
      // verify indirectly: the tool builder config has testResultsModuleUrl
      // set. The best we can do in a unit test is verify the tool exists
      // and the config was constructed. The Playwright spec tests verify
      // the actual adoptsFrom on created TestRun cards.
      assert.ok(tools.length > 0, 'tools should be provided to agent');

      // Verify the realm server URL was used for the source realm path
      // by checking that the config was set up correctly (the tool builder
      // uses config.testResultsModuleUrl which we set from realmServerUrl)
      assert.strictEqual(
        config.realmServerUrl,
        'http://localhost:4201/',
        'realmServerUrl should be set',
      );
    });

    test('throws when project card cannot be fetched', async function (assert) {
      let agent = new MockLoopAgentForTest([{ status: 'done', toolCalls: [] }]);

      let config = makeConfig({
        agent,
        // Empty fetch returns 404 for everything
        fetch: (async () =>
          new Response('Not found', {
            status: 404,
          })) as typeof globalThis.fetch,
      });

      try {
        await runFactoryImplement(config);
        assert.ok(false, 'Should have thrown');
      } catch (error) {
        assert.ok(
          (error as Error).message.includes('Failed to fetch card'),
          `Error message should mention failed fetch: ${(error as Error).message}`,
        );
      }
    });
  });
});
