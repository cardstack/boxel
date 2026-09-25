import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import QUnit from 'qunit';
const { module, test } = QUnit;

import { ClaudeCodeFactoryAgent } from '../src/factory-agent/claude-code.ts';
import {
  OpencodeFactoryAgent,
  type OpencodeAgentConfig,
} from '../src/factory-agent/opencode.ts';
import type { AgentContext } from '../src/factory-agent/index.ts';
import { DefaultSkillResolver } from '../src/factory-skill-loader.ts';
import { readSkillOnDemand } from '../src/skill-catalog.ts';
import type { IssueData, ProjectData } from '../src/factory-agent/index.ts';

// Everything this file guards shares one shape: a thing declared in one place
// and not delivered on the path that runs. The flag existed and was threaded
// into a prompt-assembly helper used only by tests, so every
// `{{#if enableCatalogReuse}}` block rendered false in production while the
// flag read `true` — a state no assertion about the flag can distinguish from
// a working one. So these render through the real backends.

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    project: { id: 'Projects/p' },
    issue: { id: 'Issues/i' },
    knowledge: [],
    skills: [],
    tools: [],
    targetRealm: 'https://realms.example.test/user/target/',
    darkfactoryModuleUrl:
      'https://realms.example.test/software-factory/darkfactory',
    ...overrides,
  } as AgentContext;
}

/**
 * Render a backend's system prompt the way `run()` does. `buildSystemPrompt`
 * is private because nothing but the run path should call it — which is the
 * reason to reach it here rather than re-implement what it does.
 */
function renderClaude(context: AgentContext): string {
  let agent = new ClaudeCodeFactoryAgent();
  return (
    agent as unknown as {
      buildSystemPrompt(c: AgentContext, tools: unknown[]): string;
    }
  ).buildSystemPrompt(context, []);
}

function renderOpenCode(context: AgentContext): string {
  // Only the prompt loader is exercised here; the model/realm/client config
  // belongs to the paths that talk to opencode, which this never reaches.
  let agent = new OpencodeFactoryAgent({
    model: 'test/model',
    realmServerUrl: 'https://realms.example.test/',
    workspaceDir: '/tmp/unused',
    client: undefined as unknown as OpencodeAgentConfig['client'],
  });
  return (
    agent as unknown as { buildSystemPrompt(c: AgentContext): string }
  ).buildSystemPrompt(context);
}

const BACKENDS: [string, (c: AgentContext) => string][] = [
  ['claude-code', renderClaude],
  ['opencode', renderOpenCode],
];

module('catalog reuse > system prompt delivery', function () {
  for (let [name, render] of BACKENDS) {
    test(`${name} renders the reuse block when the flag is on`, function (assert) {
      let prompt = render(makeContext({ enableCatalogReuse: true }));

      assert.true(
        prompt.includes('Exception — the catalog (mandatory)'),
        'the firewall exception is present',
      );
      assert.true(
        prompt.includes('catalog-reuse'),
        'the prompt names the skill that carries the method',
      );
      for (let specType of ['`card`', '`field`', '`component`', '`command`']) {
        assert.true(
          prompt.includes(specType),
          `the sanctioned search covers specType ${specType}`,
        );
      }
    });

    // The transport is `boxel search --realm <url>`, where `--realm` is
    // required. A mandate to search with no address is not a mandate.
    test(`${name} renders the catalog realm URL alongside the mandate`, function (assert) {
      let prompt = render(makeContext({ enableCatalogReuse: true }));
      assert.true(
        prompt.includes('https://realms.example.test/catalog/'),
        'the catalog URL is rendered, not left to the agent to guess',
      );
    });

    test(`${name} closes the firewall when the flag is off`, function (assert) {
      let prompt = render(makeContext({ enableCatalogReuse: false }));
      assert.false(
        prompt.includes('Exception — the catalog (mandatory)'),
        'no reuse mandate',
      );
      assert.true(
        prompt.includes('not catalog'),
        'the catalog is named among the realms not to read',
      );
    });

    test(`${name} leaves no unrendered handlebars in either flag state`, function (assert) {
      for (let enabled of [true, false]) {
        let prompt = render(makeContext({ enableCatalogReuse: enabled }));
        assert.false(
          prompt.includes('{{'),
          `no unrendered template syntax with the flag ${enabled}`,
        );
      }
    });
  }

  // With one flag there is no state in which the old closing sentence is
  // true, so it is deleted rather than made conditional.
  test('the prompt no longer claims component specs are the only sanctioned read', function (assert) {
    let prompt = renderClaude(makeContext({ enableCatalogReuse: true }));
    assert.false(
      prompt.includes('only sanctioned cross-realm read'),
      'the single-exception claim is gone',
    );
  });
});

module('catalog reuse > skill delivery', function () {
  function resolve(issueType: string): string[] {
    return new DefaultSkillResolver().resolve(
      { id: 'Issues/i', issueType } as unknown as IssueData,
      { id: 'Projects/p' } as unknown as ProjectData,
    );
  }

  test('an implementation issue gets the reuse skills in its core', function (assert) {
    let skills = resolve('feature');
    assert.true(skills.includes('catalog-reuse'), 'catalog-reuse is selected');
    assert.true(
      skills.includes('boxel-ui-component-discovery'),
      'boxel-ui-component-discovery is selected',
    );
  });

  // The design turn writes the binding hand-off. A reuse decision it does not
  // make is one the build turn cannot make either, because by then the schema
  // is a contract rather than a variable.
  test('a design issue gets the reuse skills too', function (assert) {
    let skills = resolve('design');
    assert.true(skills.includes('catalog-reuse'), 'catalog-reuse is selected');
    assert.true(
      skills.includes('boxel-ui-component-discovery'),
      'boxel-ui-component-discovery is selected',
    );
  });

  // Naming a skill no directory supplies is silent: the loader warns and
  // continues, and the turn runs with a mandate and no method.
  test('every skill the resolver names actually resolves', async function (assert) {
    let named = new Set([
      ...resolve('feature'),
      ...resolve('design'),
      ...resolve('bootstrap'),
      ...resolve('analysis'),
    ]);

    for (let skill of named) {
      let result = await readSkillOnDemand(skill);
      assert.true(
        result.content.length > 0,
        `${skill} resolves to a readable SKILL.md`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The routing table
// ---------------------------------------------------------------------------

// The operations skill's "when you need X, read Y" table is the routing layer
// the reuse mandate depends on: a row is an instruction to call
// `read_skill({ name })`, and a name nothing supplies makes that call throw.
// Four rows pointed at a skill that had been renamed, one of them marked
// MANDATORY. Nothing noticed, because a table is prose until something reads
// it.
module('catalog reuse > operations routing table', function () {
  const SKILL_PATH = join(
    import.meta.dirname,
    '..',
    '.agents',
    'skills-orchestrator',
    'software-factory-operations',
    'SKILL.md',
  );

  test('every skill the table points at resolves', async function (assert) {
    let contents = await readFile(SKILL_PATH, 'utf8');
    let table = contents.slice(
      contents.indexOf('## When you need X, read Y'),
      contents.indexOf('## Required flow'),
    );

    // The second column of each row is a `read_skill` name in backticks.
    let names = new Set<string>();
    for (let line of table.split('\n')) {
      let cells = line.split('|');
      if (cells.length < 3) continue;
      let match = /`([a-z0-9-]+)`/.exec(cells[2]);
      if (match) names.add(match[1]);
    }

    assert.true(names.size >= 10, 'the scan still reads the table');
    assert.true(
      names.has('catalog-reuse'),
      'the table routes to the reuse skill',
    );

    for (let name of names) {
      let result = await readSkillOnDemand(name);
      assert.true(result.content.length > 0, `${name} resolves`);
    }
  });

  test('every reference the table names exists on its skill', async function (assert) {
    let contents = await readFile(SKILL_PATH, 'utf8');
    let referenced = [
      ...contents.matchAll(/`([a-z0-9-]+)` reference `([^`]+)`/g),
    ];

    assert.true(referenced.length > 0, 'the scan still finds reference rows');
    for (let [, skill, reference] of referenced) {
      let result = await readSkillOnDemand(skill);
      assert.true(
        result.references.includes(reference),
        `${skill} supplies ${reference}`,
      );
    }
  });
});
