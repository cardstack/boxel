import Base64ImageField from 'https://cardstack.com/base/base64-image';
import TextAreaField from 'https://cardstack.com/base/text-area';
import MarkdownField from 'https://cardstack.com/base/markdown';
import {
  CardDef,
  field,
  contains,
  StringField,
  Component,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import { Button } from '@cardstack/boxel-ui/components';
import { ImagePlaceholder } from '@cardstack/boxel-ui/icons';
import { bool, cn, not } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier'; // TODO: why is this a type error???
import { tracked } from '@glimmer/tracking';
import { AppCard } from './app-card';
import ClipboardListIcon from '@cardstack/boxel-icons/clipboard-list';

import CreateAiAssistantRoomCommand from '@cardstack/boxel-host/commands/create-ai-assistant-room';
import ShowCardCommand from '@cardstack/boxel-host/commands/show-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import WriteTextFileCommand from '@cardstack/boxel-host/commands/write-text-file';

import GenerateCodeCommand from './AiAppGenerator/generate-code-command';
import { restartableTask } from 'ember-concurrency';

class Isolated extends Component<typeof ProductRequirementDocument> {
  <template>
    <section class='prd'>
      <header>
        <div class='header-button-group'>
          <div class='title-group'>
            <div
              class={{cn
                'app-icon-container'
                placeholder=(not @model.thumbnail.base64)
              }}
            >
              {{#if @model.thumbnail.base64}}
                <@fields.thumbnail />
              {{else}}
                <ImagePlaceholder
                  class='icon-placeholder'
                  width='50'
                  height='50'
                  role='presentation'
                />
              {{/if}}
            </div>
            <h1><@fields.title /></h1>
          </div>
          {{#if @model.moduleURL}}
            <Button
              {{on 'click' this.reset}}
              class='generate-button'
              @kind='primary-dark'
            >
              Reset
            </Button>
          {{else}}
            <Button
              {{on 'click' this.generateApp}}
              class='generate-button'
              @kind='primary-dark'
              @disabled={{this._generateCode.isRunning}}
              @loading={{this._generateCode.isRunning}}
              data-test-generate-app
            >
              {{#unless this._generateCode.isRunning}}
                <span class='generate-button-logo' />
              {{/unless}}
              Generate App Now
            </Button>
          {{/if}}
        </div>
        {{#if this.errorMessage}}
          <p class='error'>{{this.errorMessage}}</p>
        {{/if}}
        <p class='description'><@fields.description /></p>
      </header>
      <div class='content'>
        {{#if @model.moduleURL}}
          <details open={{bool @model.moduleURL}}>
            <summary><span>Module</span></summary>
            <div class='details-content'>
              {{#if @model.moduleURL}}
                <Button
                  {{on 'click' this.viewModule}}
                  class='view-module-button'
                  @kind='text-only'
                  data-test-view-module
                >
                  <@fields.moduleURL />
                </Button>
              {{/if}}
            </div>
          </details>
        {{/if}}
        {{#if @model.moduleURL}}
          <details>
            <summary><span>App</span></summary>
            <div class='details-content'>
              <Button
                {{on 'click' this.createInstance}}
                class='generate-button new-instance-button'
                @kind='primary-dark'
                @disabled={{this._createInstance.isRunning}}
                @loading={{this._createInstance.isRunning}}
                data-test-create-instance
              >
                {{#unless this._createInstance.isRunning}}
                  <span class='generate-button-logo' />
                {{/unless}}
                Create New Instance
              </Button>
            </div>
          </details>
        {{/if}}

        <details open={{bool @model.overview}}>
          <summary><span>Overview</span></summary>
          <div class='details-content'>
            <@fields.overview />
          </div>
        </details>
        <details open={{bool @model.schema}}>
          <summary><span>Schema</span></summary>
          <div class='details-content'>
            <@fields.schema />
          </div>
        </details>
      </div>
    </section>
    <style scoped>
      .prd {
        padding: var(--boxel-sp) var(--boxel-sp-xxl);
      }
      .title-group {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
      }
      .header-button-group {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp);
      }
      .generate-button {
        --icon-size: 20px;
        --boxel-button-loading-icon-size: var(--icon-size);
        padding: var(--boxel-sp-xxs) var(--boxel-sp);
        justify-self: end;
        gap: var(--boxel-sp-sm);
        white-space: normal;
      }
      .generate-button :deep(svg) {
        width: var(--icon-size);
        height: var(--icon-size);
      }
      .generate-button :deep(.loading-indicator) {
        width: var(--icon-size);
        height: var(--icon-size);
        margin-right: 0;
      }
      .generate-button-logo {
        flex-shrink: 0;
        display: inline-block;
        width: var(--icon-size);
        height: var(--icon-size);
        background: url('./ai-assist-icon@2x.webp') no-repeat center;
        background-size: contain;
      }
      .new-instance-button {
        margin-top: var(--boxel-sp);
      }
      .app-icon-container {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 80px;
        height: 80px;
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius-xl);
      }
      .placeholder {
        background-color: var(--boxel-200);
      }
      .icon-placeholder {
        --icon-color: #212121;
      }
      h1 {
        margin: 0;
        font-weight: 600;
        font-size: 1.5rem;
        letter-spacing: var(--boxel-lsp-xs);
      }
      details {
        margin-top: var(--boxel-sp-sm);
        padding-top: var(--boxel-sp-sm);
        border-top: 1px solid var(--boxel-200);
      }
      summary {
        margin: 0;
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      summary:hover {
        cursor: pointer;
      }
      summary > span {
        display: inline-block;
        margin-left: var(--boxel-sp-xxxs);
      }
      .details-content {
        margin-top: var(--boxel-sp);
      }
      .description {
        margin-top: var(--boxel-sp-sm);
        font: 500 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .content {
        margin-top: var(--boxel-sp-lg);
      }
      .error {
        color: var(--boxel-danger);
        font-weight: 600;
      }
    </style>
  </template>

  @tracked errorMessage = '';

  get currentRealm() {
    return this.args.model[realmURL];
  }

  generateApp = () => {
    this._generateCode.perform();
  };
  createInstance = () => {
    this._createInstance.perform();
  };

  private _generateCode = restartableTask(async () => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('Missing commandContext');
    }
    this.errorMessage = '';
    try {
      let createRoomCommand = new CreateAiAssistantRoomCommand(commandContext);
      let { roomId } = await createRoomCommand.execute({
        name: 'AI Assistant Room',
      });
      let generateCodeCommand = new GenerateCodeCommand(commandContext);
      let { code, appName } = await generateCodeCommand.execute({
        productRequirements: this.args.model as ProductRequirementDocument,
        roomId,
      });

      // Generate a unique name for the module using timestamp
      let timestamp = Date.now();
      let moduleName = `generated-apps/${timestamp}/${appName}`;
      let filePath = `${moduleName}.gts`;
      let moduleId = new URL(moduleName, this.currentRealm).href;
      let writeFileCommand = new WriteTextFileCommand(commandContext);

      await writeFileCommand.execute({
        path: filePath,
        content: code,
        realm: this.currentRealm?.href,
      });
      this.args.model.moduleURL = moduleId;
    } catch (e) {
      console.error(e);
      this.errorMessage =
        e instanceof Error ? `Error: ${e.message}` : 'An error has occurred';
    }
  });

  private _createInstance = restartableTask(async () => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('Missing commandContext');
    }
    this.errorMessage = '';
    try {
      if (!this.currentRealm) {
        throw new Error('Realm URL is not available');
      }
      if (!this.args.context?.actions?.createCard) {
        throw new Error('Context action "createCard" is not available');
      }
      if (!this.args.model.moduleURL) {
        throw new Error('Module URL is not available');
      }
      let { moduleURL } = this.args.model;
      // get the app card def from the module
      let loader = (import.meta as any).loader;
      let module = await loader.import(moduleURL);
      let MyAppCard = Object.values(module).find(
        (declaration) =>
          declaration &&
          typeof declaration === 'function' &&
          'isCardDef' in declaration &&
          AppCard.isPrototypeOf(declaration),
      ) as typeof AppCard;
      if (!MyAppCard) {
        throw new Error('App definition not found');
      }

      let myAppCard = new MyAppCard({
        moduleId: moduleURL,
      });

      let saveCardCommand = new SaveCardCommand(commandContext);
      await saveCardCommand.execute({
        realm: this.currentRealm.href,
        card: myAppCard,
      });

      // show the app card

      let showCardCommand = new ShowCardCommand(commandContext);
      await showCardCommand.execute({
        cardIdToShow: myAppCard.id,
      });

      if (!myAppCard) {
        throw new Error('Could not create card');
      }
    } catch (e) {
      console.error(e);
      this.errorMessage =
        e instanceof Error ? `Error: ${e.message}` : 'An error has occurred';
    }
  });

  viewModule = () => {
    this.errorMessage = '';
    if (!this.args.model.moduleURL) {
      this.errorMessage = 'Module url is not available';
      return;
    }
    if (!this.args.context?.actions?.changeSubmode) {
      this.errorMessage =
        'Unable to view module. Context action "changeSubmode" is not available';
      return;
    }
    this.args.context.actions.changeSubmode(
      new URL(this.args.model.moduleURL),
      'code',
    );
  };

  reset = () => {
    this.args.model.moduleURL = undefined;
  };
}

export class ProductRequirementDocument extends CardDef {
  static displayName = 'Product Requirements';
  static icon = ClipboardListIcon;
  @field appTitle = contains(StringField);
  @field shortDescription = contains(TextAreaField);
  @field thumbnail = contains(Base64ImageField);
  @field overview = contains(MarkdownField);
  @field schema = contains(MarkdownField);
  @field moduleURL = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: ProductRequirementDocument) {
      return this.appTitle ?? 'Untitled App';
    },
  });
  @field description = contains(StringField, {
    computeVia: function (this: ProductRequirementDocument) {
      return this.shortDescription;
    },
  });
  static isolated = Isolated;
}
