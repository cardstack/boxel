import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';

import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Command, type CommandContext } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { getDefaultWritableRealmURL } from '@cardstack/boxel-host/test-helpers';

// ---------------------------------------------------------------------------
// Input / Output cards for SampleCommand

class GreetInput extends CardDef {
  static displayName = 'Greet Input';
  @field name = contains(StringField);
}

export class GreetOutput extends CardDef {
  static displayName = 'Greet Output';
  @field message = contains(StringField);
}

// ---------------------------------------------------------------------------
// SampleCommand — greets the given name, falling back to "World"

export class SampleCommand extends Command<
  typeof GreetInput,
  typeof GreetOutput
> {
  static actionVerb = 'Greet';
  name = 'SampleCommand';
  description = 'Returns a greeting for the given name.';

  async getInputType() {
    return GreetInput;
  }

  protected async run(input: GreetInput): Promise<GreetOutput> {
    let name = input?.name?.trim() || 'World';
    return new GreetOutput({ message: `Hello, ${name}!` });
  }
}

// ---------------------------------------------------------------------------
// SampleCommandCard

export class SampleCommandCard extends CardDef {
  static displayName = 'Sample Command Card';

  @field name = contains(StringField);

  static isolated = class Isolated extends Component<typeof SampleCommandCard> {
    @tracked commandOutput: string | null = null;
    @tracked isRunning = false;
    @tracked commandError: string | null = null;
    @tracked savedCardId: string | null = null;
    @tracked isSaving = false;

    @action
    async runSampleCommand() {
      let commandContext = this.args.context?.commandContext as
        | CommandContext
        | undefined;
      if (!commandContext) {
        this.commandError = 'No commandContext available';
        return;
      }
      this.isRunning = true;
      this.commandOutput = null;
      this.commandError = null;
      try {
        let cmd = new SampleCommand(commandContext);
        let result = await cmd.execute({ name: this.args.model.name });
        this.commandOutput = result?.message ?? null;
      } catch (e: unknown) {
        this.commandError = e instanceof Error ? e.message : String(e);
      } finally {
        this.isRunning = false;
      }
    }

    @action
    async runSampleSave() {
      let commandContext = this.args.context?.commandContext as
        | CommandContext
        | undefined;
      if (!commandContext) {
        this.commandError = 'No commandContext available';
        return;
      }
      this.isSaving = true;
      this.savedCardId = null;
      this.commandError = null;
      try {
        let newCard = new GreetOutput({
          message: `Hello, ${this.args.model.name || 'World'}!`,
        });
        let cmd = new SaveCardCommand(commandContext);
        await cmd.execute({
          card: newCard,
          realm: getDefaultWritableRealmURL(),
        });
        this.savedCardId = newCard.id ?? null;
      } catch (e: unknown) {
        this.commandError = e instanceof Error ? e.message : String(e);
      } finally {
        this.isSaving = false;
      }
    }

    <template>
      <div data-test-sample-command-card>
        <p data-test-name>Name: {{@model.name}}</p>

        <button
          data-test-run-button
          {{on 'click' this.runSampleCommand}}
          disabled={{this.isRunning}}
          type='button'
        >
          {{if this.isRunning 'Running...' 'Run Sample Command'}}
        </button>

        <button
          data-test-save-button
          {{on 'click' this.runSampleSave}}
          disabled={{this.isSaving}}
          type='button'
        >
          {{if this.isSaving 'Saving...' 'Run Sample Save'}}
        </button>

        {{#if this.commandOutput}}
          <p data-test-output>{{this.commandOutput}}</p>
        {{/if}}

        {{#if this.savedCardId}}
          <p data-test-saved-id>{{this.savedCardId}}</p>
        {{/if}}

        {{#if this.commandError}}
          <p data-test-error>{{this.commandError}}</p>
        {{/if}}
      </div>
    </template>
  };

  static embedded = class Embedded extends Component<typeof SampleCommandCard> {
    <template>
      <span data-test-sample-command-card-embedded>{{@model.name}}</span>
    </template>
  };
}
