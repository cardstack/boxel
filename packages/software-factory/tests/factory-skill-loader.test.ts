import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { module, test } from 'qunit';

import type {
  ProjectCard,
  ResolvedSkill,
  TicketCard,
} from '../scripts/lib/factory-agent';
import {
  DefaultSkillResolver,
  SkillLoader,
  SkillLoadError,
  enforceSkillBudget,
  estimateTokens,
  extractTicketText,
} from '../scripts/lib/factory-skill-loader';

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

function makeTicket(overrides?: Partial<TicketCard>): TicketCard {
  return {
    id: 'Tickets/test-ticket',
    title: 'Test ticket',
    description: 'A test ticket for unit testing',
    ...overrides,
  };
}

function makeProject(overrides?: Partial<ProjectCard>): ProjectCard {
  return {
    id: 'Projects/test-project',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DefaultSkillResolver
// ---------------------------------------------------------------------------

module('factory-skill-loader > DefaultSkillResolver', function () {
  test('always includes boxel-development and boxel-file-structure', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket({ description: 'Generic task with no keywords' });
    let project = makeProject();

    let skills = resolver.resolve(ticket, project);

    assert.true(
      skills.includes('boxel-development'),
      'includes boxel-development',
    );
    assert.true(
      skills.includes('boxel-file-structure'),
      'includes boxel-file-structure',
    );
  });

  test('includes ember-best-practices when ticket mentions .gts', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket({
      description: 'Create a new card definition in .gts format',
    });
    let project = makeProject();

    let skills = resolver.resolve(ticket, project);

    assert.true(
      skills.includes('ember-best-practices'),
      'includes ember-best-practices for .gts work',
    );
  });

  test('includes ember-best-practices when ticket mentions component', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket({
      description: 'Build a new component for the dashboard',
    });
    let project = makeProject();

    let skills = resolver.resolve(ticket, project);

    assert.true(
      skills.includes('ember-best-practices'),
      'includes ember-best-practices for component work',
    );
  });

  test('includes ember-best-practices when ticket mentions CardDef', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket({
      title: 'Define a new CardDef for employees',
    });
    let project = makeProject();

    let skills = resolver.resolve(ticket, project);

    assert.true(
      skills.includes('ember-best-practices'),
      'includes ember-best-practices for CardDef work',
    );
  });

  test('includes software-factory-operations for delivery workflow tickets', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket({
      description: 'Improve the factory delivery pipeline',
    });
    let project = makeProject();

    let skills = resolver.resolve(ticket, project);

    assert.true(
      skills.includes('software-factory-operations'),
      'includes software-factory-operations for factory workflow',
    );
  });

  test('excludes CLI-only skills even when ticket mentions sync', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket({
      description: 'Sync the workspace after local edits',
    });
    let project = makeProject();

    let skills = resolver.resolve(ticket, project);

    assert.false(
      skills.includes('boxel-sync'),
      'boxel-sync excluded (CLI-only skill)',
    );
  });

  test('excludes CLI-only skills even when ticket mentions restore', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket({
      description: 'Restore workspace to a previous checkpoint',
    });
    let project = makeProject();

    let skills = resolver.resolve(ticket, project);

    assert.false(
      skills.includes('boxel-restore'),
      'boxel-restore excluded (CLI-only skill)',
    );
  });

  test('excludes all CLI-only skills even when ticket mentions multiple CLI operations', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket({
      description: 'Sync the workspace, track changes, and watch for updates',
    });
    let project = makeProject();

    let skills = resolver.resolve(ticket, project);

    assert.false(skills.includes('boxel-sync'), 'boxel-sync excluded');
    assert.false(skills.includes('boxel-track'), 'boxel-track excluded');
    assert.false(skills.includes('boxel-watch'), 'boxel-watch excluded');
  });

  test('excludes CLI-only skills even when added via knowledge article tags', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket();
    let project = makeProject({
      knowledge: [
        {
          id: 'Knowledge Articles/cli-ref',
          tags: ['skill:boxel-sync', 'skill:boxel-repair'],
        },
      ],
    });

    let skills = resolver.resolve(ticket, project);

    assert.false(
      skills.includes('boxel-sync'),
      'boxel-sync excluded even from knowledge tags',
    );
    assert.false(
      skills.includes('boxel-repair'),
      'boxel-repair excluded even from knowledge tags',
    );
  });

  test('extracts additional skills from knowledge article tags', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket();
    let project = makeProject({
      knowledge: [
        {
          id: 'Knowledge Articles/custom',
          tags: ['skill:custom-skill', 'not-a-skill'],
        },
      ],
    });

    let skills = resolver.resolve(ticket, project);

    assert.true(
      skills.includes('custom-skill'),
      'includes skill from knowledge article tag',
    );
  });

  test('extracts additional skills from knowledge article skills array', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket();
    let project = makeProject({
      knowledge: [
        {
          id: 'Knowledge Articles/custom',
          skills: ['extra-skill-a', 'extra-skill-b'],
        },
      ],
    });

    let skills = resolver.resolve(ticket, project);

    assert.true(skills.includes('extra-skill-a'), 'includes extra-skill-a');
    assert.true(skills.includes('extra-skill-b'), 'includes extra-skill-b');
  });

  test('reads skills from knowledgeBase field (Project schema)', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket();
    let project = makeProject({
      knowledgeBase: [
        {
          id: 'Knowledge Articles/from-schema',
          skills: ['schema-skill'],
        },
      ],
    });

    let skills = resolver.resolve(ticket, project);

    assert.true(
      skills.includes('schema-skill'),
      'includes skill from knowledgeBase field',
    );
  });

  test('reads skills from relatedKnowledge field (Ticket schema)', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket({
      relatedKnowledge: [
        {
          id: 'Knowledge Articles/ticket-knowledge',
          tags: ['skill:ticket-skill'],
        },
      ],
    });
    let project = makeProject();

    let skills = resolver.resolve(ticket, project);

    assert.true(
      skills.includes('ticket-skill'),
      'includes skill from ticket relatedKnowledge',
    );
  });

  test('does not duplicate skills', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket({
      description: 'Create a .gts component with template patterns',
    });
    let project = makeProject({
      knowledge: [
        {
          id: 'Knowledge Articles/dup',
          skills: ['boxel-development'],
        },
      ],
    });

    let skills = resolver.resolve(ticket, project);
    let devCount = skills.filter((s) => s === 'boxel-development').length;
    assert.strictEqual(devCount, 1, 'boxel-development appears only once');
  });

  test('reads ticket text from title, description, tags, and labels', function (assert) {
    let ticket = makeTicket({
      title: 'Fix the component rendering',
      description: 'The template is broken',
      tags: ['ember', 'glimmer'],
      labels: [{ name: 'bug' }],
    });

    let text = extractTicketText(ticket);

    assert.true(text.includes('fix the component rendering'));
    assert.true(text.includes('the template is broken'));
    assert.true(text.includes('ember'));
    assert.true(text.includes('glimmer'));
    assert.true(text.includes('bug'));
  });

  test('handles project with no knowledge array', function (assert) {
    let resolver = new DefaultSkillResolver();
    let ticket = makeTicket();
    let project = makeProject(); // no knowledge field

    let skills = resolver.resolve(ticket, project);

    // Should still resolve the base skills without error
    assert.true(skills.includes('boxel-development'));
    assert.true(skills.includes('boxel-file-structure'));
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

  test('filters boxel-development references by ticket when loaded with ticket', async function (assert) {
    // Set up a boxel-development skill with references matching the real structure
    writeSkill(tempDir, 'boxel-development', '# Boxel Development', {
      references: {
        'dev-core-concept.md': 'Core concept content',
        'dev-technical-rules.md': 'Technical rules content',
        'dev-quick-reference.md': 'Quick reference content',
        'dev-styling-design.md': 'Styling design content',
        'dev-file-editing.md': 'File editing content',
        'dev-query-systems.md': 'Query systems content',
      },
    });

    let loader = new SkillLoader(tempDir, []);

    // Load WITHOUT ticket — should get all references
    let allRefs = await loader.load('boxel-development');
    assert.strictEqual(
      allRefs.references!.length,
      6,
      'all 6 references loaded without ticket',
    );

    // Load WITH a styling ticket — should get always-load + styling only
    loader.clearCache();
    let stylingTicket = makeTicket({
      description: 'Fix the CSS styling on the card',
    });
    let filtered = await loader.load('boxel-development', stylingTicket);

    assert.true(
      filtered.references!.length < 6,
      'fewer references with ticket filtering',
    );
    // Always-load refs should be present
    assert.true(
      filtered.references!.some((r) => r.includes('Core concept')),
      'always-load ref included',
    );
    // Styling ref should be present (keyword match)
    assert.true(
      filtered.references!.some((r) => r.includes('Styling design')),
      'keyword-matched ref included',
    );
    // File editing ref should NOT be present (no keyword match, not always-load)
    assert.false(
      filtered.references!.some((r) => r.includes('File editing')),
      'non-matching ref excluded',
    );
  });

  test('reference filtering works without budget (no-budget path)', async function (assert) {
    // Verifies the P1 fix: callers that omit maxSkillTokens still get
    // ticket-relevant references, not all 19. The filtering happens at load
    // time, so enforceSkillBudget(skills, undefined) returns already-filtered
    // skills — no budget required.
    writeSkill(tempDir, 'boxel-development', '# Boxel Development', {
      references: {
        'dev-core-concept.md': 'Core concept content',
        'dev-technical-rules.md': 'Technical rules content',
        'dev-quick-reference.md': 'Quick reference content',
        'dev-styling-design.md': 'Styling design content',
        'dev-file-editing.md': 'File editing content',
        'dev-query-systems.md': 'Query systems content',
      },
    });

    let loader = new SkillLoader(tempDir, []);
    let ticket = makeTicket({
      description: 'Fix the CSS styling on the card',
    });

    // Load with ticket — filtering happens at load time
    let skills = await loader.loadAll(['boxel-development'], ticket);
    assert.strictEqual(skills.length, 1);

    // Pass through enforceSkillBudget with NO budget (undefined)
    let result = enforceSkillBudget(skills, undefined);

    // Should still have the filtered references from load time
    assert.strictEqual(result.length, 1);
    assert.true(
      result[0].references!.length < 6,
      'references were filtered at load time even without budget',
    );
    assert.true(
      result[0].references!.some((r) => r.includes('Core concept')),
      'always-load ref present in no-budget path',
    );
    assert.true(
      result[0].references!.some((r) => r.includes('Styling design')),
      'keyword-matched ref present in no-budget path',
    );
    assert.false(
      result[0].references!.some((r) => r.includes('File editing')),
      'non-matching ref excluded in no-budget path',
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
        { name: 'boxel-development', content: 'a'.repeat(2000) }, // 500 tokens
        { name: 'boxel-file-structure', content: 'b'.repeat(2000) }, // 500 tokens
        { name: 'boxel-sync', content: 'c'.repeat(2000) }, // 500 tokens
      ];

      // Budget of 1000 tokens — can fit first two but not third
      let result = enforceSkillBudget(skills, 1000);

      assert.strictEqual(result.length, 2, 'only two skills fit');
      assert.strictEqual(
        result[0].name,
        'boxel-development',
        'highest priority kept',
      );
      assert.strictEqual(
        result[1].name,
        'boxel-file-structure',
        'second priority kept',
      );
      assert.true(
        warnings.some((w) => w.includes('boxel-sync')),
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
        { name: 'boxel-sync', content: 'c'.repeat(2000) }, // priority 4
        { name: 'boxel-file-structure', content: 'b'.repeat(2000) }, // priority 1
        { name: 'boxel-development', content: 'a'.repeat(2000) }, // priority 0
      ];

      // Budget enough for only 2 skills
      let result = enforceSkillBudget(skills, 1000);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(
        result[0].name,
        'boxel-development',
        'highest priority first',
      );
      assert.strictEqual(
        result[1].name,
        'boxel-file-structure',
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
        { name: 'boxel-development', content: 'a'.repeat(2000) },
      ];

      let result = enforceSkillBudget(skills, 600);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(
        result[0].name,
        'boxel-development',
        'known skill kept over unknown',
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// Re-resolution on new ticket
// ---------------------------------------------------------------------------

module('factory-skill-loader > re-resolution on new ticket', function () {
  test('resolver produces different skills for different tickets', function (assert) {
    let resolver = new DefaultSkillResolver();
    let project = makeProject();

    let ticket1 = makeTicket({
      description: 'Create a .gts component for the landing page',
    });
    let ticket2 = makeTicket({
      description: 'Improve the factory delivery pipeline',
    });

    let skills1 = resolver.resolve(ticket1, project);
    let skills2 = resolver.resolve(ticket2, project);

    assert.true(
      skills1.includes('ember-best-practices'),
      'ticket1 gets ember-best-practices',
    );
    assert.false(
      skills1.includes('software-factory-operations'),
      'ticket1 does not get software-factory-operations',
    );

    assert.true(
      skills2.includes('software-factory-operations'),
      'ticket2 gets software-factory-operations',
    );
    assert.false(
      skills2.includes('ember-best-practices'),
      'ticket2 does not get ember-best-practices',
    );
  });

  test('cache can be cleared between tickets for fresh loading', async function (assert) {
    tempDir = createTempSkillsDir();
    writeSkill(tempDir, 'boxel-development', '# Dev v1');

    let loader = new SkillLoader(tempDir, []);
    let first = await loader.load('boxel-development');
    assert.true(first.content.includes('Dev v1'));

    // Simulate moving to a new ticket: clear cache, potentially new skill content
    writeSkill(tempDir, 'boxel-development', '# Dev v2');
    loader.clearCache();

    let second = await loader.load('boxel-development');
    assert.true(second.content.includes('Dev v2'), 'picks up new content');

    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
