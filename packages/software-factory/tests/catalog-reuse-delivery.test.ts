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

// ---------------------------------------------------------------------------
// The reuse artifact contract
// ---------------------------------------------------------------------------

// Two prompts author cards: `issue-design.md` (the design half of a
// phase-split issue) and `issue-implement.md` (the single-turn path). A run
// takes one or the other, never both, so a rule added to one and forgotten in
// the other is delivered on half the runs and absent on the rest — and which
// half a given run got is not visible in its output. That asymmetry is what
// this module holds shut: every clause below is asserted against both files.
//
// These are the artifact requirements, which the prompt owns. Method — query
// shapes, how to judge a hit, what each specType entitles you to — belongs to
// the `catalog-reuse` skill and is deliberately not asserted here.
module('catalog reuse > artifact contract', function () {
  const AUTHORING_PROMPTS = ['issue-design.md', 'issue-implement.md'];

  async function readPrompt(name: string): Promise<string> {
    return readFile(join(import.meta.dirname, '..', 'prompts', name), 'utf8');
  }

  // A near miss with the right shape was refused as REUSE-BLOCKED because the
  // table offered no row type for specializing it, even though the skill
  // sanctions `extends` and the catalog's own cards are built that way.
  test('both authoring prompts offer EXTEND as a disposition', async function (assert) {
    for (let name of AUTHORING_PROMPTS) {
      let prompt = await readPrompt(name);
      assert.true(prompt.includes('`EXTEND`'), `${name} names EXTEND`);
      assert.true(
        /EXTEND[\s\S]{0,400}(subclass|adopt it as a base|specialize)/.test(
          prompt,
        ),
        `${name} says what EXTEND does`,
      );
    }
  });

  // A kind with no row reads exactly like a kind nobody searched. The first
  // run's table carried rows for the card and its fields only, against 62
  // components and 11 commands indexed.
  test('both authoring prompts require all four block kinds to be accounted for', async function (assert) {
    for (let name of AUTHORING_PROMPTS) {
      let prompt = await readPrompt(name);
      for (let kind of ['`card`', '`field`', '`component`', '`command`']) {
        assert.true(prompt.includes(kind), `${name} names the kind ${kind}`);
      }
      assert.true(
        prompt.includes('GAP'),
        `${name} offers GAP as the "nothing fitted" row`,
      );
      assert.true(
        /all four kinds|four block kinds/i.test(prompt),
        `${name} requires every kind to carry a row or an explicit GAP`,
      );
    }
  });

  // A conclusion drawn over a partial index is indistinguishable from one
  // drawn over a complete one unless the notes say what was searched.
  test('both authoring prompts require the searched scope in the notes', async function (assert) {
    for (let name of AUTHORING_PROMPTS) {
      let prompt = await readPrompt(name);
      assert.true(prompt.includes('searched:'), `${name} names the line`);
      assert.true(prompt.includes('CAVEAT:'), `${name} names the caveat form`);
    }
  });

  // Base-realm type selection belongs to no step unless a step claims it: the
  // reuse table correctly excludes base types, and the design turn did not own
  // them, so the concrete type was whatever the bootstrap issue text named.
  test('both authoring prompts own base-realm type selection', async function (assert) {
    for (let name of AUTHORING_PROMPTS) {
      let prompt = await readPrompt(name);
      assert.true(prompt.includes('Base types'), `${name} names the block`);
      assert.true(
        prompt.includes('type-fixed:'),
        `${name} carries the escape hatch that marks a real constraint`,
      );
      for (let type of ['EmailField', 'PhoneNumberField']) {
        assert.true(
          prompt.includes(type),
          `${name} names ${type}, which a bare string would otherwise absorb`,
        );
      }
    }
  });

  // Observed on a real run: the card adopted a catalog block, and the base type
  // that block supplied (`EmailField`, via `PersonBase`) was recorded as a
  // REFERENCE row in the Reuse decisions table — a base-realm module in a table
  // that is supposed to mean "a catalog block was considered". The rule excluding
  // base types was stated, but not for the case where the type arrives *through*
  // an adoption, which is exactly when it looks catalog-derived.
  test('a base type inherited through an adoption is not a reuse row', async function (assert) {
    for (let name of AUTHORING_PROMPTS) {
      let prompt = await readPrompt(name);
      assert.true(
        /inherit(ed)? through an adoption|inherited through an adoption|arrived through an adoption|inherit from an adopted block/i.test(
          prompt,
        ),
        `${name} covers the inherited-through-adoption case`,
      );
      assert.true(
        prompt.includes('inherited'),
        `${name} gives the Base types block a marker for it`,
      );
    }
  });

  // The same run asserted "No base-realm type appears in the Reuse decisions
  // table" directly beneath a table that contained one. An unchecked claim is
  // worse than a visible defect, because the claim is what a reviewer reads.
  test('the notes must check the base-realm rule rather than assert it', async function (assert) {
    for (let name of AUTHORING_PROMPTS) {
      let prompt = await readPrompt(name);
      assert.true(
        prompt.includes('https://cardstack.com/base/'),
        `${name} names the module prefix that makes the rule checkable`,
      );
      assert.true(
        /check (it |the table )?against/i.test(prompt),
        `${name} tells the turn to check the table, not just claim compliance`,
      );
    }
  });

  // The Base types block is only binding if the turn that writes the schema is
  // told it outranks the issue body.
  test('the build turn treats the Base types block as binding', async function (assert) {
    let prompt = await readPrompt('issue-build.md');
    assert.true(prompt.includes('Base types'), 'the block reaches the builder');
    assert.true(
      /overrides any\s+field type named in the issue body/.test(prompt),
      'the builder is told it outranks the issue text',
    );
    assert.true(
      prompt.includes('type-fixed:'),
      'the builder honours the one exception',
    );
  });

  // A build-local token vocabulary is one no external component can match, so
  // every presentational mismatch is structural rather than incidental.
  test('the design foundation resolves a platform Theme, not a private vocabulary', async function (assert) {
    let prompt = await readPrompt('issue-design-foundation.md');
    assert.true(prompt.includes('`Theme`'), 'the Theme card is named');
    assert.true(
      prompt.includes('never the source of truth'),
      'tokens.css is demoted to a mirror of the Theme',
    );
    assert.true(
      prompt.includes('cardInfo.theme'),
      'the wiring the build turn performs is named',
    );
  });

  test('the build turn links the Theme and keeps literals out of templates', async function (assert) {
    let prompt = await readPrompt('issue-build.md');
    assert.true(prompt.includes('cardInfo.theme'), 'the link is required');
    assert.true(
      /no color, font-family\s+or spacing literal/i.test(prompt),
      'literals are named as the defect',
    );
  });

  // The existing mitigation constrained negative bans only. Both presentational
  // refusals in the first run arrived through positive signatures, which
  // exclude a component just as hard.
  test('the brand guide may not fix the rendering form of a component-supplied concept', async function (assert) {
    let prompt = await readPrompt('issue-design-foundation.md');
    assert.true(
      prompt.includes('A positive signature excludes just as hard as a ban.'),
      'the mitigation covers signatures, not only bans',
    );
    assert.true(
      /Declare each\s+of those \*\*open\*\*/.test(prompt),
      'such concepts are declared open rather than settled',
    );
    for (let concept of ['avatar', 'status', 'badge']) {
      assert.true(
        prompt.includes(concept),
        `${concept} is named among the open concepts`,
      );
    }
  });

  // The design-foundation turn binds every later turn, so it is the one place
  // a catalog sweep changes what the whole build can reuse.
  test('the design foundation surveys the catalog before deciding', async function (assert) {
    let prompt = await readPrompt('issue-design-foundation.md');
    let surveyIdx = prompt.indexOf('## 1. Survey the catalog');
    let brandIdx = prompt.indexOf('## 3. Brand guide');
    assert.true(surveyIdx > -1, 'the sweep exists');
    assert.true(
      surveyIdx < brandIdx,
      'the sweep runs before the guide that binds every later turn',
    );
    assert.true(
      prompt.includes('read-only reconnaissance'),
      'the sweep does not duplicate the per-card reuse decision',
    );
  });

  // The issue text is read as binding downstream, so a type named there
  // forecloses a better one before reuse or type selection is ever consulted.
  test('bootstrap authors field lists as needs rather than types', async function (assert) {
    let prompt = await readPrompt('bootstrap-implement.md');
    assert.true(
      prompt.includes('**Name each field as a need, not as a type.**'),
      'the rule is stated',
    );
    assert.true(
      prompt.includes('type-fixed:'),
      'a genuinely load-bearing type can still be pinned',
    );
  });
});
