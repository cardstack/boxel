import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  FieldDef,
} from './card-api';
import StringField from './string';
import { Button as BoxelButton } from '@cardstack/boxel-ui/components';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';

import AskAiCommand from '@cardstack/boxel-host/commands/ask-ai';
import { AskAiInput } from './command';
import { tracked } from '@glimmer/tracking';

export class SuggestionField extends FieldDef {
  @field cardTitle = contains(StringField);
  @field cardDescription = contains(StringField);

  static displayName = 'Suggestion';
}

export class AiAppGenerator extends CardDef {
  static displayName = 'AI App Generator';

  @field cardTitle = contains(StringField);
  @field cardDescription = contains(StringField);
  @field suggestions = containsMany(SuggestionField);
  @tracked promptValue =
    'Create a sprint-planning tool that lets users define backlogs, estimate stories, assign owners, and track burndown.';

  static embedded = class Embedded extends Component<typeof this> {
    setPromptValue = (value: string) => {
      this.args.model.promptValue = value;
    };

    handlePromptInput = (event: Event) => {
      let target = event.target as HTMLTextAreaElement | null;
      if (target) {
        this.setPromptValue(target.value);
      }
    };

    executeAskAi = () => {
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
            <h1 class='title'>AI App<br />Generator</h1>
            <p class='description'>Design your own app UI by<br />describing
              what you want to build</p>
          </div>
        </div>

        <div class='main-content'>
          <div class='input-section'>
            <div class='prompt-input'>
              <textarea
                id='prompt-textarea'
                class='prompt-textarea'
                value={{@model.promptValue}}
                {{on 'input' this.handlePromptInput}}
              ></textarea>
            </div>
            <div class='create-button-container'>
              <BoxelButton
                class='create-button'
                @kind='primary'
                @size='base'
                {{on 'click' this.executeAskAi}}
                disabled={{this.askAi.isRunning}}
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
                  @kind='secondary'
                  @size='small'
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
          background-color: #272330;
          overflow: hidden;
          padding: 20px;
        }

        /* Left Panel (Sidebar) */
        .sidebar {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
        }

        .logo {
          margin-bottom: var(--boxel-sp-xxl);
        }

        .logo-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 50px;
          width: 50px;
        }

        .title-section {
          text-align: center;
        }

        .title {
          color: var(--boxel-light);
          font-size: var(--boxel-font-size-2xl);
          font-weight: 400;
          text-align: left;
          margin: 0 0 var(--boxel-sp-sm) 0;
        }

        .description {
          color: var(--boxel-light);
          font: normal var(--boxel-font-sm);
          text-align: left;
          margin: 0;
        }

        /* Right Panel (Main Content) */
        .main-content {
          flex: 2;
          display: flex;
          flex-direction: column;
          border-radius: 16px;
        }

        /* Top Section with Input */
        .input-section {
          flex: 1;
          background-color: white;
          padding: 20px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          border-top-right-radius: 16px;
          border-top-left-radius: 16px;
        }

        .prompt-input {
          flex: 1;
        }

        .prompt-textarea {
          width: 100%;
          height: 100%;
          border: none;
          outline: none;
          font-size: 16px;
          line-height: 1.6;
          color: #333;
          background: transparent;
          resize: none;
          font-family:
            -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 0;
        }

        .create-button-container {
          display: flex;
          justify-content: flex-end;
        }

        .create-button {
          width: fit-content;
        }

        .prompt-textarea::placeholder {
          color: #666;
        }

        /* Bottom Section with Suggestions */
        .suggestions-section {
          background-color: #4f4b57;
          padding: 20px;
          border-bottom-right-radius: 16px;
          border-bottom-left-radius: 16px;
        }

        .suggestions-row {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
      </style>
    </template>
  };
}
