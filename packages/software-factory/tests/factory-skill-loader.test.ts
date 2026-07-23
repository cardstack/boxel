import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import QUnit from 'qunit';
const { module, test } = QUnit;

import type {
  ProjectData,
  ResolvedSkill,
  IssueData,
} from '../src/factory-agent/index.ts';
import {
  DefaultSkillResolver,
  SkillLoader,
  SkillLoadError,
  enforceSkillBudget,
  estimateTokens,
  extractIssueText,
  parseFrontmatterDescription,
} from '../src/factory-skill-loader.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tempDir: string;
let skillsDirCounter = 0;

function createTempSkillsDir(): string {
  skillsDirCounter++;
  let dir = join(
    tmpdir(),
    `skill-loader-test-${Date.now()}-${skillsDirCounter}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkill(
  skillsDir: string,
  skillName: string,
  content: string,
  options?: {
    references?: Record<string, string>;
    rules?: Record<string, string>;
    agentsMd?: string;
  },
): void {
  let skillDir = join(skillsDir, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf8');

  if (options?.references) {
    let refsDir = join(skillDir, 'references');
    mkdirSync(refsDir, { recursive: true });
    for (let [name, refContent] of Object.entries(options.references)) {
      writeFileSync(join(refsDir, name), refContent, 'utf8');
    }
  }

  if (options?.rules) {
    let rulesDir = join(skillDir, 'rules');
    mkdirSync(rulesDir, { recursive: true });
    for (let [name, ruleContent] of Object.entries(options.rules)) {
      writeFileSync(join(rulesDir, name), ruleContent, 'utf8');
    }
  }

  if (options?.agentsMd) {
    writeFileSync(join(skillDir, 'AGENTS.md'), options.agentsMd, 'utf8');
  }
}

function makeIssue(overrides?: Partial<IssueData>): IssueData {
  return {
    id: 'Issues/test-issue',
    title: 'Test issue',
    description: 'A test issue for unit testing',
    ...overrides,
  };
}

function makeProject(overrides?: Partial<ProjectData>): ProjectData {
  return {
    id: 'Projects/test-project',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DefaultSkillResolver
// ---------------------------------------------------------------------------

module('factory-skill-loader > DefaultSkillResolver', function () {
  test('front-loads only the operations skill for implementation issues', function (assert) {
    let resolver = new DefaultSkillResolver();
    let issue = makeIssue({ description: 'Generic task with no keywords' });
    let project = makeProject();

    let { load, suggested } = resolver.resolve(issue, project);

    assert.deepEqual(
      load,
      ['software-factory-operations'],
      'only the workflow skill is front-loaded',
    );
    assert.deepEqual(
      suggested,
      ['boxel', 'boxel-file-structure', 'boxel-api', 'boxel-command'],
      'core domain skills are suggested, not loaded',
    );
  });

  test('bootstrap issues front-load the bootstrap skill', function (assert) {
    let resolver = new DefaultSkillResolver();
    let issue = makeIssue({ issueType: 'bootstrap' });
    let project = makeProject();

    let { load, suggested } = resolver.resolve(issue, project);

    assert.deepEqual(load, ['software-factory-bootstrap']);
    assert.deepEqual(suggested, ['boxel-file-structure']);
  });

  test('suggests UI skills when issue mentions .gts', function (assert) {
    let resolver = new DefaultSkillResolver();
    let issue = makeIssue({
      description: 'Create a new card definition in .gts format',
    });
    let project = makeProject();

    let { suggested } = resolver.resolve(issue, project);

    assert.true(suggested.includes('boxel-ui-guidelines'));
    assert.true(suggested.includes('boxel-design'));
    assert.true(suggested.includes('boxel-patterns'));
  });

  test('suggests UI skills when issue mentions component or CardDef', function (assert) {
    let resolver = new DefaultSkillResolver();
    let project = makeProject();

    let componentIssue = makeIssue({
      description: 'Build a new component for the dashboard',
    });
    assert.true(
      resolver
        .resolve(componentIssue, project)
        .suggested.includes('boxel-ui-guidelines'),
      'component keyword triggers UI suggestions',
    );

    let cardDefIssue = makeIssue({
      title: 'Define a new CardDef for employees',
    });
    assert.true(
      resolver
        .resolve(cardDefIssue, project)
        .suggested.includes('boxel-ui-guidelines'),
      'CardDef keyword triggers UI suggestions',
    );
  });

  test('no UI suggestions without .gts keywords', function (assert) {
    let resolver = new DefaultSkillResolver();
    let issue = makeIssue({
      description: 'Improve the factory delivery pipeline',
    });
    let project = makeProject();

    let { suggested } = resolver.resolve(issue, project);

    assert.false(suggested.includes('boxel-ui-guidelines'));
    assert.false(suggested.includes('boxel-design'));
  });

  test('front-loads operations even for sparse issues with no workflow keywords', function (assert) {
    // Regression: a one-line human-authored adjustment added via the board
    // UI ("Modernize the look") used to miss the operations skill because the
    // loader gated it on workflow keywords in the issue text. Every
    // non-bootstrap issue is a delivery issue, so it must always load.
    let resolver = new DefaultSkillResolver();
    let issue = makeIssue({
      title: 'Modernize the look of the calculator',
      issueType: 'adjustment',
    });
    let project = makeProject();

    let { load } = resolver.resolve(issue, project);

    assert.true(
      load.includes('software-factory-operations'),
      'sparse adjustment issue still front-loads the operations skill',
    );
  });

  test('knowledge article tags opt skills into the front-loaded set', function (assert) {
    let resolver = new DefaultSkillResolver();
    let issue = makeIssue();
    let project = makeProject({
      knowledge: [
        {
          id: 'Knowledge Articles/extension-ref',
          tags: ['skill:custom-extension', 'skill:another-domain-skill'],
        },
      ],
    });

    let { load } = resolver.resolve(issue, project);

    // Knowledge-tag opt-in is the deliberate way to force-load any
    // non-default skill, so tagged skills are front-loaded, not merely
    // suggested. The resolver returns the name; the loader resolves it
    // on disk.
    assert.true(
      load.includes('custom-extension'),
      'custom-extension front-loaded from knowledge tag',
    );
    assert.true(
      load.includes('another-domain-skill'),
      'another-domain-skill front-loaded from knowledge tag',
    );
  });

  test('extracts additional skills from knowledge article skills array', function (assert) {
    let resolver = new DefaultSkillResolver();
    let issue = makeIssue();
    let project = makeProject({
      knowledge: [
        {
          id: 'Knowledge Articles/custom',
          skills: ['extra-skill-a', 'extra-skill-b'],
        },
      ],
    });

    let { load } = resolver.resolve(issue, project);

    assert.true(load.includes('extra-skill-a'), 'includes extra-skill-a');
    assert.true(load.includes('extra-skill-b'), 'includes extra-skill-b');
  });

  test('reads skills from knowledgeBase field (Project schema)', function (assert) {
    let resolver = new DefaultSkillResolver();
    let issue = makeIssue();
    let project = makeProject({
      knowledgeBase: [
        {
          id: 'Knowledge Articles/from-schema',
          skills: ['schema-skill'],
        },
      ],
    });

    let { load } = resolver.resolve(issue, project);

    assert.true(
      load.includes('schema-skill'),
      'includes skill from knowledgeBase field',
    );
  });

  test('reads skills from relatedKnowledge field (Issue schema)', function (assert) {
    let resolver = new DefaultSkillResolver();
    let issue = makeIssue({
      relatedKnowledge: [
        {
          id: 'Knowledge Articles/issue-knowledge',
          tags: ['skill:issue-skill'],
        },
      ],
    });
    let project = makeProject();

    let { load } = resolver.resolve(issue, project);

    assert.true(
      load.includes('issue-skill'),
      'includes skill from issue relatedKnowledge',
    );
  });

  test('does not duplicate front-loaded skills', function (assert) {
    let resolver = new DefaultSkillResolver();
    let issue = makeIssue();
    let project = makeProject({
      knowledge: [
        {
          id: 'Knowledge Articles/dup',
          skills: ['software-factory-operations'],
        },
      ],
    });

    let { load } = resolver.resolve(issue, project);
    let opsCount = load.filter(
      (s) => s === 'software-factory-operations',
    ).length;
    assert.strictEqual(
      opsCount,
      1,
      'software-factory-operations appears only once',
    );
  });

  test('front-loads boxel-ui-component-discovery under the feature flag', function (assert) {
    let resolver = new DefaultSkillResolver({ enableBoxelUiDiscovery: true });
    let issue = makeIssue();
    let project = makeProject();

    let { load } = resolver.resolve(issue, project);

    assert.true(load.includes('boxel-ui-component-discovery'));
  });

  test('reads issue text from title, description, tags, and labels', function (assert) {
    let issue = makeIssue({
      title: 'Fix the component rendering',
      description: 'The template is broken',
      tags: ['ember', 'glimmer'],
      labels: [{ name: 'bug' }],
    });

    let text = extractIssueText(issue);

    assert.true(text.includes('fix the component rendering'));
    assert.true(text.includes('the template is broken'));
    assert.true(text.includes('ember'));
    assert.true(text.includes('glimmer'));
    assert.true(text.includes('bug'));
  });

  test('handles project with no knowledge array', function (assert) {
    let resolver = new DefaultSkillResolver();
    let issue = makeIssue();
    let project = makeProject(); // no knowledge field

    let { load, suggested } = resolver.resolve(issue, project);

    assert.deepEqual(load, ['software-factory-operations']);
    assert.true(suggested.includes('boxel'));
  });
});

// ---------------------------------------------------------------------------
// SkillLoader
// ---------------------------------------------------------------------------

module('factory-skill-loader > SkillLoader', function (hooks) {
  hooks.beforeEach(function () {
    tempDir = createTempSkillsDir();
  });

  hooks.afterEach(function () {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('loads a simple skill with only SKILL.md', async function (assert) {
    writeSkill(
      tempDir,
      'simple-skill',
      '---\nname: simple-skill\n---\n\n# Simple Skill\n\nContent here.',
    );

    let loader = new SkillLoader(tempDir, []);
    let skill = await loader.load('simple-skill');

    assert.strictEqual(skill.name, 'simple-skill');
    assert.true(skill.content.includes('# Simple Skill'));
    assert.strictEqual(skill.references, undefined, 'no references');
  });

  test('loads a skill with references/ directory', async function (assert) {
    writeSkill(tempDir, 'with-refs', '# Skill with refs', {
      references: {
        'ref-a.md': 'Reference A content',
        'ref-b.md': 'Reference B content',
      },
    });

    let loader = new SkillLoader(tempDir, []);
    let skill = await loader.load('with-refs');

    assert.strictEqual(skill.name, 'with-refs');
    assert.ok(skill.references, 'has references');
    assert.strictEqual(skill.references!.length, 2, 'two reference files');
    assert.true(
      skill.references!.some((r) => r.includes('Reference A')),
      'includes ref A',
    );
    assert.true(
      skill.references!.some((r) => r.includes('Reference B')),
      'includes ref B',
    );
  });

  test('loads a skill with rules/ directory and AGENTS.md', async function (assert) {
    writeSkill(tempDir, 'with-rules', '# Rule-based skill', {
      rules: {
        'rule-1.md': 'Rule 1 content',
        'rule-2.md': 'Rule 2 content',
      },
      agentsMd: '# Compiled AGENTS.md\n\nAll rules compiled here.',
    });

    let loader = new SkillLoader(tempDir, []);
    let skill = await loader.load('with-rules');

    assert.strictEqual(skill.name, 'with-rules');
    assert.ok(skill.references, 'has references from AGENTS.md');
    assert.strictEqual(
      skill.references!.length,
      1,
      'single reference (compiled AGENTS.md)',
    );
    assert.true(
      skill.references![0].includes('Compiled AGENTS.md'),
      'reference is the AGENTS.md content',
    );
  });

  test('rules/ directory without AGENTS.md results in no references', async function (assert) {
    writeSkill(tempDir, 'rules-no-agents', '# Rules without AGENTS.md', {
      rules: {
        'rule-1.md': 'Rule 1',
      },
    });

    let loader = new SkillLoader(tempDir, []);
    let skill = await loader.load('rules-no-agents');

    assert.strictEqual(skill.references, undefined, 'no references');
  });

  test('throws SkillLoadError for nonexistent skill', async function (assert) {
    let loader = new SkillLoader(tempDir, []);

    try {
      await loader.load('nonexistent-skill');
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof SkillLoadError, 'throws SkillLoadError');
      assert.true(
        (err as Error).message.includes('nonexistent-skill'),
        'error mentions skill name',
      );
    }
  });

  test('caches raw skill data for repeated calls', async function (assert) {
    writeSkill(tempDir, 'cached-skill', '# Cached\n\nOriginal content.');

    let loader = new SkillLoader(tempDir, []);

    let first = await loader.load('cached-skill');
    assert.true(first.content.includes('Original content'));

    // Overwrite the file on disk
    writeSkill(tempDir, 'cached-skill', '# Cached\n\nModified content.');

    let second = await loader.load('cached-skill');
    // Should still be the original (cached) content
    assert.true(
      second.content.includes('Original content'),
      'returns cached version',
    );
  });

  test('clearCache forces re-read from disk', async function (assert) {
    writeSkill(tempDir, 'cache-clear', '# Original');

    let loader = new SkillLoader(tempDir, []);
    let first = await loader.load('cache-clear');
    assert.true(first.content.includes('Original'));

    writeSkill(tempDir, 'cache-clear', '# Updated');
    loader.clearCache();

    let second = await loader.load('cache-clear');
    assert.true(second.content.includes('Updated'), 'reads updated content');
  });

  test('loadAll loads multiple skills', async function (assert) {
    writeSkill(tempDir, 'skill-a', '# Skill A');
    writeSkill(tempDir, 'skill-b', '# Skill B');
    writeSkill(tempDir, 'skill-c', '# Skill C');

    let loader = new SkillLoader(tempDir, []);
    let skills = await loader.loadAll(['skill-a', 'skill-b', 'skill-c']);

    assert.strictEqual(skills.length, 3);
    assert.deepEqual(
      skills.map((s) => s.name),
      ['skill-a', 'skill-b', 'skill-c'],
    );
  });

  test('loadAll skips missing skills with warning', async function (assert) {
    writeSkill(tempDir, 'exists', '# Exists');

    let warnings: string[] = [];
    let originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };

    try {
      let loader = new SkillLoader(tempDir, []);
      let skills = await loader.loadAll(['exists', 'does-not-exist']);

      assert.strictEqual(skills.length, 1, 'only loads existing skills');
      assert.strictEqual(skills[0].name, 'exists');
      assert.true(
        warnings.some((w) => w.includes('does-not-exist')),
        'logged a warning for missing skill',
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  test('references are loaded in sorted filename order', async function (assert) {
    writeSkill(tempDir, 'sorted-refs', '# Sorted', {
      references: {
        'z-last.md': 'Last',
        'a-first.md': 'First',
        'm-middle.md': 'Middle',
      },
    });

    let loader = new SkillLoader(tempDir, []);
    let skill = await loader.load('sorted-refs');

    assert.ok(skill.references);
    assert.strictEqual(skill.references![0], 'First', 'first ref is a-first');
    assert.strictEqual(
      skill.references![1],
      'Middle',
      'second ref is m-middle',
    );
    assert.strictEqual(skill.references![2], 'Last', 'third ref is z-last');
  });

  test('only loads .md files from references/', async function (assert) {
    writeSkill(tempDir, 'md-only', '# MD Only', {
      references: {
        'valid.md': 'Valid markdown',
      },
    });

    // Write a non-md file directly
    let refsDir = join(tempDir, 'md-only', 'references');
    writeFileSync(join(refsDir, 'image.png'), 'fake png data');
    writeFileSync(join(refsDir, 'notes.txt'), 'text file');

    let loader = new SkillLoader(tempDir, []);
    let skill = await loader.load('md-only');

    assert.ok(skill.references);
    assert.strictEqual(
      skill.references!.length,
      1,
      'only the .md file is loaded',
    );
  });

  test('finds skill in fallback directory when not in primary', async function (assert) {
    let primaryDir = createTempSkillsDir();
    let fallbackDir = createTempSkillsDir();

    // Skill only exists in fallback dir
    writeSkill(fallbackDir, 'fallback-skill', '# From Fallback');

    try {
      let loader = new SkillLoader(primaryDir, [fallbackDir]);
      let skill = await loader.load('fallback-skill');

      assert.strictEqual(skill.name, 'fallback-skill');
      assert.true(
        skill.content.includes('From Fallback'),
        'loaded from fallback dir',
      );
    } finally {
      rmSync(primaryDir, { recursive: true, force: true });
      rmSync(fallbackDir, { recursive: true, force: true });
    }
  });

  test('primary directory takes precedence over fallback', async function (assert) {
    let primaryDir = createTempSkillsDir();
    let fallbackDir = createTempSkillsDir();

    writeSkill(primaryDir, 'shared-skill', '# Primary Version');
    writeSkill(fallbackDir, 'shared-skill', '# Fallback Version');

    try {
      let loader = new SkillLoader(primaryDir, [fallbackDir]);
      let skill = await loader.load('shared-skill');

      assert.true(
        skill.content.includes('Primary Version'),
        'loaded from primary dir',
      );
      assert.false(
        skill.content.includes('Fallback Version'),
        'did not load fallback version',
      );
    } finally {
      rmSync(primaryDir, { recursive: true, force: true });
      rmSync(fallbackDir, { recursive: true, force: true });
    }
  });

  test('loads skill with rules/ and AGENTS.md from fallback directory', async function (assert) {
    let primaryDir = createTempSkillsDir();
    let fallbackDir = createTempSkillsDir();

    writeSkill(fallbackDir, 'ember-best-practices', '# Ember Best Practices', {
      rules: {
        'component-use-glimmer.md': 'Use Glimmer components',
        'route-lazy-load.md': 'Lazy load routes',
      },
      agentsMd: '# Compiled Ember Rules\n\n58 rules across 10 categories.',
    });

    try {
      let loader = new SkillLoader(primaryDir, [fallbackDir]);
      let skill = await loader.load('ember-best-practices');

      assert.strictEqual(skill.name, 'ember-best-practices');
      assert.ok(skill.references, 'has references from AGENTS.md');
      assert.strictEqual(skill.references!.length, 1);
      assert.true(
        skill.references![0].includes('Compiled Ember Rules'),
        'loaded AGENTS.md from fallback',
      );
    } finally {
      rmSync(primaryDir, { recursive: true, force: true });
      rmSync(fallbackDir, { recursive: true, force: true });
    }
  });

  test('loadAll finds skills across primary and fallback dirs', async function (assert) {
    let primaryDir = createTempSkillsDir();
    let fallbackDir = createTempSkillsDir();

    writeSkill(primaryDir, 'local-skill', '# Local');
    writeSkill(fallbackDir, 'shared-skill', '# Shared');

    try {
      let loader = new SkillLoader(primaryDir, [fallbackDir]);
      let skills = await loader.loadAll(['local-skill', 'shared-skill']);

      assert.strictEqual(skills.length, 2);
      assert.strictEqual(skills[0].name, 'local-skill');
      assert.strictEqual(skills[1].name, 'shared-skill');
    } finally {
      rmSync(primaryDir, { recursive: true, force: true });
      rmSync(fallbackDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Skill index + on-demand reads
// ---------------------------------------------------------------------------

module('factory-skill-loader > skill index', function (hooks) {
  hooks.beforeEach(function () {
    tempDir = createTempSkillsDir();
  });

  hooks.afterEach(function () {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function frontmatter(description: string): string {
    return `---\ndescription: ${description}\n---\n\n# Body\n`;
  }

  test('buildIndex lists name + frontmatter description per skill', async function (assert) {
    writeSkill(tempDir, 'skill-b', frontmatter('Skill B does things'));
    writeSkill(tempDir, 'skill-a', frontmatter('Skill A does other things'));

    let loader = new SkillLoader(tempDir, []);
    let index = await loader.buildIndex();

    assert.deepEqual(index, [
      { name: 'skill-a', description: 'Skill A does other things' },
      { name: 'skill-b', description: 'Skill B does things' },
    ]);
  });

  test('buildIndex skips skills without a frontmatter description', async function (assert) {
    writeSkill(tempDir, 'described', frontmatter('Has a description'));
    writeSkill(tempDir, 'undescribed', '# No frontmatter at all');

    let loader = new SkillLoader(tempDir, []);
    let index = await loader.buildIndex();

    assert.deepEqual(
      index.map((entry) => entry.name),
      ['described'],
      'undescribed skill omitted',
    );
  });

  test('buildIndex excludes factory-inappropriate skills', async function (assert) {
    writeSkill(tempDir, 'boxel', frontmatter('Core skill'));
    writeSkill(tempDir, 'realm-sync', frontmatter('Push/pull realms'));
    writeSkill(tempDir, 'file-ops', frontmatter('Write realm files'));

    let loader = new SkillLoader(tempDir, []);
    let index = await loader.buildIndex();

    assert.deepEqual(
      index.map((entry) => entry.name),
      ['boxel'],
      'realm-sync and file-ops are excluded from the index',
    );
  });

  test('buildIndex merges dirs with primary winning name collisions', async function (assert) {
    let fallbackDir = createTempSkillsDir();
    writeSkill(tempDir, 'shared', frontmatter('Primary description'));
    writeSkill(fallbackDir, 'shared', frontmatter('Fallback description'));
    writeSkill(fallbackDir, 'only-fallback', frontmatter('Fallback-only'));

    try {
      let loader = new SkillLoader(tempDir, [fallbackDir]);
      let index = await loader.buildIndex();

      assert.deepEqual(index, [
        { name: 'only-fallback', description: 'Fallback-only' },
        { name: 'shared', description: 'Primary description' },
      ]);
    } finally {
      rmSync(fallbackDir, { recursive: true, force: true });
    }
  });

  test('buildIndex ignores plain files in a skills dir', async function (assert) {
    writeSkill(tempDir, 'real-skill', frontmatter('A real skill'));
    writeFileSync(join(tempDir, 'glossary.md'), '# Not a skill dir', 'utf8');

    let loader = new SkillLoader(tempDir, []);
    let index = await loader.buildIndex();

    assert.deepEqual(
      index.map((entry) => entry.name),
      ['real-skill'],
    );
  });

  test('readSkill returns content plus reference filenames', async function (assert) {
    writeSkill(tempDir, 'with-refs', frontmatter('Skill with refs'), {
      references: {
        'guide-a.md': 'Guide A content',
        'guide-b.md': 'Guide B content',
      },
    });

    let loader = new SkillLoader(tempDir, []);
    let result = await loader.readSkill('with-refs');

    assert.strictEqual(result.name, 'with-refs');
    assert.true(result.content.includes('# Body'));
    assert.deepEqual(result.referenceFiles, ['guide-a.md', 'guide-b.md']);
  });

  test('readReference returns a single named reference', async function (assert) {
    writeSkill(tempDir, 'with-refs', frontmatter('Skill with refs'), {
      references: {
        'guide-a.md': 'Guide A content',
      },
    });

    let loader = new SkillLoader(tempDir, []);
    let content = await loader.readReference('with-refs', 'guide-a.md');

    assert.strictEqual(content, 'Guide A content');
  });

  test('library dirs fully replace the on-demand library', async function (assert) {
    let libraryDir = createTempSkillsDir();
    writeSkill(tempDir, 'bundled-only', frontmatter('Bundled skill'));
    writeSkill(tempDir, 'shared', frontmatter('Bundled description'));
    writeSkill(libraryDir, 'shared', frontmatter('Library description'));
    writeSkill(libraryDir, 'library-only', frontmatter('Only in the library'));

    try {
      let loader = new SkillLoader(tempDir, [], { libraryDirs: [libraryDir] });

      let index = await loader.buildIndex();
      assert.deepEqual(
        index,
        [
          { name: 'library-only', description: 'Only in the library' },
          { name: 'shared', description: 'Library description' },
        ],
        'bundled skills are not indexed at all',
      );

      let read = await loader.readSkill('shared');
      assert.true(
        read.content.includes('Library description'),
        'readSkill serves the library version',
      );

      try {
        await loader.readSkill('bundled-only');
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.true(
          err instanceof SkillLoadError,
          'bundled skills are unreadable when the library is overridden',
        );
      }

      // Front-loaded skills are unaffected by the override.
      let frontLoaded = await loader.load('bundled-only');
      assert.true(
        frontLoaded.content.includes('Bundled skill'),
        'load() still resolves from the bundled sources',
      );
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  test('no exclusion filtering in an override library', async function (assert) {
    let libraryDir = createTempSkillsDir();
    writeSkill(libraryDir, 'realm-sync', frontmatter('Curated sync skill'));

    try {
      let loader = new SkillLoader(tempDir, [], { libraryDirs: [libraryDir] });
      let index = await loader.buildIndex();

      assert.deepEqual(
        index.map((entry) => entry.name),
        ['realm-sync'],
        'the operator-curated library is not filtered',
      );
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  test('an override library with no skills fails fast', async function (assert) {
    let emptyDir = createTempSkillsDir();

    try {
      let loader = new SkillLoader(tempDir, [], { libraryDirs: [emptyDir] });
      try {
        await loader.buildIndex();
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.true(err instanceof SkillLoadError);
        assert.true(
          (err as Error).message.includes('--skills-dir'),
          'error names the flag',
        );
      }
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test('readReference rejects unknown filenames and lists available ones', async function (assert) {
    writeSkill(tempDir, 'with-refs', frontmatter('Skill with refs'), {
      references: {
        'guide-a.md': 'Guide A content',
      },
    });

    let loader = new SkillLoader(tempDir, []);
    try {
      await loader.readReference('with-refs', '../../../etc/passwd');
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof SkillLoadError);
      assert.true(
        (err as Error).message.includes('guide-a.md'),
        'error lists the available reference filenames',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatterDescription
// ---------------------------------------------------------------------------

module('factory-skill-loader > parseFrontmatterDescription', function () {
  test('extracts a plain description', function (assert) {
    assert.strictEqual(
      parseFrontmatterDescription('---\ndescription: Does things\n---\n# Hi'),
      'Does things',
    );
  });

  test('strips surrounding quotes', function (assert) {
    assert.strictEqual(
      parseFrontmatterDescription('---\ndescription: "Quoted value"\n---\n'),
      'Quoted value',
    );
  });

  test('handles frontmatter with other fields', function (assert) {
    assert.strictEqual(
      parseFrontmatterDescription(
        '---\nname: my-skill\ndescription: The description\nboxel:\n  kind: skill\n---\n',
      ),
      'The description',
    );
  });

  test('returns undefined without frontmatter or description', function (assert) {
    assert.strictEqual(
      parseFrontmatterDescription('# Just a heading'),
      undefined,
    );
    assert.strictEqual(
      parseFrontmatterDescription('---\nname: no-description\n---\n'),
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

module('factory-skill-loader > estimateTokens', function () {
  test('estimates tokens from content length', function (assert) {
    let skill: ResolvedSkill = {
      name: 'test',
      content: 'a'.repeat(400), // 400 chars / 4 = 100 tokens
    };

    assert.strictEqual(estimateTokens(skill), 100);
  });

  test('includes references in token estimate', function (assert) {
    let skill: ResolvedSkill = {
      name: 'test',
      content: 'a'.repeat(400), // 100 tokens
      references: [
        'b'.repeat(200), // 50 tokens
        'c'.repeat(200), // 50 tokens
      ],
    };

    assert.strictEqual(estimateTokens(skill), 200);
  });

  test('rounds up partial tokens', function (assert) {
    let skill: ResolvedSkill = {
      name: 'test',
      content: 'abc', // 3 chars / 4 = 0.75 → ceil = 1
    };

    assert.strictEqual(estimateTokens(skill), 1);
  });
});

// ---------------------------------------------------------------------------
// enforceSkillBudget
// ---------------------------------------------------------------------------

module('factory-skill-loader > enforceSkillBudget', function () {
  test('returns all skills when no budget is set', function (assert) {
    let skills: ResolvedSkill[] = [
      { name: 'skill-a', content: 'a'.repeat(10000) },
      { name: 'skill-b', content: 'b'.repeat(10000) },
    ];

    let result = enforceSkillBudget(skills, undefined);
    assert.strictEqual(result.length, 2, 'all skills returned');
  });

  test('returns all skills when budget is zero', function (assert) {
    let skills: ResolvedSkill[] = [
      { name: 'skill-a', content: 'a'.repeat(100) },
    ];

    let result = enforceSkillBudget(skills, 0);
    assert.strictEqual(result.length, 1, 'all skills returned for zero budget');
  });

  test('drops low-priority skills when over budget', function (assert) {
    let warnings: string[] = [];
    let originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };

    try {
      let skills: ResolvedSkill[] = [
        { name: 'software-factory-bootstrap', content: 'a'.repeat(2000) }, // 500 tokens
        { name: 'software-factory-operations', content: 'b'.repeat(2000) }, // 500 tokens
        { name: 'low-priority-test-skill', content: 'c'.repeat(2000) }, // 500 tokens
      ];

      // Budget of 1000 tokens — can fit first two but not third
      let result = enforceSkillBudget(skills, 1000);

      assert.strictEqual(result.length, 2, 'only two skills fit');
      assert.strictEqual(
        result[0].name,
        'software-factory-bootstrap',
        'highest priority kept',
      );
      assert.strictEqual(
        result[1].name,
        'software-factory-operations',
        'second priority kept',
      );
      assert.true(
        warnings.some((w) => w.includes('low-priority-test-skill')),
        'logged warning about dropped skill',
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  test('sorts skills by priority before applying budget', function (assert) {
    let originalWarn = console.warn;
    console.warn = () => {}; // suppress warnings

    try {
      let skills: ResolvedSkill[] = [
        // Present in reverse priority order
        { name: 'low-priority-test-skill', content: 'c'.repeat(2000) }, // not in SKILL_PRIORITY → lowest
        { name: 'software-factory-operations', content: 'b'.repeat(2000) }, // priority 2
        { name: 'software-factory-bootstrap', content: 'a'.repeat(2000) }, // priority 1
      ];

      // Budget enough for only 2 skills
      let result = enforceSkillBudget(skills, 1000);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(
        result[0].name,
        'software-factory-bootstrap',
        'highest priority first',
      );
      assert.strictEqual(
        result[1].name,
        'software-factory-operations',
        'second priority second',
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  test('unknown skills get lowest priority', function (assert) {
    let originalWarn = console.warn;
    console.warn = () => {};

    try {
      let skills: ResolvedSkill[] = [
        { name: 'unknown-skill', content: 'x'.repeat(2000) }, // not in priority list
        { name: 'software-factory-operations', content: 'a'.repeat(2000) },
      ];

      let result = enforceSkillBudget(skills, 600);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(
        result[0].name,
        'software-factory-operations',
        'known skill kept over unknown',
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// Re-resolution on new issue
// ---------------------------------------------------------------------------

module('factory-skill-loader > re-resolution on new issue', function () {
  test('resolver produces different suggestions for different issues', function (assert) {
    let resolver = new DefaultSkillResolver();
    let project = makeProject();

    let issue1 = makeIssue({
      description: 'Create a .gts component for the landing page',
    });
    let issue2 = makeIssue({
      description: 'Improve the factory delivery pipeline',
    });

    let resolution1 = resolver.resolve(issue1, project);
    let resolution2 = resolver.resolve(issue2, project);

    assert.true(
      resolution1.suggested.includes('boxel-ui-guidelines'),
      'issue1 gets UI suggestions',
    );
    assert.true(
      resolution1.load.includes('software-factory-operations'),
      'issue1 front-loads software-factory-operations',
    );
    assert.true(
      resolution2.load.includes('software-factory-operations'),
      'issue2 front-loads software-factory-operations',
    );
    assert.false(
      resolution2.suggested.includes('boxel-ui-guidelines'),
      'issue2 does not get UI suggestions',
    );
  });

  test('cache can be cleared between issues for fresh loading', async function (assert) {
    tempDir = createTempSkillsDir();
    writeSkill(tempDir, 'boxel-development', '# Dev v1');

    let loader = new SkillLoader(tempDir, []);
    let first = await loader.load('boxel-development');
    assert.true(first.content.includes('Dev v1'));

    // Simulate moving to a new issue: clear cache, potentially new skill content
    writeSkill(tempDir, 'boxel-development', '# Dev v2');
    loader.clearCache();

    let second = await loader.load('boxel-development');
    assert.true(second.content.includes('Dev v2'), 'picks up new content');

    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
