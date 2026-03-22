import { module, test } from 'qunit';

import {
  assembleImplementPrompt,
  assembleIteratePrompt,
  assembleSystemPrompt,
  assembleTestPrompt,
  buildOneShotMessages,
  FilePromptLoader,
  interpolate,
  PromptTemplateNotFoundError,
} from '../scripts/lib/factory-prompt-loader';

import type { AgentAction, AgentContext } from '../scripts/lib/factory-agent';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMinimalContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    project: { id: 'Project/test-project' },
    ticket: { id: 'Ticket/test-ticket' },
    knowledge: [],
    skills: [],
    tools: [],
    targetRealmUrl: 'https://realms.example.test/user/target/',
    testRealmUrl: 'https://realms.example.test/user/target-tests/',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// interpolate — simple variables
// ---------------------------------------------------------------------------

module('factory-prompt-loader > interpolate > simple variables', function () {
  test('replaces a simple variable', function (assert) {
    let result = interpolate('Hello {{name}}!', { name: 'World' });
    assert.strictEqual(result, 'Hello World!');
  });

  test('replaces dot-path variables', function (assert) {
    let result = interpolate('ID: {{ticket.id}}', {
      ticket: { id: 'Ticket/123' },
    });
    assert.strictEqual(result, 'ID: Ticket/123');
  });

  test('replaces deeply nested dot paths', function (assert) {
    let result = interpolate('{{a.b.c}}', { a: { b: { c: 'deep' } } });
    assert.strictEqual(result, 'deep');
  });

  test('replaces undefined variables with empty string', function (assert) {
    let result = interpolate('Hello {{missing}}!', {});
    assert.strictEqual(result, 'Hello !');
  });

  test('replaces null variables with empty string', function (assert) {
    let result = interpolate('Hello {{name}}!', { name: null });
    assert.strictEqual(result, 'Hello !');
  });

  test('replaces multiple variables', function (assert) {
    let result = interpolate('{{a}} and {{b}}', { a: 'foo', b: 'bar' });
    assert.strictEqual(result, 'foo and bar');
  });

  test('handles numbers', function (assert) {
    let result = interpolate('Count: {{count}}', { count: 42 });
    assert.strictEqual(result, 'Count: 42');
  });

  test('handles booleans', function (assert) {
    let result = interpolate('Active: {{active}}', { active: true });
    assert.strictEqual(result, 'Active: true');
  });

  test('serializes objects as JSON', function (assert) {
    let result = interpolate('Data: {{data}}', { data: { key: 'val' } });
    assert.strictEqual(result, 'Data: {"key":"val"}');
  });
});

// ---------------------------------------------------------------------------
// interpolate — {{#each}} blocks
// ---------------------------------------------------------------------------

module('factory-prompt-loader > interpolate > #each blocks', function () {
  test('iterates over an array of objects', function (assert) {
    let template = '{{#each items}}- {{name}}\n{{/each}}';
    let result = interpolate(template, {
      items: [{ name: 'alpha' }, { name: 'beta' }],
    });
    assert.strictEqual(result, '- alpha\n- beta');
  });

  test('iterates over a string array with {{.}}', function (assert) {
    let template = '{{#each items}}- {{.}}\n{{/each}}';
    let result = interpolate(template, {
      items: ['one', 'two', 'three'],
    });
    assert.strictEqual(result, '- one\n- two\n- three');
  });

  test('produces empty output for empty array', function (assert) {
    let template = 'Before\n{{#each items}}- {{name}}\n{{/each}}After';
    let result = interpolate(template, { items: [] });
    assert.strictEqual(result, 'Before\nAfter');
  });

  test('produces empty output for undefined array', function (assert) {
    let template = 'Before\n{{#each items}}- {{name}}\n{{/each}}After';
    let result = interpolate(template, {});
    assert.strictEqual(result, 'Before\nAfter');
  });

  test('handles nested #each blocks', function (assert) {
    let template =
      '{{#each skills}}Skill: {{name}}\n{{#each references}}- {{.}}\n{{/each}}{{/each}}';
    let result = interpolate(template, {
      skills: [
        { name: 'boxel-dev', references: ['ref1', 'ref2'] },
        { name: 'testing', references: ['ref3'] },
      ],
    });
    assert.ok(result.includes('Skill: boxel-dev'));
    assert.ok(result.includes('- ref1'));
    assert.ok(result.includes('- ref2'));
    assert.ok(result.includes('Skill: testing'));
    assert.ok(result.includes('- ref3'));
  });
});

// ---------------------------------------------------------------------------
// interpolate — {{#if}} blocks
// ---------------------------------------------------------------------------

module('factory-prompt-loader > interpolate > #if blocks', function () {
  test('includes block when value is truthy', function (assert) {
    let template = '{{#if show}}visible{{/if}}';
    let result = interpolate(template, { show: true });
    assert.strictEqual(result, 'visible');
  });

  test('excludes block when value is falsy', function (assert) {
    let template = '{{#if show}}visible{{/if}}';
    let result = interpolate(template, { show: false });
    assert.strictEqual(result, '');
  });

  test('excludes block when value is undefined', function (assert) {
    let template = '{{#if show}}visible{{/if}}';
    let result = interpolate(template, {});
    assert.strictEqual(result, '');
  });

  test('excludes block when value is empty string', function (assert) {
    let template = '{{#if show}}visible{{/if}}';
    let result = interpolate(template, { show: '' });
    assert.strictEqual(result, '');
  });

  test('excludes block when value is empty array', function (assert) {
    let template = '{{#if items}}has items{{/if}}';
    let result = interpolate(template, { items: [] });
    assert.strictEqual(result, '');
  });

  test('includes block when array is non-empty', function (assert) {
    let template = '{{#if items}}has items{{/if}}';
    let result = interpolate(template, { items: ['a'] });
    assert.strictEqual(result, 'has items');
  });

  test('supports dot-path conditions', function (assert) {
    let template = '{{#if ticket.checklist}}has checklist{{/if}}';
    let result = interpolate(template, {
      ticket: { checklist: ['step 1'] },
    });
    assert.strictEqual(result, 'has checklist');
  });
});

// ---------------------------------------------------------------------------
// FilePromptLoader
// ---------------------------------------------------------------------------

module('factory-prompt-loader > FilePromptLoader', function () {
  test('loads and interpolates a template', function (assert) {
    let loader = new FilePromptLoader();
    let result = loader.load('action-schema', {});
    assert.ok(
      result.includes('create_file'),
      'action schema contains create_file',
    );
    assert.ok(result.includes('done'), 'action schema contains done');
  });

  test('caches templates on subsequent loads', function (assert) {
    let loader = new FilePromptLoader();
    let first = loader.load('action-schema', {});
    let second = loader.load('action-schema', {});
    assert.strictEqual(first, second, 'returns identical string from cache');
  });

  test('throws PromptTemplateNotFoundError for missing template', function (assert) {
    let loader = new FilePromptLoader();
    assert.throws(
      () => loader.load('nonexistent-template', {}),
      (err: Error) => err instanceof PromptTemplateNotFoundError,
      'throws PromptTemplateNotFoundError',
    );
  });

  test('clearCache allows reloading', function (assert) {
    let loader = new FilePromptLoader();
    let first = loader.load('action-schema', {});
    loader.clearCache();
    let second = loader.load('action-schema', {});
    assert.strictEqual(first, second, 'content is the same after cache clear');
  });
});

// ---------------------------------------------------------------------------
// assembleSystemPrompt
// ---------------------------------------------------------------------------

module('factory-prompt-loader > assembleSystemPrompt', function () {
  test('includes role and output format', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext();
    let result = assembleSystemPrompt({ context: ctx, loader });

    assert.ok(
      result.includes('software factory agent'),
      'includes role description',
    );
    assert.ok(
      result.includes('JSON array'),
      'includes output format instruction',
    );
  });

  test('includes realm URLs', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext();
    let result = assembleSystemPrompt({ context: ctx, loader });

    assert.ok(
      result.includes('https://realms.example.test/user/target/'),
      'includes target realm URL',
    );
    assert.ok(
      result.includes('https://realms.example.test/user/target-tests/'),
      'includes test realm URL',
    );
  });

  test('includes action schema', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext();
    let result = assembleSystemPrompt({ context: ctx, loader });

    assert.ok(
      result.includes('create_file'),
      'action schema is interpolated into system prompt',
    );
    assert.ok(result.includes('invoke_tool'), 'includes invoke_tool action');
  });

  test('includes skills when present', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      skills: [
        {
          name: 'boxel-development',
          content: 'Use Boxel patterns for card definitions.',
          references: ['ref-guide.md'],
        },
      ],
    });
    let result = assembleSystemPrompt({ context: ctx, loader });

    assert.ok(result.includes('boxel-development'), 'includes skill name');
    assert.ok(result.includes('Use Boxel patterns'), 'includes skill content');
    assert.ok(result.includes('ref-guide.md'), 'includes skill references');
  });

  test('includes tools when present', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      tools: [
        {
          name: 'search-realm',
          description: 'Search for cards in a realm',
          category: 'script',
          args: [
            {
              name: 'query',
              type: 'string',
              required: true,
              description: 'Search query',
            },
          ],
          outputFormat: 'json',
        },
      ],
    });
    let result = assembleSystemPrompt({ context: ctx, loader });

    assert.ok(result.includes('search-realm'), 'includes tool name');
    assert.ok(result.includes('Search for cards'), 'includes tool description');
    assert.ok(result.includes('query'), 'includes tool arg name');
    assert.ok(result.includes('required'), 'includes arg required status');
  });

  test('omits skills section when no skills', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({ skills: [] });
    let result = assembleSystemPrompt({ context: ctx, loader });

    assert.notOk(result.includes('# Skill:'), 'no skill section when empty');
  });

  test('omits tools section when no tools', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({ tools: [] });
    let result = assembleSystemPrompt({ context: ctx, loader });

    assert.notOk(result.includes('# Tool:'), 'no tool section when empty');
  });

  test('snapshot: system prompt with sample skills and tools', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      skills: [
        {
          name: 'boxel-development',
          content: 'Follow Boxel card patterns.',
        },
        {
          name: 'testing-guide',
          content: 'Write Playwright tests.',
          references: ['test-patterns.md'],
        },
      ],
      tools: [
        {
          name: 'search-realm',
          description: 'Search cards',
          category: 'script',
          args: [
            {
              name: 'query',
              type: 'string',
              required: true,
              description: 'Search query',
            },
          ],
          outputFormat: 'json',
        },
        {
          name: 'run-tests',
          description: 'Run Playwright tests',
          category: 'script',
          args: [],
          outputFormat: 'text',
        },
      ],
    });
    let result = assembleSystemPrompt({ context: ctx, loader });

    // Verify structural elements are present and correctly ordered
    let roleIdx = result.indexOf('# Role');
    let outputIdx = result.indexOf('# Output Format');
    let rulesIdx = result.indexOf('# Rules');
    let realmsIdx = result.indexOf('# Realms');
    let skill1Idx = result.indexOf('# Skill: boxel-development');
    let skill2Idx = result.indexOf('# Skill: testing-guide');
    let tool1Idx = result.indexOf('# Tool: search-realm');
    let tool2Idx = result.indexOf('# Tool: run-tests');

    assert.ok(roleIdx >= 0, 'has Role section');
    assert.ok(outputIdx > roleIdx, 'Output Format after Role');
    assert.ok(rulesIdx > outputIdx, 'Rules after Output Format');
    assert.ok(realmsIdx > rulesIdx, 'Realms after Rules');
    assert.ok(skill1Idx > realmsIdx, 'first skill after Realms');
    assert.ok(skill2Idx > skill1Idx, 'second skill after first');
    assert.ok(tool1Idx > skill2Idx, 'first tool after skills');
    assert.ok(tool2Idx > tool1Idx, 'second tool after first');

    // Verify content of skill references
    assert.ok(
      result.includes('test-patterns.md'),
      'skill reference is included',
    );
  });
});

// ---------------------------------------------------------------------------
// assembleImplementPrompt
// ---------------------------------------------------------------------------

module('factory-prompt-loader > assembleImplementPrompt', function () {
  test('includes project and ticket context', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      project: {
        id: 'Project/sticky-note',
        objective: 'Build a sticky note card app',
        successCriteria: ['Card renders', 'Tests pass'],
      },
      ticket: {
        id: 'Ticket/define-core',
        summary: 'Define the core StickyNote card',
        status: 'in-progress',
        priority: 'high',
        description:
          'Create the StickyNote CardDef with title and body fields.',
      },
    });
    let result = assembleImplementPrompt({ context: ctx, loader });

    assert.ok(
      result.includes('Build a sticky note card app'),
      'project objective',
    );
    assert.ok(result.includes('Card renders'), 'success criteria');
    assert.ok(result.includes('Ticket/define-core'), 'ticket ID');
    assert.ok(
      result.includes('Define the core StickyNote card'),
      'ticket summary',
    );
    assert.ok(result.includes('StickyNote CardDef'), 'ticket description');
  });

  test('includes knowledge articles', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      knowledge: [
        {
          id: 'Knowledge/card-patterns',
          title: 'Card Patterns',
          content: 'Cards use @field decorators.',
        },
      ],
    });
    let result = assembleImplementPrompt({ context: ctx, loader });

    assert.ok(result.includes('Card Patterns'), 'knowledge title');
    assert.ok(result.includes('@field decorators'), 'knowledge content');
  });

  test('includes instructions section', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext();
    let result = assembleImplementPrompt({ context: ctx, loader });

    assert.ok(
      result.includes('Implement this ticket'),
      'has implementation instructions',
    );
    assert.ok(result.includes('invoke_tool'), 'mentions invoke_tool');
  });

  test('includes checklist when present', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      ticket: {
        id: 'Ticket/test',
        summary: 'Test',
        status: 'open',
        priority: 'medium',
        description: 'Test ticket',
        checklist: ['Step 1', 'Step 2'],
      },
    });
    let result = assembleImplementPrompt({ context: ctx, loader });

    assert.ok(result.includes('Step 1'), 'includes checklist item 1');
    assert.ok(result.includes('Step 2'), 'includes checklist item 2');
  });
});

// ---------------------------------------------------------------------------
// assembleIteratePrompt
// ---------------------------------------------------------------------------

module('factory-prompt-loader > assembleIteratePrompt', function () {
  test('includes ticket context and previous actions', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      project: {
        id: 'Project/test',
        objective: 'Test objective',
      },
      ticket: {
        id: 'Ticket/define-core',
        summary: 'Define core card',
        description: 'Create the card definition.',
      },
      testResults: {
        status: 'failed',
        passedCount: 1,
        failedCount: 1,
        failures: [
          {
            testName: 'renders card',
            error: 'Element not found',
            stackTrace: 'at test.spec.ts:10',
          },
        ],
        durationMs: 3000,
      },
    });

    let previousActions: AgentAction[] = [
      {
        type: 'create_file',
        path: 'sticky-note.gts',
        content: 'export class StickyNote {}',
        realm: 'target',
      },
      {
        type: 'create_test',
        path: 'TestSpec/sticky-note.spec.ts',
        content: 'test("renders", () => {})',
        realm: 'test',
      },
    ];

    let result = assembleIteratePrompt({
      context: ctx,
      previousActions,
      iteration: 2,
      loader,
    });

    // Ticket context
    assert.ok(result.includes('Ticket/define-core'), 'includes ticket ID');
    assert.ok(result.includes('Define core card'), 'includes ticket summary');

    // Previous actions
    assert.ok(result.includes('iteration 2'), 'includes iteration number');
    assert.ok(
      result.includes('sticky-note.gts'),
      'includes previous action path',
    );
    assert.ok(
      result.includes('export class StickyNote'),
      'includes previous action content',
    );

    // Test results
    assert.ok(result.includes('failed'), 'includes test status');
    assert.ok(result.includes('renders card'), 'includes failure test name');
    assert.ok(result.includes('Element not found'), 'includes failure error');
    assert.ok(result.includes('at test.spec.ts:10'), 'includes stack trace');

    // Instructions
    assert.ok(
      result.includes('Fix the failing tests'),
      'includes fix instructions',
    );
  });

  test('includes tool results when present', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      testResults: {
        status: 'failed',
        passedCount: 0,
        failedCount: 1,
        failures: [{ testName: 'basic', error: 'fail' }],
        durationMs: 1000,
      },
      toolResults: [
        {
          tool: 'search-realm',
          exitCode: 0,
          output: { found: true },
          durationMs: 500,
        },
      ],
    });

    let result = assembleIteratePrompt({
      context: ctx,
      previousActions: [{ type: 'done' }],
      iteration: 1,
      loader,
    });

    assert.ok(result.includes('search-realm'), 'includes tool name');
    assert.ok(result.includes('exit code: 0'), 'includes exit code');
  });

  test('is self-contained: includes project, ticket, actions, test results', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      project: { id: 'Project/app', objective: 'Build the app' },
      ticket: {
        id: 'Ticket/t1',
        summary: 'First ticket',
        description: 'Do the thing.',
      },
      testResults: {
        status: 'failed',
        passedCount: 0,
        failedCount: 2,
        failures: [
          { testName: 'test-a', error: 'error-a' },
          { testName: 'test-b', error: 'error-b' },
        ],
        durationMs: 5000,
      },
    });

    let previousActions: AgentAction[] = [
      {
        type: 'create_file',
        path: 'card.gts',
        content: 'code',
        realm: 'target',
      },
    ];

    let result = assembleIteratePrompt({
      context: ctx,
      previousActions,
      iteration: 3,
      loader,
    });

    // All required sections are present
    assert.ok(result.includes('Build the app'), 'project context');
    assert.ok(result.includes('Ticket/t1'), 'ticket ID');
    assert.ok(result.includes('First ticket'), 'ticket summary');
    assert.ok(result.includes('Do the thing'), 'ticket description');
    assert.ok(result.includes('iteration 3'), 'iteration number');
    assert.ok(result.includes('card.gts'), 'previous action');
    assert.ok(result.includes('error-a'), 'test failure 1');
    assert.ok(result.includes('error-b'), 'test failure 2');
    assert.ok(result.includes('Fix the failing tests'), 'fix instructions');
  });
});

// ---------------------------------------------------------------------------
// assembleTestPrompt
// ---------------------------------------------------------------------------

module('factory-prompt-loader > assembleTestPrompt', function () {
  test('includes ticket and implemented files', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      ticket: { id: 'Ticket/t1', summary: 'Test ticket' },
    });

    let result = assembleTestPrompt({
      context: ctx,
      implementedFiles: [
        {
          path: 'sticky-note.gts',
          content: 'export class StickyNote {}',
          realm: 'target',
        },
      ],
      loader,
    });

    assert.ok(result.includes('Ticket/t1'), 'includes ticket ID');
    assert.ok(result.includes('sticky-note.gts'), 'includes file path');
    assert.ok(
      result.includes('export class StickyNote'),
      'includes file content',
    );
    assert.ok(result.includes('target realm'), 'includes realm');
    assert.ok(
      result.includes('create_test'),
      'instructs to return create_test',
    );
  });
});

// ---------------------------------------------------------------------------
// buildOneShotMessages
// ---------------------------------------------------------------------------

module('factory-prompt-loader > buildOneShotMessages', function () {
  test('returns exactly [system, user] pair', function (assert) {
    let messages = buildOneShotMessages('system content', 'user content');
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[0].content, 'system content');
    assert.strictEqual(messages[1].role, 'user');
    assert.strictEqual(messages[1].content, 'user content');
  });
});

// ---------------------------------------------------------------------------
// One-shot message assembly at each loop stage
// ---------------------------------------------------------------------------

module(
  'factory-prompt-loader > one-shot message assembly integration',
  function () {
    test('first pass: [system, ticket-implement]', function (assert) {
      let loader = new FilePromptLoader();
      let ctx = makeMinimalContext({
        project: { id: 'Project/app', objective: 'Build app' },
        ticket: {
          id: 'Ticket/t1',
          summary: 'First ticket',
          status: 'open',
          priority: 'high',
          description: 'Implement the feature.',
        },
      });

      let systemPrompt = assembleSystemPrompt({ context: ctx, loader });
      let userPrompt = assembleImplementPrompt({ context: ctx, loader });
      let messages = buildOneShotMessages(systemPrompt, userPrompt);

      assert.strictEqual(messages.length, 2, 'exactly 2 messages');
      assert.strictEqual(messages[0].role, 'system');
      assert.strictEqual(messages[1].role, 'user');

      // System has agent role
      assert.ok(messages[0].content.includes('software factory agent'));
      // User has ticket
      assert.ok(messages[1].content.includes('Ticket/t1'));
      assert.ok(messages[1].content.includes('Implement the feature'));
    });

    test('iteration pass: [system, ticket-iterate]', function (assert) {
      let loader = new FilePromptLoader();
      let ctx = makeMinimalContext({
        project: { id: 'Project/app', objective: 'Build app' },
        ticket: {
          id: 'Ticket/t1',
          summary: 'First ticket',
          description: 'Implement the feature.',
        },
        testResults: {
          status: 'failed',
          passedCount: 0,
          failedCount: 1,
          failures: [{ testName: 'basic', error: 'boom' }],
          durationMs: 2000,
        },
      });

      let previousActions: AgentAction[] = [
        {
          type: 'create_file',
          path: 'card.gts',
          content: 'code',
          realm: 'target',
        },
      ];

      let systemPrompt = assembleSystemPrompt({ context: ctx, loader });
      let userPrompt = assembleIteratePrompt({
        context: ctx,
        previousActions,
        iteration: 2,
        loader,
      });
      let messages = buildOneShotMessages(systemPrompt, userPrompt);

      assert.strictEqual(messages.length, 2, 'exactly 2 messages');
      assert.strictEqual(messages[0].role, 'system');
      assert.strictEqual(messages[1].role, 'user');

      // System prompt is the same structure
      assert.ok(messages[0].content.includes('software factory agent'));
      // User prompt has iterate content
      assert.ok(messages[1].content.includes('Previous Attempt'));
      assert.ok(messages[1].content.includes('card.gts'));
      assert.ok(messages[1].content.includes('boom'));
      assert.ok(messages[1].content.includes('Fix the failing tests'));
    });

    test('each LLM call is exactly [system, user] — no multi-turn', function (assert) {
      let loader = new FilePromptLoader();
      let ctx = makeMinimalContext();

      let systemPrompt = assembleSystemPrompt({ context: ctx, loader });
      let userPrompt = assembleImplementPrompt({ context: ctx, loader });
      let messages = buildOneShotMessages(systemPrompt, userPrompt);

      // Verify NO assistant messages
      let roles = messages.map((m) => m.role);
      assert.deepEqual(roles, ['system', 'user'], 'only system and user roles');
    });
  },
);
