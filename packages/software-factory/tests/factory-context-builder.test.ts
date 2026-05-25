import { module, test } from 'qunit';

import type {
  KnowledgeArticleData,
  ProjectData,
  ResolvedSkill,
  TestResult,
  ValidationResults,
  IssueData,
} from '../src/factory-agent';

import {
  ContextBuilder,
  type ContextBuilderConfig,
  type IssueRelationshipLoader,
} from '../src/factory-context-builder';

import type {
  SkillLoaderInterface,
  SkillResolver,
} from '../src/factory-skill-loader';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class StubSkillResolver implements SkillResolver {
  /** Pre-configured skill names returned by resolve(). */
  skillNames: string[];
  /** Records all (issue, project) pairs passed to resolve(). */
  calls: { issue: IssueData; project: ProjectData }[] = [];

  constructor(skillNames: string[] = ['boxel-development']) {
    this.skillNames = skillNames;
  }

  resolve(issue: IssueData, project: ProjectData): string[] {
    this.calls.push({ issue, project });
    return this.skillNames;
  }
}

class StubSkillLoader implements SkillLoaderInterface {
  /** Map from skill name to the ResolvedSkill that load() returns. */
  private skillMap: Map<string, ResolvedSkill>;
  /** Records all loadAll() calls: [skillNames, issue]. */
  loadAllCalls: { skillNames: string[]; issue?: IssueData }[] = [];

  constructor(skills: ResolvedSkill[] = []) {
    this.skillMap = new Map(skills.map((s) => [s.name, s]));
  }

  async load(skillName: string, _issue?: IssueData): Promise<ResolvedSkill> {
    let skill = this.skillMap.get(skillName);
    if (!skill) {
      throw new Error(`StubSkillLoader: unknown skill "${skillName}"`);
    }
    return skill;
  }

  async loadAll(
    skillNames: string[],
    issue?: IssueData,
  ): Promise<ResolvedSkill[]> {
    this.loadAllCalls.push({ skillNames, issue });
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

class StubIssueRelationshipLoader implements IssueRelationshipLoader {
  project: ProjectData | undefined;
  knowledge: KnowledgeArticleData[];

  constructor(opts?: {
    project?: ProjectData | null;
    knowledge?: KnowledgeArticleData[];
  }) {
    this.project =
      opts && 'project' in opts
        ? (opts.project ?? undefined)
        : { id: 'project-1', name: 'Sticky Notes' };
    this.knowledge = opts?.knowledge ?? [];
  }

  async loadProject(_issue: IssueData): Promise<ProjectData | undefined> {
    return this.project;
  }

  async loadKnowledge(_issue: IssueData): Promise<KnowledgeArticleData[]> {
    return this.knowledge;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProject(overrides?: Partial<ProjectData>): ProjectData {
  return { id: 'project-1', name: 'Sticky Notes', ...overrides };
}

function makeIssue(overrides?: Partial<IssueData>): IssueData {
  return {
    id: 'issue-1',
    title: 'Implement StickyNote card',
    description: 'Create a .gts card definition for StickyNote',
    ...overrides,
  };
}

function makeKnowledge(
  overrides?: Partial<KnowledgeArticleData>,
): KnowledgeArticleData {
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

  return {
    config: {
      skillResolver: resolver,
      skillLoader: loader,
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
  test('resolves skills from issue and project', async function (assert) {
    let { config, resolver } = makeConfig();
    let builder = new ContextBuilder(config);
    let issue = makeIssue();
    let project = makeProject();

    await builder.build({
      project,
      issue,
      knowledge: [],
      targetRealm: 'https://example.test/target/',
    });

    assert.strictEqual(resolver.calls.length, 1, 'resolve() called once');
    assert.strictEqual(
      resolver.calls[0].issue,
      issue,
      'resolve() received the issue',
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
      issue: makeIssue(),
      knowledge: [],
      targetRealm: 'https://example.test/target/',
    });

    assert.strictEqual(loader.loadAllCalls.length, 1, 'loadAll() called once');
    assert.deepEqual(
      loader.loadAllCalls[0].skillNames,
      ['boxel-development', 'ember-best-practices'],
      'loadAll() received the resolved skill names',
    );
  });

  test('passes issue to loadAll for reference filtering', async function (assert) {
    let resolver = new StubSkillResolver(['boxel-development']);
    let loader = new StubSkillLoader([makeSkill('boxel-development')]);
    let { config } = makeConfig({
      skillResolver: resolver,
      skillLoader: loader,
    });
    let builder = new ContextBuilder(config);
    let issue = makeIssue();

    await builder.build({
      project: makeProject(),
      issue,
      knowledge: [],
      targetRealm: 'https://example.test/target/',
    });

    assert.strictEqual(
      loader.loadAllCalls[0].issue,
      issue,
      'loadAll() received the issue for reference filtering',
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
      issue: makeIssue(),
      knowledge: [],
      targetRealm: 'https://example.test/target/',
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
    // Each skill content is short (~36 chars ÷ 4 ≈ 9 tokens).
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
      issue: makeIssue(),
      knowledge: [],
      targetRealm: 'https://example.test/target/',
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
      issue: makeIssue(),
      knowledge: [],
      targetRealm: 'https://example.test/target/',
    });

    assert.strictEqual(ctx.skills.length, 2, 'all skills included');
  });
});

// ---------------------------------------------------------------------------
// Tests: Tools are not included in context
// ---------------------------------------------------------------------------

module('factory-context-builder > tools excluded', function () {
  test('context does not include tools (provided separately as FactoryTool[])', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      issue: makeIssue(),
      knowledge: [],
      targetRealm: 'https://example.test/target/',
    });

    assert.strictEqual(
      ctx.tools,
      undefined,
      'tools not set — provided separately as FactoryTool[] to agent.run()',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: Test results threading
// ---------------------------------------------------------------------------

module('factory-context-builder > test results', function () {
  test('context has no testResults on first pass', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      issue: makeIssue(),
      knowledge: [],
      targetRealm: 'https://example.test/target/',
    });

    assert.strictEqual(ctx.testResults, undefined, 'no testResults');
  });

  test('includes testResults when provided', async function (assert) {
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
      issue: makeIssue(),
      knowledge: [],
      targetRealm: 'https://example.test/target/',

      testResults,
    });

    assert.deepEqual(ctx.testResults, testResults, 'testResults included');
  });

  test('passing testResults does not include deprecated fields', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);
    let testResults: TestResult = {
      status: 'passed',
      passedCount: 3,
      failedCount: 0,
      failures: [],
      durationMs: 2000,
    };

    let ctx = await builder.build({
      project: makeProject(),
      issue: makeIssue(),
      knowledge: [],
      targetRealm: 'https://example.test/target/',

      testResults,
    });

    assert.deepEqual(ctx.testResults, testResults, 'testResults included');
    assert.strictEqual(ctx.tools, undefined, 'no tools');
    assert.strictEqual(ctx.toolResults, undefined, 'no toolResults');
    assert.strictEqual(ctx.previousActions, undefined, 'no previousActions');
    assert.strictEqual(ctx.iteration, undefined, 'no iteration');
  });
});

// ---------------------------------------------------------------------------
// Tests: Core context fields
// ---------------------------------------------------------------------------

module('factory-context-builder > core fields', function () {
  test('includes project, issue, and knowledge in context', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);
    let project = makeProject();
    let issue = makeIssue();
    let knowledge = [makeKnowledge(), makeKnowledge({ id: 'ka-2' })];

    let ctx = await builder.build({
      project,
      issue,
      knowledge,
      targetRealm: 'https://example.test/target/',
    });

    assert.strictEqual(ctx.project, project, 'project passed through');
    assert.strictEqual(ctx.issue, issue, 'issue passed through');
    assert.strictEqual(ctx.knowledge, knowledge, 'knowledge passed through');
  });

  test('includes realm URLs in context', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      issue: makeIssue(),
      knowledge: [],
      targetRealm: 'https://example.test/my-realm/',
    });

    assert.strictEqual(ctx.targetRealm, 'https://example.test/my-realm/');
  });

  test('handles empty knowledge array', async function (assert) {
    let { config } = makeConfig();
    let builder = new ContextBuilder(config);

    let ctx = await builder.build({
      project: makeProject(),
      issue: makeIssue(),
      knowledge: [],
      targetRealm: 'https://example.test/target/',
    });

    assert.deepEqual(ctx.knowledge, [], 'empty knowledge is fine');
  });
});

// ===========================================================================
// Tests: buildForIssue (Phase 2)
// ===========================================================================

function makeIssueConfig(
  loaderOpts?: ConstructorParameters<typeof StubIssueRelationshipLoader>[0],
  configOverrides?: Partial<ContextBuilderConfig>,
) {
  let resolver = new StubSkillResolver();
  let loader = new StubSkillLoader([
    makeSkill('boxel-development'),
    makeSkill('boxel-file-structure'),
    makeSkill('ember-best-practices'),
  ]);
  let issueLoader = new StubIssueRelationshipLoader(loaderOpts);

  return {
    config: {
      skillResolver: resolver,
      skillLoader: loader,
      issueLoader,
      ...configOverrides,
    } as ContextBuilderConfig,
    resolver,
    loader,
    issueLoader,
  };
}

// ---------------------------------------------------------------------------
// Tests: buildForIssue — relationship traversal
// ---------------------------------------------------------------------------

module('factory-context-builder > buildForIssue > relationships', function () {
  test('loads project from issue.project relationship', async function (assert) {
    let project = makeProject({ id: 'proj-99', name: 'Todo App' });
    let { config } = makeIssueConfig({ project });
    let builder = new ContextBuilder(config);

    let ctx = await builder.buildForIssue({
      issue: makeIssue(),
      targetRealm: 'https://example.test/target/',
    });

    assert.strictEqual(ctx.project.id, 'proj-99', 'project loaded from issue');
    assert.strictEqual(ctx.project.name, 'Todo App');
  });

  test('loads knowledge from issue.relatedKnowledge', async function (assert) {
    let knowledge = [
      makeKnowledge({ id: 'ka-1', title: 'Card Basics' }),
      makeKnowledge({ id: 'ka-2', title: 'Styling Guide' }),
    ];
    let { config } = makeIssueConfig({ knowledge });
    let builder = new ContextBuilder(config);

    let ctx = await builder.buildForIssue({
      issue: makeIssue(),
      targetRealm: 'https://example.test/target/',
    });

    assert.strictEqual(ctx.knowledge.length, 2, 'two knowledge articles');
    assert.strictEqual(ctx.knowledge[0].id, 'ka-1');
    assert.strictEqual(ctx.knowledge[1].id, 'ka-2');
  });

  test('throws when issue has no linked project', async function (assert) {
    let { config } = makeIssueConfig({ project: null });
    let builder = new ContextBuilder(config);

    try {
      await builder.buildForIssue({
        issue: makeIssue({ id: 'orphan-issue' }),
        targetRealm: 'https://example.test/target/',
      });
      assert.ok(false, 'should have thrown');
    } catch (error) {
      assert.ok(
        (error as Error).message.includes('orphan-issue'),
        'error mentions the issue id',
      );
      assert.ok(
        (error as Error).message.includes('no linked project'),
        'error explains the problem',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: buildForIssue — validation results
// ---------------------------------------------------------------------------

module(
  'factory-context-builder > buildForIssue > validation results',
  function () {
    test('includes validation results when provided (2nd+ inner-loop iteration)', async function (assert) {
      let { config } = makeIssueConfig();
      let builder = new ContextBuilder(config);
      let validationResults: ValidationResults = {
        passed: false,
        steps: [
          { step: 'parse', passed: true, errors: [] },
          {
            step: 'lint',
            passed: false,
            files: ['sticky-note.gts'],
            errors: [
              {
                file: 'sticky-note.gts',
                message: "Expected ';' after statement",
              },
            ],
          },
        ],
      };

      let ctx = await builder.buildForIssue({
        issue: makeIssue(),
        targetRealm: 'https://example.test/target/',
        validationResults,
      });

      assert.deepEqual(
        ctx.validationResults,
        validationResults,
        'validation results included',
      );
      assert.strictEqual(
        ctx.validationResults?.steps.length,
        2,
        'two validation steps',
      );
      assert.strictEqual(
        ctx.validationResults?.steps[1].step,
        'lint',
        'lint step present',
      );
    });

    test('omits validation results on first inner-loop iteration (none provided)', async function (assert) {
      let { config } = makeIssueConfig();
      let builder = new ContextBuilder(config);

      let ctx = await builder.buildForIssue({
        issue: makeIssue(),
        targetRealm: 'https://example.test/target/',
      });

      assert.strictEqual(
        ctx.validationResults,
        undefined,
        'no validation results on first iteration',
      );
    });

    test('validation results include step name, file paths, error details', async function (assert) {
      let { config } = makeIssueConfig();
      let builder = new ContextBuilder(config);
      let validationResults: ValidationResults = {
        passed: false,
        steps: [
          {
            step: 'evaluate',
            passed: false,
            files: ['sticky-note.gts'],
            errors: [
              {
                file: 'sticky-note.gts',
                message: 'Cannot find module ./base-card',
                stackTrace: 'at ModuleLoader.load (loader.ts:42)',
              },
            ],
          },
          {
            step: 'test',
            passed: false,
            files: ['sticky-note.test.gts'],
            errors: [
              {
                file: 'sticky-note.test.gts',
                message: 'Expected element to exist',
              },
            ],
          },
        ],
      };

      let ctx = await builder.buildForIssue({
        issue: makeIssue(),
        targetRealm: 'https://example.test/target/',
        validationResults,
      });

      let evalStep = ctx.validationResults?.steps[0];
      assert.strictEqual(evalStep?.step, 'evaluate');
      assert.deepEqual(evalStep?.files, ['sticky-note.gts']);
      assert.strictEqual(
        evalStep?.errors[0].stackTrace,
        'at ModuleLoader.load (loader.ts:42)',
      );

      let testStep = ctx.validationResults?.steps[1];
      assert.strictEqual(testStep?.step, 'test');
      assert.strictEqual(
        testStep?.errors[0].message,
        'Expected element to exist',
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Tests: buildForIssue — skills
// ---------------------------------------------------------------------------

module('factory-context-builder > buildForIssue > skills', function () {
  test('skill selection works based on issue content', async function (assert) {
    let { config, resolver } = makeIssueConfig();
    let builder = new ContextBuilder(config);
    let issue = makeIssue({
      description: 'Create a .gts card definition with ember components',
    });
    let project = makeProject({ id: 'project-1', name: 'Todo App' });
    // Pre-set the project so the resolver gets it
    (config.issueLoader as StubIssueRelationshipLoader).project = project;

    await builder.buildForIssue({
      issue,
      targetRealm: 'https://example.test/target/',
    });

    assert.strictEqual(resolver.calls.length, 1, 'resolver called once');
    assert.strictEqual(
      resolver.calls[0].issue,
      issue,
      'resolver received the issue',
    );
    assert.strictEqual(
      resolver.calls[0].project,
      project,
      'resolver received the loaded project',
    );
  });

  test('token budget enforcement still works with buildForIssue', async function (assert) {
    let resolver = new StubSkillResolver([
      'boxel-development',
      'ember-best-practices',
    ]);
    let loader = new StubSkillLoader([
      makeSkill('boxel-development', 'A'.repeat(36)), // 9 tokens
      makeSkill('ember-best-practices', 'B'.repeat(36)), // 9 tokens
    ]);
    let issueLoader = new StubIssueRelationshipLoader();
    let config: ContextBuilderConfig = {
      skillResolver: resolver,
      skillLoader: loader,
      issueLoader,
      maxSkillTokens: 10,
    };
    let builder = new ContextBuilder(config);

    let ctx = await builder.buildForIssue({
      issue: makeIssue(),
      targetRealm: 'https://example.test/target/',
    });

    assert.strictEqual(ctx.skills.length, 1, 'budget trimmed to one skill');
    assert.strictEqual(
      ctx.skills[0].name,
      'boxel-development',
      'higher-priority skill kept',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: buildForIssue — bootstrap and context fields
// ---------------------------------------------------------------------------

module(
  'factory-context-builder > buildForIssue > bootstrap and fields',
  function () {
    test('bootstrap issue context includes brief URL', async function (assert) {
      let { config } = makeIssueConfig();
      let builder = new ContextBuilder(config);

      let ctx = await builder.buildForIssue({
        issue: makeIssue({ issueType: 'bootstrap' }),
        targetRealm: 'https://example.test/target/',
        briefUrl: 'https://example.test/briefs/sticky-notes',
      });

      assert.strictEqual(
        ctx.briefUrl,
        'https://example.test/briefs/sticky-notes',
        'briefUrl included for bootstrap issue',
      );
    });

    test('omits briefUrl when not provided', async function (assert) {
      let { config } = makeIssueConfig();
      let builder = new ContextBuilder(config);

      let ctx = await builder.buildForIssue({
        issue: makeIssue(),
        targetRealm: 'https://example.test/target/',
      });

      assert.strictEqual(ctx.briefUrl, undefined, 'no briefUrl');
    });

    test('includes targetRealm in context', async function (assert) {
      let { config } = makeIssueConfig();
      let builder = new ContextBuilder(config);

      let ctx = await builder.buildForIssue({
        issue: makeIssue(),
        targetRealm: 'https://example.test/my-realm/',
      });

      assert.strictEqual(ctx.targetRealm, 'https://example.test/my-realm/');
    });

    test('throws when issueLoader is not configured', async function (assert) {
      let { config } = makeConfig(); // no issueLoader
      let builder = new ContextBuilder(config);

      try {
        await builder.buildForIssue({
          issue: makeIssue(),
          targetRealm: 'https://example.test/target/',
        });
        assert.ok(false, 'should have thrown');
      } catch (error) {
        assert.ok(
          (error as Error).message.includes('issueLoader'),
          'error mentions issueLoader',
        );
      }
    });
  },
);
