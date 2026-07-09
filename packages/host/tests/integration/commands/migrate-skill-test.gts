import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { parse as parseYaml } from 'yaml';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import RealmService from '@cardstack/host/services/realm';
import MigrateSkillCommand from '@cardstack/host/tools/migrate-skill';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  testRealmInfo,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm, CommandField, Skill } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }

  realmOf(input: URL | string) {
    let str = input instanceof URL ? input.href : input;
    if (str === testRealmURL) {
      return testRealmURL as ReturnType<RealmService['realmOf']>;
    }
    return undefined;
  }
}

// Split a `--- … ---` frontmatter block off the front of a SKILL.md and parse
// the YAML, so assertions can read the structured frontmatter rather than match
// exact YAML formatting.
function readFrontmatter(content: string): {
  data: Record<string, any>;
  body: string;
} {
  let match = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!match) {
    return { data: {}, body: content };
  }
  return {
    data: (parseYaml(match[1]) as Record<string, any>) ?? {},
    body: content.slice(match[0].length),
  };
}

const COMMAND_MODULE = `${testRealmURL}test-command.gts`;

module('Integration | commands | migrate-skill', function (hooks) {
  let loader: Loader;

  setupRenderingTest(hooks);

  // Register the realm-service stub before the realm/base-realm/matrix helpers
  // run, so their `lookup('service:realm')` resolves the stub rather than
  // instantiating the real singleton first (which would leave `realmOf`
  // unstubbed and realm resolution test-order dependent).
  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);
  setupBaseRealm(hooks);
  setupOnSave(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          'test-command.gts': `import { Command } from '@cardstack/runtime-common';

export class DoThing extends Command {
  static displayName = 'Test Command';
  async getInputType() {
    return undefined;
  }
}

export class DoThingQuietly extends Command {
  static displayName = 'Test Command (no approval)';
  async getInputType() {
    return undefined;
  }
}`,
          'Skill/data-management.json': new Skill({
            cardTitle: 'Data Management',
            cardDescription: 'Manage data in a realm',
            instructions: '# Data\n\nDo data things.',
            commands: [
              new CommandField({
                codeRef: { module: COMMAND_MODULE, name: 'DoThing' },
                requiresApproval: true,
              }),
              // requiresApproval: false must survive migration — see assertion.
              new CommandField({
                codeRef: { module: COMMAND_MODULE, name: 'DoThingQuietly' },
                requiresApproval: false,
              }),
            ],
          }),
          'Skill/no-commands.json': new Skill({
            cardTitle: 'No Commands',
            cardDescription: 'A skill without commands',
            instructions: 'Just instructions.',
          }),
          'Skill/empty.json': new Skill({
            cardTitle: 'Empty Skill',
            cardDescription: 'A skill with no instructions',
            instructions: '   ',
          }),
        },
      }),
    );
  });

  test('migrates a Skill card with commands into a SKILL.md', async function (assert) {
    let commandContext = getService('tool-service').commandContext;
    let cardService = getService('card-service');
    let command = new MigrateSkillCommand(commandContext);

    let result = await command.execute({ realm: testRealmURL });

    let skillUrl = `${testRealmURL}skills/data-management/SKILL.md`;
    assert.true(
      result.migratedFiles.includes(skillUrl),
      'the data-management SKILL.md is reported as migrated',
    );

    let { data, body } = readFrontmatter(
      (await cardService.getSource(new URL(skillUrl))).content,
    );
    assert.strictEqual(data.name, 'Data Management', 'top-level name is set');
    assert.strictEqual(
      data.description,
      'Manage data in a realm',
      'top-level description is set',
    );
    assert.strictEqual(data.boxel.kind, 'skill', 'boxel.kind is skill');
    assert.deepEqual(
      data.boxel.tools,
      [
        {
          codeRef: { module: COMMAND_MODULE, name: 'DoThing' },
          requiresApproval: true,
        },
        {
          codeRef: { module: COMMAND_MODULE, name: 'DoThingQuietly' },
          requiresApproval: false,
        },
      ],
      'commands round-trip into boxel.tools, preserving an explicit requiresApproval: false',
    );
    assert.strictEqual(
      body.trim(),
      '# Data\n\nDo data things.',
      'the instructions become the markdown body',
    );
  });

  test('omits boxel.tools when the skill has none', async function (assert) {
    let commandContext = getService('tool-service').commandContext;
    let cardService = getService('card-service');
    let command = new MigrateSkillCommand(commandContext);

    await command.execute({ realm: testRealmURL });

    let { data } = readFrontmatter(
      (
        await cardService.getSource(
          new URL(`${testRealmURL}skills/no-commands/SKILL.md`),
        )
      ).content,
    );
    assert.strictEqual(data.boxel.kind, 'skill', 'boxel.kind is skill');
    assert.notOk('tools' in data.boxel, 'no tools key when the skill has none');
  });

  test('reports skills with no instructions instead of writing an empty file', async function (assert) {
    let commandContext = getService('tool-service').commandContext;
    let cardService = getService('card-service');
    let command = new MigrateSkillCommand(commandContext);

    let result = await command.execute({ realm: testRealmURL });

    assert.true(
      result.emptySkillIds.includes(`${testRealmURL}Skill/empty`),
      'the empty skill is reported in emptySkillIds',
    );
    assert.notOk(
      result.migratedFiles.some((f: string) => f.includes('/empty/')),
      'no SKILL.md is written for the empty skill',
    );
    let { status } = await cardService.getSource(
      new URL(`${testRealmURL}skills/empty/SKILL.md`),
    );
    assert.strictEqual(status, 404, 'the empty skill target does not exist');
  });

  test('skips existing targets unless overwrite is set', async function (assert) {
    let commandContext = getService('tool-service').commandContext;
    let cardService = getService('card-service');
    let command = new MigrateSkillCommand(commandContext);

    let first = await command.execute({ realm: testRealmURL });
    assert.strictEqual(
      first.migratedFiles.length,
      2,
      'both skills migrate on the first run',
    );

    let second = await command.execute({ realm: testRealmURL });
    assert.strictEqual(
      second.migratedFiles.length,
      0,
      'nothing is rewritten on the second run',
    );
    assert.strictEqual(
      second.skippedSkillIds.length,
      2,
      'both skills are reported as skipped',
    );

    // Overwrite re-migrates even though the targets already exist.
    let third = await command.execute({ realm: testRealmURL, overwrite: true });
    assert.strictEqual(
      third.migratedFiles.length,
      2,
      'both skills migrate again with overwrite',
    );
    assert.strictEqual(
      third.skippedSkillIds.length,
      0,
      'nothing is skipped with overwrite',
    );

    // The overwritten content is still well-formed.
    let { data } = readFrontmatter(
      (
        await cardService.getSource(
          new URL(`${testRealmURL}skills/data-management/SKILL.md`),
        )
      ).content,
    );
    assert.strictEqual(data.boxel.kind, 'skill');
  });
});
