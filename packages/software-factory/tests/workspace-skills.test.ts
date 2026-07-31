import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  materializeWorkspaceSkills,
  materializeWorkspaceClaudeMd,
} from '../src/workspace-skills.ts';

module('workspace-skills > materializeWorkspaceSkills', function (hooks) {
  let workspaceDir: string;
  let catalogA: string;
  let catalogB: string;

  hooks.beforeEach(async function () {
    workspaceDir = await mkdtemp(join(tmpdir(), 'ws-skills-test-ws-'));
    catalogA = await mkdtemp(join(tmpdir(), 'ws-skills-test-a-'));
    catalogB = await mkdtemp(join(tmpdir(), 'ws-skills-test-b-'));
  });

  hooks.afterEach(async function () {
    for (let d of [workspaceDir, catalogA, catalogB]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  async function makeSkill(
    root: string,
    name: string,
    body: string,
    refs?: Record<string, string>,
  ): Promise<void> {
    await mkdir(join(root, name, 'references'), { recursive: true });
    await writeFile(join(root, name, 'SKILL.md'), body);
    for (let [ref, content] of Object.entries(refs ?? {})) {
      await writeFile(join(root, name, 'references', ref), content);
    }
  }

  test('copies skills with SKILL.md and references into .claude/skills', async function (assert) {
    await makeSkill(catalogA, 'boxel-development', '# dev skill', {
      'dev-fitted-formats.md': '# fitted standard',
    });

    let count = await materializeWorkspaceSkills(workspaceDir, [catalogA]);

    assert.strictEqual(count, 1);
    assert.strictEqual(
      await readFile(
        join(
          workspaceDir,
          '.claude',
          'skills',
          'boxel-development',
          'SKILL.md',
        ),
        'utf8',
      ),
      '# dev skill',
    );
    assert.strictEqual(
      await readFile(
        join(
          workspaceDir,
          '.claude',
          'skills',
          'boxel-development',
          'references',
          'dev-fitted-formats.md',
        ),
        'utf8',
      ),
      '# fitted standard',
      'reference docs come along — greppable in the workspace',
    );
  });

  test('earlier catalog dirs win on name collision (loader precedence)', async function (assert) {
    await makeSkill(catalogA, 'shared-skill', '# primary version');
    await makeSkill(catalogB, 'shared-skill', '# fallback version');

    await materializeWorkspaceSkills(workspaceDir, [catalogA, catalogB]);

    assert.strictEqual(
      await readFile(
        join(workspaceDir, '.claude', 'skills', 'shared-skill', 'SKILL.md'),
        'utf8',
      ),
      '# primary version',
    );
  });

  test('skips directories without a SKILL.md', async function (assert) {
    await mkdir(join(catalogA, 'not-a-skill'), { recursive: true });
    await writeFile(join(catalogA, 'not-a-skill', 'notes.txt'), 'x');
    await makeSkill(catalogA, 'real-skill', '# real');

    let count = await materializeWorkspaceSkills(workspaceDir, [catalogA]);

    assert.strictEqual(count, 1);
    let names = await readdir(join(workspaceDir, '.claude', 'skills'));
    assert.deepEqual(names.sort(), ['real-skill']);
  });

  test('is idempotent and refreshes content on re-run', async function (assert) {
    await makeSkill(catalogA, 'a-skill', '# v1');
    await materializeWorkspaceSkills(workspaceDir, [catalogA]);
    await writeFile(join(catalogA, 'a-skill', 'SKILL.md'), '# v2');

    let count = await materializeWorkspaceSkills(workspaceDir, [catalogA]);

    assert.strictEqual(count, 1);
    assert.strictEqual(
      await readFile(
        join(workspaceDir, '.claude', 'skills', 'a-skill', 'SKILL.md'),
        'utf8',
      ),
      '# v2',
    );
  });

  test('missing catalog dirs are tolerated', async function (assert) {
    let count = await materializeWorkspaceSkills(workspaceDir, [
      join(catalogA, 'does-not-exist'),
    ]);

    assert.strictEqual(count, 0);
  });
});

module('workspace-skills > materializeWorkspaceClaudeMd', function (hooks) {
  let workspaceDir: string;
  let sourceDir: string;

  hooks.beforeEach(async function () {
    workspaceDir = await mkdtemp(join(tmpdir(), 'ws-claude-md-test-ws-'));
    sourceDir = await mkdtemp(join(tmpdir(), 'ws-claude-md-test-src-'));
  });

  hooks.afterEach(async function () {
    for (let d of [workspaceDir, sourceDir]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  test('writes CLAUDE.md and a sync-ignore entry', async function (assert) {
    let src = join(sourceDir, 'workspace-CLAUDE.md');
    await writeFile(src, '# Boxel conventions');

    let ok = await materializeWorkspaceClaudeMd(workspaceDir, src);

    assert.true(ok);
    assert.strictEqual(
      await readFile(join(workspaceDir, 'CLAUDE.md'), 'utf8'),
      '# Boxel conventions',
    );
    let ignore = await readFile(join(workspaceDir, '.boxelignore'), 'utf8');
    assert.true(
      ignore.includes('/CLAUDE.md'),
      'a root CLAUDE.md would otherwise sync to the product realm',
    );
  });

  test('appends to an existing .boxelignore without clobbering, idempotently', async function (assert) {
    let src = join(sourceDir, 'workspace-CLAUDE.md');
    await writeFile(src, '# conventions');
    await writeFile(
      join(workspaceDir, '.boxelignore'),
      '# control-plane block\n/Issues/\n',
    );

    await materializeWorkspaceClaudeMd(workspaceDir, src);
    await materializeWorkspaceClaudeMd(workspaceDir, src);

    let ignore = await readFile(join(workspaceDir, '.boxelignore'), 'utf8');
    assert.true(ignore.includes('/Issues/'), 'existing entries preserved');
    assert.strictEqual(
      ignore.split('/CLAUDE.md').length - 1,
      1,
      'CLAUDE.md entry appended exactly once across repeat runs',
    );
  });

  test('missing source template is tolerated', async function (assert) {
    let ok = await materializeWorkspaceClaudeMd(
      workspaceDir,
      join(sourceDir, 'nope.md'),
    );

    assert.false(ok);
  });
});
