import { Spec } from 'https://cardstack.com/base/spec';
import {
  Component,
  CardDef,
  BaseDef,
  getCardMeta,
  getFields,
} from 'https://cardstack.com/base/card-api';
import {
  FieldContainer,
  RealmIcon,
  BoxelButton,
} from '@cardstack/boxel-ui/components';
import BookOpenText from '@cardstack/boxel-icons/book-open-text';
import GitBranch from '@cardstack/boxel-icons/git-branch';
import LayoutList from '@cardstack/boxel-icons/layout-list';
import { DiagonalArrowLeftUp as ExportArrow } from '@cardstack/boxel-ui/icons';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { task } from 'ember-concurrency';
import { use, resource } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';
import {
  codeRefWithAbsoluteURL,
  isOwnField,
  isPrimitive,
  isResolvedCodeRef,
  loadCardDef,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common';
import GenerateReadmeSpecCommand from '@cardstack/boxel-host/commands/generate-readme-spec';
import { FieldRenderer } from '../../components/field-renderer';

function myLoader(): Loader {
  // @ts-ignore
  return (import.meta as any).loader;
}

export default class FieldSpecEditTemplate extends Component<typeof Spec> {
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
      await generateReadmeSpecCommand.execute({
        spec: this.args.model as Spec,
      });
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

  get allFields() {
    if (!this.args.model) return {};
    return getFields(this.args.model, {
      includeComputeds: false,
    });
  }

  get configurationFields() {
    if (!this.args.model) return [];
    const card = this.args.model.constructor as typeof BaseDef;
    return Object.keys(this.allFields).filter((name) => isOwnField(card, name));
  }

  get specModal(): CardDef {
    return this.args.model as CardDef;
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

      <section class='fields-configuration-preview section'>
        <header
          class='row-header'
          aria-labelledby='fields-configuration-preview'
        >
          <div class='row-header-left'>
            <LayoutList width='20' height='20' role='presentation' />
            <h2 id='fields-configuration-preview'>Field Configuration Playground</h2>
          </div>
        </header>
        <div class='fields-configuration-grid'>
          {{#each this.configurationFields as |fieldName|}}
            <article class='fields-configuration-card'>
              <h3 class='fields-configuration-title'>
                {{fieldName}}
              </h3>
              <FieldRenderer
                @instance={{this.specModal}}
                @fieldName={{fieldName}}
                @fields={{this.allFields}}
                as |field|
              >
                {{#if field.component}}
                  <field.component @format='edit' />
                {{/if}}
              </FieldRenderer>
            </article>
          {{/each}}
        </div>
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
      .fields-configuration-preview {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .fields-configuration-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: var(--boxel-sp);
      }
      .fields-configuration-card {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .fields-configuration-heading {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxxs);
      }
      .fields-configuration-title {
        margin: 0;
        font: 600 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .fields-configuration-name {
        font: 500 var(--boxel-font-size-xs);
        color: var(--boxel-500);
        text-transform: lowercase;
      }
      .fields-configuration-empty {
        margin: 0;
        color: var(--boxel-450);
        font-size: var(--boxel-font-size-xs);
      }
      :deep(.add-new) {
        border: 1px solid var(--border, var(--boxel-border-color));
      }
    </style>
  </template>
}
