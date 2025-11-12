import {
  contains,
  field,
  Component,
  CardDef,
  relativeTo,
  linksToMany,
  FieldDef,
  containsMany,
  getCardMeta,
  type CardOrFieldTypeIcon,
  BaseDef,
} from './card-api';
import StringField from './string';
import BooleanField from './boolean';
import CodeRef from './code-ref';
import MarkdownField from './markdown';
import {
  FieldContainer,
  Pill,
  RealmIcon,
  BoxelInput,
  BoxelButton,
  BasicFitted,
} from '@cardstack/boxel-ui/components';
import {
  getCardMenuItems,
  codeRefWithAbsoluteURL,
  ensureExtension,
  isPrimitive,
  isResolvedCodeRef,
  loadCardDef,
  Loader,
  realmURL,
  type CommandContext,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { eq, type MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import { AiBw as AiBwIcon } from '@cardstack/boxel-ui/icons';

import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { task } from 'ember-concurrency';
import BoxModel from '@cardstack/boxel-icons/box-model';
import BookOpenText from '@cardstack/boxel-icons/book-open-text';
import LayersSubtract from '@cardstack/boxel-icons/layers-subtract';
import GitBranch from '@cardstack/boxel-icons/git-branch';
import { DiagonalArrowLeftUp as ExportArrow } from '@cardstack/boxel-ui/icons';
import StackIcon from '@cardstack/boxel-icons/stack';
import AppsIcon from '@cardstack/boxel-icons/apps';
import LayoutList from '@cardstack/boxel-icons/layout-list';
import { use, resource } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';
import GenerateReadmeSpecCommand from '@cardstack/boxel-host/commands/generate-readme-spec';
import PopulateWithSampleDataCommand from '@cardstack/boxel-host/commands/populate-with-sample-data';
import GenerateExampleCardsCommand from '@cardstack/boxel-host/commands/generate-example-cards';
import { type GetCardMenuItemParams } from './card-menu-items';

export type SpecType = 'card' | 'field' | 'component' | 'app' | 'command';

class PopulateFieldSpecExampleCommand extends PopulateWithSampleDataCommand {
  constructor(commandContext: CommandContext) {
    super(commandContext);
  }
  protected get prompt() {
    return `Fill in sample data for this example on the card's spec.`;
  }

  protected getAttachedFileURLs(card: CardDef) {
    let codeRef: ResolvedCodeRef | undefined = (card as Spec).ref;
    if (!codeRef) {
      return [];
    }
    codeRef = codeRefWithAbsoluteURL(
      codeRef,
      new URL(card.id!),
    )! as ResolvedCodeRef;
    let cardOrFieldModuleURL = codeRef.module
      ? ensureExtension(codeRef.module, { default: '.gts' })
      : undefined;
    return cardOrFieldModuleURL ? [cardOrFieldModuleURL] : [];
  }
}

class GenerateExamplesForFieldSpecCommand extends GenerateExampleCardsCommand {
  constructor(commandContext: CommandContext) {
    super(commandContext);
  }
  protected getPrompt(count: number) {
    return `Generate ${count} additional examples on this card's spec.`;
  }
}

const GENERATED_EXAMPLE_COUNT = 3;

class SpecTypeField extends StringField {
  static displayName = 'Spec Type';
}

const PRIMITIVE_INCOMPATIBILITY_MESSAGE =
  'Examples are not currently supported for primitive fields';

class Isolated extends Component<typeof Spec> {
  get defaultIcon() {
    if (!this.args.model) {
      return;
    }
    return this.args.model.constructor?.icon;
  }

  @action
  generateReadme() {
    this.generateReadmeTask.perform();
  }

  generateReadmeTask = task(async () => {
    if (!this.args.model) {
      return;
    }

    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      console.error('Command context not available');
      return;
    }

    try {
      const generateReadmeSpecCommand = new GenerateReadmeSpecCommand(
        commandContext,
      );
      const result = await generateReadmeSpecCommand.execute({
        spec: this.args.model as Spec,
      });

      console.log('Generated README:', result.readme);
    } catch (error) {
      console.error('Error generating README:', error);
    }
  });

  get icon() {
    return this.cardDef?.icon;
  }

  @use private loadCardDef = resource(() => {
    let cardDefObj = new TrackedObject<{ value: typeof BaseDef | undefined }>({
      value: undefined,
    });
    (async () => {
      try {
        if (this.args.model.ref && this.args.model.id) {
          let cardDef = await loadCardDef(this.args.model.ref, {
            loader: myLoader(),
            relativeTo: new URL(this.args.model.id),
          });
          cardDefObj.value = cardDef;
        }
      } catch (e) {
        cardDefObj.value = undefined;
      }
    })();
    return cardDefObj;
  });

  get cardDef() {
    return this.loadCardDef.value;
  }

  get isPrimitiveField() {
    return isPrimitive(this.cardDef);
  }

  get absoluteRef() {
    if (!this.args.model.ref || !this.args.model.id) {
      return undefined;
    }
    let url = new URL(this.args.model.id);
    let ref = codeRefWithAbsoluteURL(this.args.model.ref, url);
    if (!isResolvedCodeRef(ref)) {
      throw new Error('ref is not a resolved code ref');
    }
    return ref;
  }

  private get realmInfo() {
    return getCardMeta(this.args.model as CardDef, 'realmInfo');
  }

  <template>
    <article class='container'>
      <header class='header' aria-labelledby='title'>
        <div class='box header-icon-container'>
          {{#if this.icon}}
            <this.icon width='35' height='35' role='presentation' />
          {{else if this.defaultIcon}}
            <this.defaultIcon width='35' height='35' role='presentation' />
          {{/if}}
        </div>
        <div class='header-info-container'>
          <h1 class='title' id='title' data-test-title>
            <@fields.title />
          </h1>
          <p class='description' data-test-description>
            <@fields.description />
          </p>
        </div>
      </header>
      <section class='readme section'>
        <header class='row-header' aria-labelledby='readme'>
          <div class='row-header-left'>
            <BookOpenText width='20' height='20' role='presentation' />
            <h2 id='readme'>Read Me</h2>
          </div>
        </header>
        <div data-test-readme>
          <@fields.readMe />
        </div>
      </section>
      <section class='examples section'>
        <header class='row-header' aria-labelledby='examples'>
          <LayersSubtract width='20' height='20' role='presentation' />
          <h2 id='examples'>Examples</h2>
        </header>
        {{#if (eq @model.specType 'field')}}
          {{#if this.isPrimitiveField}}
            <p
              class='spec-example-incompatible-message'
              data-test-spec-example-incompatible-primitives
            >
              <span>{{PRIMITIVE_INCOMPATIBILITY_MESSAGE}}</span>
            </p>
          {{else}}
            <@fields.containedExamples @typeConstraint={{this.absoluteRef}} />
          {{/if}}
        {{/if}}
      </section>
      <section class='module section'>
        <header class='row-header' aria-labelledby='module'>
          <GitBranch width='20' height='20' role='presentation' />
          <h2 id='module'>Module</h2>
        </header>
        <div class='code-ref-container'>
          <FieldContainer
            @label='URL'
            @vertical={{true}}
            @labelFontSize='small'
          >
            <div class='code-ref-row'>
              <RealmIcon class='realm-icon' @realmInfo={{this.realmInfo}} />
              <span class='code-ref-value' data-test-module-href>
                {{@model.moduleHref}}
              </span>
            </div>
          </FieldContainer>
          <FieldContainer
            @label='Module Name'
            @vertical={{true}}
            @labelFontSize='small'
          >
            <div class='code-ref-row'>
              <ExportArrow class='exported-arrow' width='10' height='10' />
              <div class='code-ref-value' data-test-exported-name>
                {{@model.ref.name}}
              </div>
              <div class='exported-type' data-test-exported-type>
                {{@model.specType}}
              </div>
            </div>
          </FieldContainer>
        </div>
      </section>
    </article>
    <style scoped>
      .container {
        --boxel-spec-background-color: #ebeaed;
        --boxel-spec-code-ref-background-color: #e2e2e2;
        --boxel-spec-code-ref-text-color: #646464;

        height: 100%;
        min-height: max-content;
        padding: var(--boxel-sp);
        background-color: var(--boxel-spec-background-color);
      }
      .section {
        margin-top: var(--boxel-sp);
        padding-top: var(--boxel-sp);
        border-top: 1px solid var(--boxel-400);
      }
      h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        letter-spacing: var(--boxel-lsp-xs);
        line-height: 1.2;
      }
      h2 {
        margin: 0;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      p {
        margin-top: var(--boxel-sp-4xs);
        margin-bottom: 0;
      }
      .title,
      .description {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        text-wrap: pretty;
      }
      .box {
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--boxel-light);
      }
      .header {
        display: flex;
        gap: var(--boxel-sp-sm);
      }
      .header-icon-container {
        flex-shrink: 0;
        height: var(--boxel-icon-xxl);
        width: var(--boxel-icon-xxl);
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--boxel-100);
      }
      .header-info-container {
        flex: 1;
        align-self: center;
      }
      .row-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-lg);
      }
      .row-header-left {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .row-content {
        margin-top: var(--boxel-sp-sm);
      }

      /* code ref container styles */
      .code-ref-container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .code-ref-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-height: var(--boxel-form-control-height);
        padding: var(--boxel-sp-xs);
        background-color: var(
          --boxel-spec-code-ref-background-color,
          var(--boxel-100)
        );
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        color: var(--boxel-spec-code-ref-text-color, var(--boxel-450));
      }
      .code-ref-value {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .exported-type {
        margin-left: auto;
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp);
        text-transform: uppercase;
      }
      .exported-arrow {
        min-width: 8px;
        min-height: 8px;
      }
      .realm-icon {
        width: 18px;
        height: 18px;
        border: 1px solid var(--boxel-dark);
      }
      .spec-example-incompatible-message {
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        font-weight: 500;
        margin-block: 0;
      }
    </style>
  </template>
}

class Fitted extends Component<typeof Spec> {
  get defaultIcon() {
    if (!this.args.model) {
      return;
    }
    return this.args.model.constructor?.icon;
  }

  get icon() {
    return this.loadCardIcon.value;
  }

  @use private loadCardIcon = resource(() => {
    let icon = new TrackedObject<{ value: CardOrFieldTypeIcon | undefined }>({
      value: undefined,
    });
    (async () => {
      try {
        if (this.args.model.ref && this.args.model.id) {
          let card = await loadCardDef(this.args.model.ref, {
            loader: myLoader(),
            relativeTo: new URL(this.args.model.id),
          });
          icon.value = card.icon;
        }
      } catch (e) {
        icon.value = undefined;
      }
    })();
    return icon;
  });

  <template>
    <BasicFitted
      class='spec-fitted'
      @primary={{@model.title}}
      @secondary={{@model.description}}
    >
      <:thumbnail>
        {{#if this.icon}}
          <this.icon width='35' height='35' role='presentation' />
        {{else if this.defaultIcon}}
          <this.defaultIcon width='35' height='35' role='presentation' />
        {{/if}}
      </:thumbnail>
      <:default>
        {{#if @model.specType}}
          <SpecTag @specType={{@model.specType}} />
        {{/if}}
      </:default>
    </BasicFitted>
    <style scoped>
      @layer {
        .spec-fitted {
          align-items: center;
        }
      }
    </style>
  </template>
}

class Edit extends Component<typeof Spec> {
  get defaultIcon() {
    if (!this.args.model) {
      return;
    }
    return this.args.model.constructor?.icon;
  }

  @action
  generateReadme() {
    this.generateReadmeTask.perform();
  }

  generateReadmeTask = task(async () => {
    if (!this.args.model) {
      return;
    }

    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      console.error('Command context not available');
      return;
    }

    try {
      const generateReadmeSpecCommand = new GenerateReadmeSpecCommand(
        commandContext,
      );
      const result = await generateReadmeSpecCommand.execute({
        spec: this.args.model as Spec,
      });

      console.log('Generated README:', result.readme);
    } catch (error) {
      console.error('Error generating README:', error);
    }
  });

  get icon() {
    return this.cardDef?.icon;
  }

  @use private loadCardDef = resource(() => {
    let cardDefObject = new TrackedObject<{
      value: typeof BaseDef | undefined;
    }>({
      value: undefined,
    });
    (async () => {
      try {
        if (this.args.model.ref && this.args.model.id) {
          let cardDef = await loadCardDef(this.args.model.ref, {
            loader: myLoader(),
            relativeTo: new URL(this.args.model.id),
          });
          cardDefObject.value = cardDef;
        }
      } catch (e) {
        cardDefObject.value = undefined;
      }
    })();
    return cardDefObject;
  });

  get cardDef() {
    return this.loadCardDef.value;
  }

  get isPrimitiveField() {
    return isPrimitive(this.cardDef);
  }

  get absoluteRef() {
    if (!this.args.model.ref || !this.args.model.id) {
      return undefined;
    }
    let url = new URL(this.args.model.id);
    let ref = codeRefWithAbsoluteURL(this.args.model.ref, url);
    if (!isResolvedCodeRef(ref)) {
      throw new Error('ref is not a resolved code ref');
    }
    return ref;
  }

  private get realmInfo() {
    return getCardMeta(this.args.model as CardDef, 'realmInfo');
  }

  <template>
    <article class='container'>
      <header class='header' aria-labelledby='title'>
        <div class='box header-icon-container'>
          {{#if this.icon}}
            <this.icon width='35' height='35' role='presentation' />
          {{else if this.defaultIcon}}
            <this.defaultIcon width='35' height='35' role='presentation' />
          {{/if}}
        </div>
        <div class='header-info-container'>
          <div class='header-title-container' data-test-title>
            <label for='spec-title' class='boxel-sr-only'>Title</label>
            <@fields.title />
          </div>
          <div class='header-description-container' data-test-description>
            <label
              for='spec-description'
              class='boxel-sr-only'
            >Description</label>
            <@fields.description />
          </div>
        </div>
      </header>
      <section class='readme section'>
        <header class='row-header' aria-labelledby='readme'>
          <div class='row-header-left'>
            <BookOpenText width='20' height='20' role='presentation' />
            <h2 id='readme'>Read Me</h2>
          </div>
          <BoxelButton
            @kind='primary'
            @size='extra-small'
            @loading={{this.generateReadmeTask.isRunning}}
            {{on 'click' this.generateReadme}}
            data-test-generate-readme
          >
            {{#if this.generateReadmeTask.isRunning}}
              Generating...
            {{else}}
              Generate README
            {{/if}}
          </BoxelButton>
        </header>
        <div data-test-readme>
          <@fields.readMe />
        </div>
      </section>
      <section class='examples section'>
        <header class='row-header' aria-labelledby='examples'>
          <div class='row-header-left'>
            <LayersSubtract width='20' height='20' role='presentation' />
            <h2 id='examples'>Examples</h2>
          </div>
        </header>
        {{#if (eq @model.specType 'field')}}
          {{#if this.isPrimitiveField}}
            <p
              class='spec-example-incompatible-message'
              data-test-spec-example-incompatible-primitives
            >
              <span>{{PRIMITIVE_INCOMPATIBILITY_MESSAGE}}</span>
            </p>
          {{else}}
            <@fields.containedExamples @typeConstraint={{this.absoluteRef}} />
          {{/if}}
        {{else}}
          <@fields.linkedExamples @typeConstraint={{this.absoluteRef}} />
        {{/if}}
      </section>
      <section class='module section'>
        <header class='row-header' aria-labelledby='module'>
          <div class='row-header-left'>
            <GitBranch width='20' height='20' role='presentation' />
            <h2 id='module'>Module</h2>
          </div>
        </header>
        <div class='code-ref-container'>
          <FieldContainer
            @label='URL'
            @vertical={{true}}
            @labelFontSize='small'
          >
            <div class='code-ref-row'>
              <RealmIcon class='realm-icon' @realmInfo={{this.realmInfo}} />
              <span class='code-ref-value' data-test-module-href>
                {{@model.moduleHref}}
              </span>
            </div>
          </FieldContainer>
          <FieldContainer
            @label='Module Name'
            @vertical={{true}}
            @labelFontSize='small'
          >
            <div class='code-ref-row'>
              <ExportArrow class='exported-arrow' width='10' height='10' />
              <div class='code-ref-value' data-test-exported-name>
                {{@model.ref.name}}
              </div>
              <div class='exported-type' data-test-exported-type>
                {{@model.specType}}
              </div>
            </div>
          </FieldContainer>
        </div>
      </section>
    </article>
    <style scoped>
      .container {
        --boxel-spec-background-color: #ebeaed;
        --boxel-spec-code-ref-background-color: #e2e2e2;
        --boxel-spec-code-ref-text-color: #646464;

        height: 100%;
        min-height: max-content;
        padding: var(--boxel-sp);
        background-color: var(--boxel-spec-background-color);
      }
      .section {
        margin-top: var(--boxel-sp);
        padding-top: var(--boxel-sp);
        border-top: 1px solid var(--boxel-400);
      }
      h2 {
        margin: 0;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .box {
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--boxel-light);
      }
      .header {
        display: flex;
        gap: var(--boxel-sp-sm);
      }
      .header-icon-container {
        flex-shrink: 0;
        height: var(--boxel-icon-xxl);
        width: var(--boxel-icon-xxl);
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--boxel-100);
      }
      .header-info-container {
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        flex: 1;
        align-self: center;
      }
      .header-info-container > div + div {
        border-top: 1px solid var(--boxel-spec-background-color);
      }
      .header-title-container,
      .header-description-container {
        padding: var(--boxel-sp-xs);
      }

      .row-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-lg);
      }
      .row-header-left {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .row-content {
        margin-top: var(--boxel-sp-sm);
      }

      /* code ref container styles */
      .code-ref-container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .code-ref-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-height: var(--boxel-form-control-height);
        padding: var(--boxel-sp-xs);
        background-color: var(
          --boxel-spec-code-ref-background-color,
          var(--boxel-100)
        );
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        color: var(--boxel-spec-code-ref-text-color, var(--boxel-450));
      }
      .code-ref-value {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .exported-type {
        margin-left: auto;
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp);
        text-transform: uppercase;
      }
      .exported-arrow {
        min-width: 8px;
        min-height: 8px;
      }
      .realm-icon {
        width: 18px;
        height: 18px;
        border: 1px solid var(--boxel-dark);
      }
      .spec-example-incompatible-message {
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        font-weight: 500;
        margin-block: 0;
      }
      :deep(.add-new) {
        border: 1px solid var(--border, var(--boxel-border-color));
      }
    </style>
  </template>
}

class SpecTitleField extends StringField {
  static displayName = 'Spec Title';

  static edit = class Edit extends Component<typeof this> {
    get placeholder() {
      const hasFieldName = Boolean(this.args.fieldName);

      if (hasFieldName) {
        return 'Enter ' + this.args.fieldName;
      }
      return undefined;
    }

    <template>
      <BoxelInput
        @id='spec-title'
        @value={{@model}}
        @onInput={{@set}}
        @placeholder={{this.placeholder}}
        class='spec-title-input'
      />
      <style scoped>
        .spec-title-input {
          font-size: 18px;
          font-weight: 600;
          letter-spacing: var(--boxel-lsp-xs);
          padding: var(--boxel-sp-4xs) 0 var(--boxel-sp-4xs) var(--boxel-sp-xs);
        }
        .spec-title-input::placeholder {
          color: var(--boxel-400);
        }
      </style>
    </template>
  };
}

class SpecDescriptionField extends StringField {
  static displayName = 'Spec Description';

  static edit = class Edit extends Component<typeof this> {
    get placeholder() {
      const hasFieldName = Boolean(this.args.fieldName);

      if (hasFieldName) {
        return 'Enter ' + this.args.fieldName;
      }
      return undefined;
    }

    <template>
      <BoxelInput
        @id='spec-description'
        @value={{@model}}
        @onInput={{@set}}
        @placeholder={{this.placeholder}}
        class='spec-description-input'
      />
      <style scoped>
        .spec-description-input {
          padding: var(--boxel-sp-4xs) 0 var(--boxel-sp-4xs) var(--boxel-sp-xs);
        }
        .spec-description-input::placeholder {
          color: var(--boxel-400);
        }
      </style>
    </template>
  };
}

export class Spec extends CardDef {
  static displayName = 'Spec';
  static icon = BoxModel;
  @field readMe = contains(MarkdownField);

  @field ref = contains(CodeRef);
  @field specType = contains(SpecTypeField);

  @field isField = contains(BooleanField, {
    computeVia: function (this: Spec) {
      return this.specType === 'field';
    },
  });

  @field isCard = contains(BooleanField, {
    computeVia: function (this: Spec) {
      return this.specType === 'card' || this.specType === 'app';
    },
  });

  @field isComponent = contains(BooleanField, {
    computeVia: function (this: Spec) {
      return this.specType === 'component';
    },
  });

  @field moduleHref = contains(StringField, {
    computeVia: function (this: Spec) {
      if (!this.ref || !this.ref.module) {
        return undefined;
      }
      return new URL(this.ref.module, this.id ?? this[relativeTo]).href;
    },
  });
  @field linkedExamples = linksToMany(CardDef);
  @field containedExamples = containsMany(FieldDef, { isUsed: true });
  @field title = contains(SpecTitleField);
  @field description = contains(SpecDescriptionField);

  [getCardMenuItems](params: GetCardMenuItemParams): MenuItemOptions[] {
    let menuItems = super[getCardMenuItems](params);
    if (this.specType !== 'field') {
      return menuItems;
    }
    let sampleDataStartIndex = menuItems.findIndex((item: MenuItemOptions) =>
      item.tags?.includes('playground-sample-data'),
    );
    let sampleDataItemCount = menuItems.filter((item: MenuItemOptions) =>
      item.tags?.includes('playground-sample-data'),
    ).length;
    menuItems.splice(
      sampleDataStartIndex,
      sampleDataItemCount,
      ...[
        {
          label: 'Fill in sample data with AI',
          action: async () => {
            await new PopulateFieldSpecExampleCommand(
              params.commandContext,
            ).execute({
              cardId: this.id,
            });
          },
          icon: AiBwIcon,
          tags: ['playground-sample-data'],
        },
        {
          label: `Generate ${GENERATED_EXAMPLE_COUNT} examples with AI`,
          action: async () => {
            await new GenerateExamplesForFieldSpecCommand(
              params.commandContext,
            ).execute({
              count: GENERATED_EXAMPLE_COUNT,
              codeRef: codeRefWithAbsoluteURL(
                this.ref,
                new URL(this.id),
              ) as ResolvedCodeRef,
              realm: this[realmURL]?.href,
              exampleCard: this,
            });
          },
          icon: AiBwIcon,
          tags: ['playground-sample-data'],
        },
      ],
    );
    return menuItems;
  }

  static isolated = Isolated;

  static embedded = class Embedded extends Component<typeof this> {
    get icon() {
      return this.args.model.constructor?.icon;
    }
    <template>
      <article class='embedded-spec'>
        <div class='header-icon-container'>
          <this.icon width='30' height='30' role='presentation' />
        </div>
        <div class='header-info-container'>
          <h3 class='title'><@fields.title /></h3>
          <p class='description'><@fields.description /></p>
        </div>
        {{#if @model.specType}}
          <SpecTag @specType={{@model.specType}} />
        {{/if}}
      </article>
      <style scoped>
        .embedded-spec {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xs);
        }
        .header-icon-container {
          flex-shrink: 0;
          height: var(--boxel-icon-xl);
          width: var(--boxel-icon-xl);
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--boxel-100);
          border: 1px solid var(--boxel-border-color);
          border-radius: var(--boxel-border-radius-lg);
          background-color: var(--boxel-light);
        }
        .header-info-container {
          flex: 1;
        }
        .title {
          margin: 0;
          font: 600 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .description {
          margin: 0;
          color: var(--boxel-500);
          font: var(--boxel-font-size-xs);
          letter-spacing: var(--boxel-lsp-xs);
        }
      </style>
    </template>
  };

  static fitted = Fitted;

  static edit = Edit;
}

interface SpecTagSignature {
  Element: HTMLDivElement;
  Args: {
    specType: string;
  };
}

export class SpecTag extends GlimmerComponent<SpecTagSignature> {
  get icon() {
    return getIcon(this.args.specType);
  }
  <template>
    {{#if this.icon}}
      <Pill @variant='muted' class='spec-tag-pill' ...attributes>
        <:iconLeft>
          <this.icon width='18px' height='18px' />
        </:iconLeft>
        <:default>
          {{@specType}}
        </:default>
      </Pill>

    {{/if}}
    <style scoped>
      .spec-tag-pill {
        --pill-font: 500 var(--boxel-font-xs);
        --pill-background-color: var(--boxel-200);
        --pill-icon-size: 18px;
        word-break: initial;
        text-transform: uppercase;
      }
    </style>
  </template>
}

function getIcon(specType: string) {
  switch (specType) {
    case 'card':
      return StackIcon;
    case 'app':
      return AppsIcon;
    case 'field':
      return LayoutList;
    case 'component':
      return LayoutList;
    default:
      return;
  }
}

function myLoader(): Loader {
  // we know this code is always loaded by an instance of our Loader, which sets
  // import.meta.loader.

  // When type-checking realm-server, tsc sees this file and thinks
  // it will be transpiled to CommonJS and so it complains about this line. But
  // this file is always loaded through our loader and always has access to import.meta.
  // @ts-ignore
  return (import.meta as any).loader;
}
