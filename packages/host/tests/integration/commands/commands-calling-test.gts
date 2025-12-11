import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { Command, CommandContext } from '@cardstack/runtime-common';

import RealmService from '@cardstack/host/services/realm';

import { testRealmURL, testRealmInfo, setupSnapshotRealm } from '../../helpers';
import {
  CardDef,
  StringField,
  contains,
  field,
} from '../../helpers/base-realm';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | commands-calling', function (hooks) {
  setupRenderingTest(hooks);
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils: undefined as any,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      return {
        commandContext: getService('command-service').commandContext,
      };
    },
  });
  let commandContext: CommandContext;

  hooks.beforeEach(function (this: RenderingTestContext) {
    ({ commandContext } = snapshot.get());
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  test('can be called with a card as input', async function (assert) {
    class CommandInput extends CardDef {
      @field inputField1 = contains(StringField);
      @field inputField2 = contains(StringField);
    }
    class CommandOutput extends CardDef {
      @field outputField = contains(StringField);
    }

    class ExampleCommand extends Command<
      typeof CommandInput,
      typeof CommandOutput
    > {
      inputType = CommandInput;

      async getInputType() {
        return CommandInput;
      }

      async run(input: CommandInput) {
        return new CommandOutput({
          outputField: `Hello ${input.inputField1}${input.inputField2}`,
        });
      }
    }
    let exampleCommand = new ExampleCommand(commandContext);

    const InputType = await exampleCommand.getInputType();
    let input = new InputType({
      inputField1: 'World',
      inputField2: '!',
    });
    let output = await exampleCommand.execute(input);
    assert.strictEqual(output.outputField, 'Hello World!');
  });

  test('can be called with plain object as input', async function (assert) {
    class CommandInput extends CardDef {
      @field inputField1 = contains(StringField);
      @field inputField2 = contains(StringField);
    }
    class CommandOutput extends CardDef {
      @field outputField = contains(StringField);
    }

    class ExampleCommand extends Command<
      typeof CommandInput,
      typeof CommandOutput
    > {
      inputType = CommandInput;

      async getInputType() {
        return CommandInput;
      }

      async run(input: CommandInput) {
        return new CommandOutput({
          outputField: `Hello ${input.inputField1}${input.inputField2}`,
        });
      }
    }
    let exampleCommand = new ExampleCommand(commandContext);
    let output = await exampleCommand.execute({
      inputField1: 'World',
      inputField2: '!',
    });
    assert.strictEqual(output.outputField, 'Hello World!');
  });

  test('can call a command with just some of the fields', async function (assert) {
    class CommandInput extends CardDef {
      @field inputField1 = contains(StringField);
      @field inputField2 = contains(StringField);
    }
    class CommandOutput extends CardDef {
      @field outputField = contains(StringField);
    }

    class ExampleCommand extends Command<
      typeof CommandInput,
      typeof CommandOutput
    > {
      inputType = CommandInput;

      async getInputType() {
        return CommandInput;
      }

      async run(input: CommandInput) {
        return new CommandOutput({
          outputField: `Hello ${input.inputField1}${input.inputField2}`,
        });
      }
    }
    let exampleCommand = new ExampleCommand(commandContext);

    let output = await exampleCommand.execute({
      inputField1: 'World',
    });
    assert.strictEqual(output.outputField, 'Hello Worldundefined');
  });

  test('CardDef fields are optional', async function (assert) {
    class CommandInput extends CardDef {
      @field inputField1 = contains(StringField);
      @field inputField2 = contains(StringField);
    }
    class CommandOutput extends CardDef {
      @field outputField = contains(StringField);
    }

    class ExampleCommand extends Command<
      typeof CommandInput,
      typeof CommandOutput
    > {
      inputType = CommandInput;

      async getInputType() {
        return CommandInput;
      }

      async run(input: CommandInput) {
        return new CommandOutput({
          outputField: `Hello ${input.inputField1}${input.inputField2}`,
        });
      }
    }
    let exampleCommand = new ExampleCommand(commandContext);

    let output = await exampleCommand.execute({
      inputField1: 'World',
      inputField2: '!',
      title: 'test',
    });
    assert.strictEqual(output.outputField, 'Hello World!');
  });

  test('Commands work without taking input', async function (assert) {
    class CommandOutput extends CardDef {
      @field outputField = contains(StringField);
    }

    class ExampleCommand extends Command<undefined, typeof CommandOutput> {
      inputType = undefined;

      async getInputType() {
        return undefined;
      }

      async run() {
        return new CommandOutput({
          outputField: 'Hello',
        });
      }
    }
    let exampleCommand = new ExampleCommand(commandContext);

    let output = await exampleCommand.execute();
    assert.strictEqual(output.outputField, 'Hello');
  });
});
