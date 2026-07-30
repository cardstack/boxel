import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  assembleImplementPrompt,
  assembleIteratePrompt,
  assembleSystemPrompt,
  assembleTestPrompt,
  buildOneShotMessages,
  FilePromptLoader,
  interpolate,
  PromptTemplateNotFoundError,
} from '../src/factory-prompt-loader.ts';

import type { AgentAction, AgentContext } from '../src/factory-agent/index.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMinimalContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    project: { id: 'Projects/test-project' },
    issue: { id: 'Issues/test-issue' },
    knowledge: [],
    skills: [],
    tools: [],
    targetRealm: 'https://realms.example.test/user/target/',
    // System-prompt rendering requires this — `assembleSystemPrompt`
    // throws if it's missing or empty (see requireDarkfactoryModuleUrl
    // in factory-prompt-loader.ts). In production the wiring sets it
    // via inferDarkfactoryModuleUrl(targetRealm); tests use a fixed
    // value so snapshots stay stable.
    darkfactoryModuleUrl:
      'https://realms.example.test/software-factory/darkfactory',
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
    let result = interpolate('ID: {{issue.id}}', {
      issue: { id: 'Issue/123' },
    });
    assert.strictEqual(result, 'ID: Issue/123');
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
    let template = '{{#if issue.checklist}}has checklist{{/if}}';
    let result = interpolate(template, {
      issue: { checklist: ['step 1'] },
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
    let result = loader.load('system', {
      targetRealm: 'https://example.test/target/',
      skills: [],
    });
    assert.ok(
      result.includes('signal_done'),
      'system prompt contains signal_done',
    );
    // The prompt template talks in operations, not concrete tool names —
    // each agent backend appends its own surface-specific addendum
    // (Claude: native fs + MCP rename map; OpenRouter: factory tools).
    assert.ok(
      result.includes('workspace mirror of'),
      'system prompt names the workspace mirror as the read/write surface',
    );
  });

  test('caches templates on subsequent loads', function (assert) {
    let loader = new FilePromptLoader();
    let vars = {
      targetRealm: 'https://example.test/target/',
      skills: [],
    };
    let first = loader.load('system', vars);
    let second = loader.load('system', vars);
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
    let vars = {
      targetRealm: 'https://example.test/target/',
      skills: [],
    };
    let first = loader.load('system', vars);
    loader.clearCache();
    let second = loader.load('system', vars);
    assert.strictEqual(first, second, 'content is the same after cache clear');
  });
});

// ---------------------------------------------------------------------------
// assembleSystemPrompt
// ---------------------------------------------------------------------------

module('factory-prompt-loader > assembleSystemPrompt', function () {
  test('includes role and tool-use rules', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext();
    let result = assembleSystemPrompt({ context: ctx, loader });

    assert.ok(
      result.includes('software factory agent'),
      'includes role description',
    );
    assert.ok(
      result.includes('signal_done'),
      'includes signal_done instruction',
    );
    // The system prompt now phrases I/O as operations on a workspace
    // mirror; the concrete read/write tool names (read_file vs native
    // Read) are introduced by each agent's backend-specific addendum.
    assert.ok(
      result.includes('workspace mirror of'),
      'includes workspace-mirror language for fs operations',
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
  });

  test('includes Catalog Spec instructions', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext();
    let result = assembleSystemPrompt({ context: ctx, loader });

    assert.ok(
      result.includes('Catalog Spec'),
      'includes Catalog Spec instructions',
    );
    assert.ok(
      result.includes('linkedExamples'),
      'includes linkedExamples instruction',
    );
  });

  test('includes skills when present', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      skills: [
        {
          name: 'boxel',
          content: 'Use Boxel patterns for card definitions.',
          references: ['ref-guide.md'],
        },
      ],
    });
    let result = assembleSystemPrompt({ context: ctx, loader });

    assert.ok(result.includes('boxel'), 'includes skill name');
    assert.ok(result.includes('Use Boxel patterns'), 'includes skill content');
    assert.ok(result.includes('ref-guide.md'), 'includes skill references');
  });

  test('omits skills section when no skills', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({ skills: [] });
    let result = assembleSystemPrompt({ context: ctx, loader });

    assert.notOk(result.includes('# Skill:'), 'no skill section when empty');
  });

  test('snapshot: system prompt with sample skills', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      skills: [
        {
          name: 'boxel',
          content: 'Follow Boxel card patterns.',
        },
        {
          name: 'testing-guide',
          content: 'Write Playwright tests.',
          references: ['test-patterns.md'],
        },
      ],
    });
    let result = assembleSystemPrompt({ context: ctx, loader });

    // Verify structural elements are present and correctly ordered
    let roleIdx = result.indexOf('# Role');
    let rulesIdx = result.indexOf('# Rules');
    let realmsIdx = result.indexOf('# Realms');
    let skill1Idx = result.indexOf('# Skill: boxel');
    let skill2Idx = result.indexOf('# Skill: testing-guide');

    assert.ok(roleIdx >= 0, 'has Role section');
    assert.ok(rulesIdx > roleIdx, 'Rules after Role');
    assert.ok(realmsIdx > rulesIdx, 'Realms after Rules');
    assert.ok(skill1Idx > realmsIdx, 'first skill after Realms');
    assert.ok(skill2Idx > skill1Idx, 'second skill after first');

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
  test('includes project and issue context', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      project: {
        id: 'Projects/sticky-note',
        objective: 'Build a sticky note card app',
        successCriteria: ['Card renders', 'Tests pass'],
      },
      issue: {
        id: 'Issues/define-core',
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
    assert.ok(result.includes('Issues/define-core'), 'issue ID');
    assert.ok(
      result.includes('Define the core StickyNote card'),
      'issue summary',
    );
    assert.ok(result.includes('StickyNote CardDef'), 'issue description');
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
      result.includes('Implement this issue'),
      'has implementation instructions',
    );
    assert.ok(result.includes('signal_done'), 'mentions signal_done');
  });

  test('includes checklist when present', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      issue: {
        id: 'Issues/test',
        summary: 'Test',
        status: 'open',
        priority: 'medium',
        description: 'Test issue',
        checklist: ['Step 1', 'Step 2'],
      },
    });
    let result = assembleImplementPrompt({ context: ctx, loader });

    assert.ok(result.includes('Step 1'), 'includes checklist item 1');
    assert.ok(result.includes('Step 2'), 'includes checklist item 2');
  });

  test('includes tool results when present (after invoke_tool)', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      tools: [
        {
          name: 'search-realm',
          description: 'Search cards',
          category: 'realm-api' as const,
          args: [],
          outputFormat: 'json' as const,
        },
      ],
      toolResults: [
        {
          tool: 'search-realm',
          exitCode: 0,
          output: { cards: ['StickyNote/sample'] },
          durationMs: 200,
        },
      ],
    });
    let result = assembleImplementPrompt({ context: ctx, loader });

    assert.ok(result.includes('search-realm'), 'includes tool name in results');
    assert.ok(
      result.includes('StickyNote/sample'),
      'includes tool output data',
    );
    assert.ok(
      result.includes('Implement this issue'),
      'still includes implementation instructions',
    );
  });

  test('omits tool results section when no tool results', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext();
    let result = assembleImplementPrompt({ context: ctx, loader });

    assert.notOk(
      result.includes('Tool Results'),
      'no tool results section when empty',
    );
  });
});

// ---------------------------------------------------------------------------
// assembleIteratePrompt
// ---------------------------------------------------------------------------

module('factory-prompt-loader > assembleIteratePrompt', function () {
  test('includes issue context and previous actions', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      project: {
        id: 'Projects/test',
        objective: 'Test objective',
      },
      issue: {
        id: 'Issues/define-core',
        summary: 'Define core card',
        description: 'Create the card definition.',
      },
      validationContext:
        '## Test Validation: FAILED\n1 passed, 1 failed\n\nFAILED: "renders card"\n  Element not found\n  at test.spec.ts:10',
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

    // Issue context
    assert.ok(result.includes('Issues/define-core'), 'includes issue ID');
    assert.ok(result.includes('Define core card'), 'includes issue summary');

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

    // Validation context
    assert.ok(result.includes('FAILED'), 'includes validation status');
    assert.ok(result.includes('renders card'), 'includes failure test name');
    assert.ok(result.includes('Element not found'), 'includes failure error');
    assert.ok(result.includes('at test.spec.ts:10'), 'includes stack trace');

    // Instructions
    assert.ok(
      result.includes('Fix the validation failures'),
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

  test('propagates outputFormat for tool results fence', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      tools: [
        {
          name: 'run-tests',
          description: 'Run tests',
          category: 'realm-api' as const,
          args: [],
          outputFormat: 'text' as const,
        },
        {
          name: 'search-realm',
          description: 'Search cards',
          category: 'realm-api' as const,
          args: [],
          outputFormat: 'json' as const,
        },
      ],
      validationContext: '## Test Validation: FAILED\nbasic: fail',
      toolResults: [
        {
          tool: 'run-tests',
          exitCode: 1,
          output: 'FAIL: test-a\nsome plain text output',
          durationMs: 500,
        },
        {
          tool: 'search-realm',
          exitCode: 0,
          output: { cards: ['Card/1'] },
          durationMs: 200,
        },
      ],
    });

    let result = assembleIteratePrompt({
      context: ctx,
      previousActions: [{ type: 'done' }],
      iteration: 1,
      loader,
    });

    assert.ok(result.includes('```text'), 'text tool uses ```text fence');
    assert.ok(result.includes('```json'), 'json tool uses ```json fence');
    assert.ok(
      result.includes('some plain text output'),
      'text output preserved as-is',
    );
  });

  test('is self-contained: includes project, issue, actions, validation context', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      project: { id: 'Projects/app', objective: 'Build the app' },
      issue: {
        id: 'Issues/t1',
        summary: 'First issue',
        description: 'Do the thing.',
      },
      validationContext:
        '## Test Validation: FAILED\n0 passed, 2 failed\n\nFAILED: "test-a"\n  error-a\n\nFAILED: "test-b"\n  error-b',
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
    assert.ok(result.includes('Issues/t1'), 'issue ID');
    assert.ok(result.includes('First issue'), 'issue summary');
    assert.ok(result.includes('Do the thing'), 'issue description');
    assert.ok(result.includes('iteration 3'), 'iteration number');
    assert.ok(result.includes('card.gts'), 'previous action');
    assert.ok(result.includes('error-a'), 'validation failure 1');
    assert.ok(result.includes('error-b'), 'validation failure 2');
    assert.ok(
      result.includes('Fix the validation failures'),
      'fix instructions',
    );
  });
});

// ---------------------------------------------------------------------------
// assembleTestPrompt
// ---------------------------------------------------------------------------

module('factory-prompt-loader > assembleTestPrompt', function () {
  test('includes issue and implemented files', function (assert) {
    let loader = new FilePromptLoader();
    let ctx = makeMinimalContext({
      issue: { id: 'Issues/t1', summary: 'Test issue' },
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

    assert.ok(result.includes('Issues/t1'), 'includes issue ID');
    assert.ok(result.includes('sticky-note.gts'), 'includes file path');
    assert.ok(
      result.includes('export class StickyNote'),
      'includes file content',
    );
    assert.ok(result.includes('target realm'), 'includes realm');
    assert.ok(result.includes('signal_done'), 'instructs to call signal_done');
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
    test('first pass: [system, issue-implement]', function (assert) {
      let loader = new FilePromptLoader();
      let ctx = makeMinimalContext({
        project: { id: 'Projects/app', objective: 'Build app' },
        issue: {
          id: 'Issues/t1',
          summary: 'First issue',
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
      // User has issue
      assert.ok(messages[1].content.includes('Issues/t1'));
      assert.ok(messages[1].content.includes('Implement the feature'));
    });

    test('iteration pass: [system, issue-iterate]', function (assert) {
      let loader = new FilePromptLoader();
      let ctx = makeMinimalContext({
        project: { id: 'Projects/app', objective: 'Build app' },
        issue: {
          id: 'Issues/t1',
          summary: 'First issue',
          description: 'Implement the feature.',
        },
        validationContext:
          '## Test Validation: FAILED\n0 passed, 1 failed\n\nFAILED: "basic"\n  boom',
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
      assert.ok(messages[1].content.includes('Fix the validation failures'));
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
