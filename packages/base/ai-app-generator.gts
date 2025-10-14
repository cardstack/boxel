import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  FieldDef,
} from './card-api';
import StringField from './string';
import { BoxelButton, BoxelInput } from '@cardstack/boxel-ui/components';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';

import AskAiCommand from '@cardstack/boxel-host/commands/ask-ai';
import { AskAiInput } from './command';
import { tracked } from '@glimmer/tracking';

export class SuggestionField extends FieldDef {
  @field title = contains(StringField);
  @field description = contains(StringField);

  static displayName = 'Suggestion';
}

export class AiAppGenerator extends CardDef {
  static displayName = 'AI App Generator';

  @field title = contains(StringField);
  @field description = contains(StringField);
  @field suggestions = containsMany(SuggestionField);
  @tracked promptValue =
    'Create a sprint-planning tool that lets users define backlogs, estimate stories, assign owners, and track burndown.';

  static embedded = class Embedded extends Component<typeof this> {
    setPromptValue = (value: string) => {
      this.args.model.promptValue = value;
    };

    executeAskAi = () => {
      if (this.askAi.isRunning) {
        return;
      }
      this.askAi.perform();
    };

    askAi = restartableTask(async () => {
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        throw new Error('No command context found');
      }

      let command = new AskAiCommand(commandContext);
      await command.execute(
        new AskAiInput({
          prompt: this.args.model.promptValue,
          llmMode: 'act',
        }),
      );
    });

    <template>
      <div class='ai-app-generator-card'>
        <div class='sidebar'>
          <div class='logo'>
            <img
              src='https://boxel-assets-store.s3.us-east-1.amazonaws.com/ai-assist-icon%403x.webp'
              alt='AI App Generator'
              class='logo-icon'
            />
          </div>
          <div class='title-section'>
            <h1 class='title'>AI App Generator</h1>
            <p class='description'>Design your own app UI by describing what you
              want to build</p>
          </div>
        </div>

        <div class='main-content'>
          <div class='input-section'>
            <div class='prompt-input'>
              <BoxelInput
                @type='textarea'
                id='prompt-textarea'
                class='prompt-textarea'
                @value={{@model.promptValue}}
              />
            </div>
            <div class='create-button-container'>
              <BoxelButton
                class='create-button'
                @kind='primary'
                @size='tall'
                {{on 'click' this.executeAskAi}}
                @loading={{this.askAi.isRunning}}
                data-test-create-this-for-me
              >
                {{if this.askAi.isRunning 'Creating...' 'Create this for me'}}
              </BoxelButton>
            </div>
          </div>

          <div class='suggestions-section'>
            <div class='suggestions-row'>
              {{#each @model.suggestions as |suggestion|}}
                <BoxelButton
                  class='suggestion-button'
                  @kind='secondary'
                  @size='extra-small'
                  title={{suggestion.title}}
                  {{on 'click' (fn this.setPromptValue suggestion.description)}}
                >
                  {{suggestion.title}}
                </BoxelButton>
              {{/each}}
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .ai-app-generator-card {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xxl) var(--boxel-sp);
          background-color: var(--boxel-700);
          padding: var(--boxel-sp);
          overflow: hidden;
        }

        /* Left Panel (Sidebar) */
        .sidebar {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          gap: var(--boxel-sp-xxl);
        }

        .logo-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 50px;
          width: 50px;
        }

        .title {
          color: var(--boxel-light);
          font-weight: var(--boxel-font-weight-normal);
          font-size: var(--boxel-font-size-xl);
          line-height: var(--boxel-lineheight-xl);
          text-wrap: balance;
          margin: 0 0 var(--boxel-sp-sm) 0;
          max-width: 12.5rem;
        }

        .description {
          color: var(--boxel-light);
          font-size: var(--boxel-font-size);
          letter-spacing: var(--boxel-lsp-xs);
          line-height: var(--boxel-lineheight-160);
          text-wrap: balance;
          margin: 0;
          max-width: 20rem;
        }

        /* Right Panel (Main Content) */
        .main-content {
          flex: 2;
          display: flex;
          flex-direction: column;
          border-radius: var(--boxel-border-radius-xl);
          min-width: 60%;
          overflow: hidden;
        }

        /* Top Section with Input */
        .input-section {
          flex: 1;
          background-color: white;
          padding: var(--boxel-sp);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: var(--boxel-sp);
        }

        .prompt-input {
          flex: 1;
        }

        .prompt-textarea {
          width: 100%;
          height: 100%;
          border: none;
          outline: none;
          font-size: var(--boxel-font-size);
          line-height: 1.6;
          resize: none;
          padding: 0;
        }

        .create-button-container {
          display: flex;
          justify-content: flex-end;
        }

        .create-button {
          width: fit-content;
        }

        /* Bottom Section with Suggestions */
        .suggestions-section {
          background-color: var(--ai-assistant-menu-background);
          padding: var(--boxel-sp);
        }

        .suggestions-row {
          display: flex;
          gap: var(--boxel-sp-sm);
          flex-wrap: wrap;
        }

        .suggestion-button {
          font-weight: var(--boxel-font-weight-medium);
          border-radius: var(--boxel-border-radius);
        }
      </style>
    </template>
  };
}
