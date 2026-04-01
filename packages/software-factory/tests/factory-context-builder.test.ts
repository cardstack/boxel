import { module, test } from 'qunit';

import type {
  AgentAction,
  KnowledgeArticle,
  ProjectCard,
  ResolvedSkill,
  TestResult,
  TicketCard,
  ToolResult,
} from '../scripts/lib/factory-agent';

import {
  ContextBuilder,
  type ContextBuilderConfig,
} from '../scripts/lib/factory-context-builder';

import type {
  SkillLoaderInterface,
  SkillResolver,
} from '../scripts/lib/factory-skill-loader';

import {
  REALM_API_TOOLS,
  SCRIPT_TOOLS,
  ToolRegistry,
} from '../scripts/lib/factory-tool-registry';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class StubSkillResolver implements SkillResolver {
  /** Pre-configured skill names returned by resolve(). */
  skillNames: string[];
  /** Records all (ticket, project) pairs passed to resolve(). */
  calls: { ticket: TicketCard; project: ProjectCard }[] = [];

  constructor(skillNames: string[] = ['boxel-development']) {
    this.skillNames = skillNames;
  }

  resolve(ticket: TicketCard, project: ProjectCard): string[] {
    this.calls.push({ ticket, project });
    return this.skillNames;
  }
}

class StubSkillLoader implements SkillLoaderInterface {
  /** Map from skill name to the ResolvedSkill that load() returns. */
  private skillMap: Map<string, ResolvedSkill>;
  /** Records all loadAll() calls: [skillNames, ticket]. */
  loadAllCalls: { skillNames: string[]; ticket?: TicketCard }[] = [];

  constructor(skills: ResolvedSkill[] = []) {
    this.skillMap = new Map(skills.map((s) => [s.name, s]));
  }

  async load(skillName: string, _ticket?: TicketCard): Promise<ResolvedSkill> {
    let skill = this.skillMap.get(skillName);
    if (!skill) {
      throw new Error(`StubSkillLoader: unknown skill "${skillName}"`);
    }
    return skill;
  }

  async loadAll(
    skillNames: string[],
    ticket?: TicketCard,
  ): Promise<ResolvedSkill[]> {
    this.loadAllCalls.push({ skillNames, ticket });
    let results: ResolvedSkill[] = [];
    for (let name of skillNames) {
      let skill = this.skillMap.get(name);
      if (skill) {
        results.push(skill);
      }
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProject(overrides?: Partial<ProjectCard>): ProjectCard {
  return { id: 'project-1', name: 'Sticky Notes', ...overrides };
}

function makeTicket(overrides?: Partial<TicketCard>): TicketCard {
  return {
    id: 'ticket-1',
    title: 'Implement StickyNote card',
    description: 'Create a .gts card definition for StickyNote',
    ...overrides,
  };
}

function makeKnowledge(
  overrides?: Partial<KnowledgeArticle>,
): KnowledgeArticle {
  return { id: 'ka-1', title: 'Boxel Card Basics', ...overrides };
}

function makeSkill(name: string, content?: string): ResolvedSkill {
  return {
    name,
    content: content ?? `Skill content for ${name}`,
  };
}

function makeConfig(overrides?: Partial<ContextBuilderConfig>) {
  let resolver = new StubSkillResolver();
  let loader = new StubSkillLoader([
    makeSkill('boxel-development'),
    makeSkill('boxel-file-structure'),
    makeSkill('ember-best-practices'),
  ]);
  let toolRegistry = new ToolRegistry([...SCRIPT_TOOLS, ...REALM_API_TOOLS]);

  return {
    config: {
      skillResolver: resolver,
      skillLoader: loader,
      toolRegistry,
      ...overrides,
    } as ContextBuilderConfig,
    resolver,
    loader,
  };
}

// ---------------------------------------------------------------------------
// Tests: Skill resolution
// ---------------------------------------------------------------------------

module('factory-context-builder > skill resolution', function () {
  test('resolves skills from ticket and project', async function (assert) {
    let { config, resolver } = makeConfig();
    let builder = new ContextBuilder(config);
    let ticket = makeTicket();
    let project = makeProject();

    await builder.build({
      project,
      ticket,
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    assert.strictEqual(resolver.calls.length, 1, 'resolve() called once');
    assert.strictEqual(
      resolver.calls[0].ticket,
      ticket,
      'resolve() received the ticket',
    );
    assert.strictEqual(
      resolver.calls[0].project,
      project,
      'resolve() received the project',
    );
  });

  test('passes resolved skill names to loader', async function (assert) {
    let resolver = new StubSkillResolver([
      'boxel-development',
      'ember-best-practices',
    ]);
    let loader = new StubSkillLoader([
      makeSkill('boxel-development'),
      makeSkill('ember-best-practices'),
    ]);
    let { config } = makeConfig({
      skillResolver: resolver,
      skillLoader: loader,
    });
    let builder = new ContextBuilder(config);

    await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    assert.strictEqual(loader.loadAllCalls.length, 1, 'loadAll() called once');
    assert.deepEqual(
      loader.loadAllCalls[0].skillNames,
      ['boxel-development', 'ember-best-practices'],
      'loadAll() received the resolved skill names',
    );
  });

  test('passes ticket to loadAll for reference filtering', async function (assert) {
    let resolver = new StubSkillResolver(['boxel-development']);
    let loader = new StubSkillLoader([makeSkill('boxel-development')]);
    let { config } = makeConfig({
      skillResolver: resolver,
      skillLoader: loader,
    });
    let builder = new ContextBuilder(config);
    let ticket = makeTicket();

    await builder.build({
      project: makeProject(),
      ticket,
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    assert.strictEqual(
      loader.loadAllCalls[0].ticket,
      ticket,
      'loadAll() received the ticket for reference filtering',
    );
  });

  test('includes resolved skills in the context', async function (assert) {
    let resolver = new StubSkillResolver([
      'boxel-development',
      'ember-best-practices',
    ]);
    let loader = new StubSkillLoader([
      makeSkill('boxel-development', 'BD content'),
      makeSkill('ember-best-practices', 'EBP content'),
    ]);
    let { config } = makeConfig({
      skillResolver: resolver,
      skillLoader: loader,
    });
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    assert.strictEqual(ctx.skills.length, 2, 'two skills in context');
    assert.strictEqual(ctx.skills[0].name, 'boxel-development');
    assert.strictEqual(ctx.skills[1].name, 'ember-best-practices');
  });
});

// ---------------------------------------------------------------------------
// Tests: Skill budget enforcement
// ---------------------------------------------------------------------------

module('factory-context-builder > skill budget', function () {
  test('enforces skill budget when maxSkillTokens is set', async function (assert) {
    // Each skill content is short (~30 chars ÷ 4 ≈ 8 tokens).
    // A budget of 10 tokens should allow only one skill.
    let resolver = new StubSkillResolver([
      'boxel-development',
      'ember-best-practices',
    ]);
    let loader = new StubSkillLoader([
      makeSkill('boxel-development', 'A'.repeat(36)), // 9 tokens
      makeSkill('ember-best-practices', 'B'.repeat(36)), // 9 tokens
    ]);
    let { config } = makeConfig({
      skillResolver: resolver,
      skillLoader: loader,
      maxSkillTokens: 10,
    });
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    assert.strictEqual(ctx.skills.length, 1, 'budget trimmed to one skill');
    assert.strictEqual(
      ctx.skills[0].name,
      'boxel-development',
      'higher-priority skill kept',
    );
  });

  test('does not enforce budget when maxSkillTokens is undefined', async function (assert) {
    let resolver = new StubSkillResolver([
      'boxel-development',
      'ember-best-practices',
    ]);
    let loader = new StubSkillLoader([
      makeSkill('boxel-development', 'A'.repeat(1000)),
      makeSkill('ember-best-practices', 'B'.repeat(1000)),
    ]);
    let { config } = makeConfig({
      skillResolver: resolver,
      skillLoader: loader,
    });
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    assert.strictEqual(ctx.skills.length, 2, 'all skills included');
  });
});

// ---------------------------------------------------------------------------
// Tests: Tool manifest inclusion
// ---------------------------------------------------------------------------

module('factory-context-builder > tool manifests', function () {
  test('includes script and realm-api tools', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    let expectedCount = SCRIPT_TOOLS.length + REALM_API_TOOLS.length;
    assert.strictEqual(
      ctx.tools.length,
      expectedCount,
      `context has ${expectedCount} tools (script + realm-api)`,
    );
  });

  test('does not include boxel-cli tools', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    let boxelCliTools = ctx.tools.filter((t) => t.category === 'boxel-cli');
    assert.strictEqual(
      boxelCliTools.length,
      0,
      'no boxel-cli tools in context',
    );
  });

  test('all tools have script or realm-api category', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    for (let tool of ctx.tools) {
      let isAllowed =
        tool.category === 'script' || tool.category === 'realm-api';
      assert.true(
        isAllowed,
        `tool "${tool.name}" has allowed category "${tool.category}"`,
      );
    }
  });

  test('includes expected script tools by name', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    let toolNames = ctx.tools.map((t) => t.name);
    assert.true(toolNames.includes('search-realm'), 'has search-realm');
    assert.true(toolNames.includes('pick-ticket'), 'has pick-ticket');
    assert.true(toolNames.includes('realm-read'), 'has realm-read');
    assert.true(toolNames.includes('realm-write'), 'has realm-write');
  });
});

// ---------------------------------------------------------------------------
// Tests: Iteration state threading
// ---------------------------------------------------------------------------

module('factory-context-builder > iteration state', function () {
  test('context has no iteration fields on first pass', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    assert.strictEqual(ctx.testResults, undefined, 'no testResults');
    assert.strictEqual(ctx.toolResults, undefined, 'no toolResults');
    assert.strictEqual(ctx.previousActions, undefined, 'no previousActions');
    assert.strictEqual(ctx.iteration, undefined, 'no iteration');
  });

  test('threads testResults from iteration state', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);
    let testResults: TestResult = {
      status: 'failed',
      passedCount: 2,
      failedCount: 1,
      failures: [
        {
          testName: 'renders card',
          error: 'Expected element to exist',
        },
      ],
      durationMs: 5000,
    };

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
      iterationState: { testResults },
    });

    assert.deepEqual(ctx.testResults, testResults, 'testResults threaded');
  });

  test('threads toolResults from iteration state', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);
    let toolResults: ToolResult[] = [
      {
        tool: 'search-realm',
        exitCode: 0,
        output: { cards: [] },
        durationMs: 200,
      },
    ];

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
      iterationState: { toolResults },
    });

    assert.deepEqual(ctx.toolResults, toolResults, 'toolResults threaded');
  });

  test('threads previousActions from iteration state', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);
    let previousActions: AgentAction[] = [
      {
        type: 'create_file',
        path: 'sticky-note.gts',
        content: 'export class...',
        realm: 'target',
      },
    ];

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
      iterationState: { previousActions },
    });

    assert.deepEqual(
      ctx.previousActions,
      previousActions,
      'previousActions threaded',
    );
  });

  test('threads iteration number from iteration state', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
      iterationState: { iteration: 3 },
    });

    assert.strictEqual(ctx.iteration, 3, 'iteration number threaded');
  });

  test('threads all iteration fields together', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let testResults: TestResult = {
      status: 'failed',
      passedCount: 1,
      failedCount: 1,
      failures: [{ testName: 'test-1', error: 'fail' }],
      durationMs: 3000,
    };
    let toolResults: ToolResult[] = [
      { tool: 'realm-read', exitCode: 0, output: {}, durationMs: 100 },
    ];
    let previousActions: AgentAction[] = [
      {
        type: 'create_file',
        path: 'card.gts',
        content: '...',
        realm: 'target',
      },
      {
        type: 'create_test',
        path: 'Tests/card.spec.ts',
        content: '...',
        realm: 'target',
      },
    ];

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
      iterationState: {
        testResults,
        toolResults,
        previousActions,
        iteration: 2,
      },
    });

    assert.deepEqual(ctx.testResults, testResults);
    assert.deepEqual(ctx.toolResults, toolResults);
    assert.deepEqual(ctx.previousActions, previousActions);
    assert.strictEqual(ctx.iteration, 2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Core context fields
// ---------------------------------------------------------------------------

module('factory-context-builder > core fields', function () {
  test('includes project, ticket, and knowledge in context', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);
    let project = makeProject();
    let ticket = makeTicket();
    let knowledge = [makeKnowledge(), makeKnowledge({ id: 'ka-2' })];

    let ctx = await builder.build({
      project,
      ticket,
      knowledge,
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    assert.strictEqual(ctx.project, project, 'project passed through');
    assert.strictEqual(ctx.ticket, ticket, 'ticket passed through');
    assert.strictEqual(ctx.knowledge, knowledge, 'knowledge passed through');
  });

  test('includes realm URLs in context', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/my-realm/',
      testRealmUrl: 'https://example.test/my-realm-test-artifacts/',
    });

    assert.strictEqual(ctx.targetRealmUrl, 'https://example.test/my-realm/');
    assert.strictEqual(
      ctx.testRealmUrl,
      'https://example.test/my-realm-test-artifacts/',
    );
  });

  test('handles empty knowledge array', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      ticket: makeTicket(),
      knowledge: [],
      targetRealmUrl: 'https://example.test/target/',
      testRealmUrl: 'https://example.test/target-test-artifacts/',
    });

    assert.deepEqual(ctx.knowledge, [], 'empty knowledge is fine');
  });
});
