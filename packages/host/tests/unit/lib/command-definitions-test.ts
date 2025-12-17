import { module, test } from 'qunit';

import {
  getUniqueValidCommandDefinitions,
  isValidCommandDefinition,
} from '@cardstack/host/lib/command-definitions';

import type * as SkillModule from 'https://cardstack.com/base/skill';

function asCommand(command: unknown): SkillModule.CommandField {
  return command as unknown as SkillModule.CommandField;
}

module('Unit | Lib | command-definitions', function () {
  test('validates command definitions', function (assert) {
    let validCommand = asCommand({
      codeRef: {
        module: 'https://example.com/commands.gts',
        name: 'DoThing',
      },
      functionName: 'doThing_abcd',
      requiresApproval: false,
    });

    assert.true(isValidCommandDefinition(validCommand));
    assert.false(isValidCommandDefinition(undefined));
    assert.false(
      isValidCommandDefinition(
        asCommand({
          ...validCommand,
          codeRef: undefined,
        }),
      ),
    );
    assert.false(
      isValidCommandDefinition(
        asCommand({
          ...validCommand,
          codeRef: { module: '   ', name: 'Run' },
        }),
      ),
    );
    assert.false(
      isValidCommandDefinition(
        asCommand({
          ...validCommand,
          codeRef: { module: validCommand.codeRef.module, name: '   ' },
        }),
      ),
    );
    assert.false(
      isValidCommandDefinition(
        asCommand({
          ...validCommand,
          functionName: '',
        }),
      ),
    );
  });

  test('filters and deduplicates command definitions', function (assert) {
    let baseCommand = asCommand({
      codeRef: {
        module: 'https://example.com/commands.gts',
        name: 'DoThing',
      },
      functionName: 'doThing_abcd',
      requiresApproval: false,
    });

    let results = getUniqueValidCommandDefinitions([
      asCommand({ ...baseCommand, codeRef: undefined }),
      asCommand(baseCommand),
      asCommand({ ...baseCommand }),
      asCommand({
        ...baseCommand,
        codeRef: {
          module: 'https://example.com/commands.gts',
          name: 'AnotherThing',
        },
        functionName: 'anotherThing_efgh',
      }),
    ]);

    assert.deepEqual(
      results.map((command) => command.functionName),
      ['doThing_abcd', 'anotherThing_efgh'],
    );
  });
});
