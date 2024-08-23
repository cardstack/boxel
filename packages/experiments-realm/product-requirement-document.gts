import { Base64ImageField } from 'https://cardstack.com/base/base64-image';
import TextAreaField from 'https://cardstack.com/base/text-area';
import MarkdownField from 'https://cardstack.com/base/markdown';
import {
  CardDef,
  field,
  contains,
  StringField,
  Component,
  realmURL,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { Button } from '@cardstack/boxel-ui/components';
import { ImagePlaceholder } from '@cardstack/boxel-ui/icons';
import { bool, cn, not, or } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { baseRealm } from '@cardstack/runtime-common';
import { AppCard } from './app-card';

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
          {{#unless @model.fieldsCode}}
            <Button
              {{on 'click' this.generateApp}}
              class='generate-button'
              @kind='primary-dark'
              @disabled={{this._generateCode.isRunning}}
              @loading={{this._generateCode.isRunning}}
            >
              {{#unless this._generateCode.isRunning}}
                <span class='generate-button-logo' />
              {{/unless}}
              Generate App Now
            </Button>
          {{else}}
            <button {{on 'click' this.reset}}>Reset</button>
          {{/unless}}
        </div>
        {{#if this.errorMessage}}
          <p class='error'>{{this.errorMessage}}</p>
        {{/if}}
        <p class='description'><@fields.description /></p>
      </header>
      <div class='content'>
        {{#if (or @model.fieldsCode @model.moduleURL)}}
          <details open={{or (bool @model.fieldsCode) (bool @model.moduleURL)}}>
            <summary><span>Module</span></summary>
            <div class='details-content'>
              {{#if @model.moduleURL}}
                <Button
                  {{on 'click' this.viewModule}}
                  class='view-module-button'
                  @kind='text-only'
                >
                  <@fields.moduleURL />
                </Button>
              {{/if}}
              <Button
                {{on 'click' this.createModule}}
                class='generate-button'
                @kind='primary-dark'
                @disabled={{this._createModule.isRunning}}
                @loading={{this._createModule.isRunning}}
              >
                {{#unless this._createModule.isRunning}}
                  <span class='generate-button-logo' />
                {{/unless}}
                {{if @model.moduleURL 'Regenerate' 'Create'}}
                Module
              </Button>
            </div>
          </details>
        {{/if}}
        {{#if @model.moduleURL}}
          <details open={{bool @model.appCard}}>
            <summary><span>App</span></summary>
            <div class='details-content'>
              <@fields.appCard />
              <Button
                {{on 'click' this.createInstance}}
                class='generate-button'
                @kind='primary-dark'
                @disabled={{this._createInstance.isRunning}}
                @loading={{this._createInstance.isRunning}}
              >
                {{#unless this._createInstance.isRunning}}
                  <span class='generate-button-logo' />
                {{/unless}}
                Create New Instance
              </Button>
            </div>
          </details>
        {{/if}}

        <details open={{bool @model.prompt}}>
          <summary><span>Prompt</span></summary>
          <div class='details-content'>
            <@fields.prompt />
          </div>
        </details>
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
        <details open={{bool @model.layoutAndNavigation}}>
          <summary><span>Layout & Navigation</span></summary>
          <div class='details-content'>
            <@fields.layoutAndNavigation />
          </div>
        </details>
      </div>
    </section>
    <style>
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
        font-weight: 700;
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
        font-weight: 700;
      }
    </style>
  </template>

  @tracked errorMessage = '';
  @tracked moduleName = '';

  get currentRealm() {
    return this.args.model[realmURL];
  }

  @action generateApp() {
    this._generateCode.perform();
  }
  @action createModule() {
    this._createModule.perform();
  }
  @action createInstance() {
    this._createInstance.perform();
  }

  private _generateCode = restartableTask(async () => {
    this.errorMessage = '';
    try {
      if (!this.currentRealm) {
        throw new Error('Realm URL is not available');
      }
      if (!this.args.context?.actions?.runCommand) {
        throw new Error('Context action "runCommand" is not available');
      }
      await this.args.context.actions.runCommand(
        this.args.model as CardDef,
        `${baseRealm.url}SkillCard/app-generator`,
        'Generate code',
      );
    } catch (e) {
      console.error(e);
      this.errorMessage =
        e instanceof Error ? `Error: ${e.message}` : 'An error has occurred';
    }
  });

  private _createModule = restartableTask(async () => {
    try {
      if (!this.currentRealm) {
        throw new Error('Realm URL is not available');
      }
      if (!this.args.model.fieldsCode) {
        throw new Error('App code is not available');
      }

      let fileName =
        this.args.model?.appTitle?.replace(/ /g, '-').toLowerCase() ??
        `untitled-app-${Date.now()}`;
      let moduleId = `${this.currentRealm.href}AppModules/${fileName}.gts`;
      let response = await fetch(moduleId, {
        method: 'POST',
        headers: { Accept: 'application/vnd.card+source' },
        body: this.args.model.fieldsCode,
      });
      if (!response.ok) {
        throw new Error(
          `Could not write file "${moduleId}", status ${response.status}: ${
            response.statusText
          } - ${await response.text()}`,
        );
      }
      this.args.model.moduleURL = moduleId
        .replace('.gts', '')
        .replace(this.currentRealm.href, '../');
      if (!this.args.model.moduleURL) {
        throw new Error('Module URL was not set');
      }
    } catch (e) {
      console.error(e);
      this.errorMessage =
        e instanceof Error ? `Error: ${e.message}` : 'An error has occurred';
    }
  });

  private _createInstance = restartableTask(async () => {
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
      // if (!this.args.model.sampleData) {
      //   throw new Error('Sample data is not available');
      // }
      let { moduleURL } = this.args.model;
      let loader = (import.meta as any).loader;
      let url = `${moduleURL.replace('../', this.currentRealm.href)}`;
      let module = await loader.import(url);
      let appCard = Object.entries(module).find(
        ([_, declaration]) =>
          declaration &&
          typeof declaration === 'function' &&
          'isCardDef' in declaration &&
          AppCard.isPrototypeOf(declaration),
      );
      if (!appCard) {
        throw new Error('Could not find app card in module');
      }
      let moduleRef = {
        module: url,
        name: appCard[0],
      };
      let card = await this.args.context?.actions?.createCard?.(
        moduleRef,
        undefined,
        {
          realmURL: this.currentRealm,
          doc: {
            data: {
              attributes: {
                title: this.args.model.appTitle,
                // ...JSON.parse(this.args.model.sampleData),
              },
              meta: { adoptsFrom: moduleRef },
            },
          },
          cardModeAfterCreation: 'isolated',
        },
      );
      if (!card) {
        throw new Error('Could not create card');
      }
      this.args.model.appCard = [
        ...(this.args.model.appCard ?? []),
        card as AppCard,
      ];
    } catch (e) {
      console.error(e);
      this.errorMessage =
        e instanceof Error ? `Error: ${e.message}` : 'An error has occurred';
    }
  });

  @action viewModule() {
    if (!this.currentRealm) {
      throw new Error('Realm URL is not available');
    }
    if (!this.args.model.moduleURL) {
      throw new Error('Module url is not available');
    }
    if (!this.args.context?.actions?.changeSubmode) {
      throw new Error(
        'Unable to view module. Context action "changeSubmode" is not available',
      );
    }
    this.args.context.actions.changeSubmode(
      new URL(
        `${this.args.model.moduleURL.replace(
          '../',
          this.currentRealm.href,
        )}.gts`,
      ),
      'code',
    );
  }

  @action reset() {
    this.args.model.moduleURL = undefined;
    this.args.model.fieldsCode = undefined;
    this.args.model.appCard = undefined;
  }
}

export class ProductRequirementDocument extends CardDef {
  static displayName = 'Product Requirements';
  @field appTitle = contains(StringField);
  @field shortDescription = contains(TextAreaField);
  @field thumbnail = contains(Base64ImageField);
  @field prompt = contains(TextAreaField);
  @field overview = contains(MarkdownField);
  @field schema = contains(MarkdownField);
  @field layoutAndNavigation = contains(MarkdownField);
  @field moduleURL = contains(StringField);
  @field appCard = linksToMany(AppCard);
  @field fieldsCode = contains(StringField, {
    description: `Use typescript for the code. Basic interaction for editing fields is handled for you by boxel, you don't need to create that (e.g. StringField has an edit template that allows a user to edit the data). Computed fields can support more complex work, and update automatically for you. Interaction (button clicks, filtering on user typed content) will require work on templates that will happen elsewhere and is not yours to do.

Never leave sections of code unfilled or with placeholders, finish all code you write.

You have available:

StringField
MarkdownField
NumberField
BooleanField
DateField
DateTimeField

Fields do not have default values.

Computed fields can be created with a computeVia function

 @field computedData = contains(NumberField, {
   computeVia: function (this) {
     // implementation logic here
     return 1;
   }});


Use contains for a single field and containsMany for a list.

Example for a booking form:

@field guestNames = containsMany(StringField);
@field startDate = contains(DateField);
@field endDate = contains(DateField);
@field guests = contains(NumberField, {
   computeVia: function (this) {
     return guestNames.length;
   })

`,
  });
  @field sampleData = contains(StringField, {
    description: `Sample data to create an instance with. This should be a JSON string, and *must* be updated whenever the template *fields* are changed`,
  });
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
