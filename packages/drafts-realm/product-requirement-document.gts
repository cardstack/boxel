import TextAreaField from 'https://cardstack.com/base/text-area';
import StringField0 from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import {
  CardDef,
  field,
  contains,
  StringField,
  Component,
} from 'https://cardstack.com/base/card-api';
import { FieldContainer, IconButton } from '@cardstack/boxel-ui/components';
import { IconPencil, IconX } from '@cardstack/boxel-ui/icons';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

class Isolated extends Component<typeof ProductRequirementDocument> {
  <template>
    <section class='prd'>
      <header class='flex-header prd-header'>
        <div class='header-group'>
          {{#if this.isHeaderEditable}}
            <label>
              <h2>Title</h2>
              <@fields.appTitle @format='edit' />
            </label>
            <label class='description-editor'>
              <h2>Description</h2>
              <@fields.description @format='edit' />
            </label>
          {{else}}
            <h1><@fields.title /></h1>
            <p class='description'><@fields.description /></p>
          {{/if}}
        </div>
        <IconButton
          @icon={{if this.isHeaderEditable IconX IconPencil}}
          {{on 'click' (fn this.toggleEditor 'isHeaderEditable')}}
          aria-label='toggle header field editor'
        />
      </header>
      <div class='content'>
        <div class='item'>
          <h2>Prompt</h2>
          <p><@fields.prompt /></p>
        </div>
        <section class='item'>
          <header class='flex-header'>
            <h2>Overview</h2>
            <IconButton
              @icon={{if this.isOverviewEditable IconX IconPencil}}
              {{on 'click' (fn this.toggleEditor 'isOverviewEditable')}}
              aria-label='toggle overview field editor'
            />
          </header>
          {{#if this.isOverviewEditable}}
            <label>
              <span class='boxel-sr-only'>Overview</span>
              <@fields.overview @format='edit' />
            </label>
          {{else}}
            <p><@fields.overview /></p>
          {{/if}}
        </section>
        <section class='item'>
          <header class='flex-header'>
            <h2>Schema</h2>
            <IconButton
              @icon={{if this.isSchemaEditable IconX IconPencil}}
              @width='16'
              @height='16'
              {{on 'click' (fn this.toggleEditor 'isSchemaEditable')}}
              aria-label='toggle schema field editor'
            />
          </header>
          {{#if this.isSchemaEditable}}
            <label>
              <span class='boxel-sr-only'>Schema</span>
              <@fields.schema @format='edit' />
            </label>
          {{else}}
            <pre><@fields.schema /></pre>
          {{/if}}
        </section>
      </div>
    </section>
    <style>
      .prd {
        padding: var(--boxel-sp) var(--boxel-sp-xxl);
      }
      h1 {
        font: 700 var(--boxel-font-xl);
        margin: 0;
      }
      h2 {
        margin: 0;
      }
      p {
        margin: 0;
      }
      p + p {
        margin-top: var(--boxel-sp);
      }
      .description {
        margin-top: var(--boxel-sp-xxs);
        color: var(--boxel-450);
      }
      .description-editor {
        display: block;
        margin-top: var(--boxel-sp);
      }
      .content {
        margin-top: var(--boxel-sp-xl);
      }
      .item + .item {
        margin-top: var(--boxel-sp-lg);
      }
      .flex-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .prd-header {
        align-items: flex-start;
      }
      pre {
        margin: 0;
        max-width: 100%;
        overflow: auto;
      }
      pre > :deep(div) {
        margin-top: -200px;
      }
      pre :deep(p) {
        margin: 0;
      }
      button {
        flex-shrink: 0;
      }
      .header-group {
        flex-grow: 1;
      }
    </style>
  </template>

  @tracked isHeaderEditable = false;
  @tracked isOverviewEditable = false;
  @tracked isSchemaEditable = false;

  @action toggleEditor(property: string) {
    (this as any)[property] = !(this as any)[property];
  }
}

export class ProductRequirementDocument extends CardDef {
  static displayName = 'Product Requirements';
  @field appTitle = contains(StringField);
  @field appDescription = contains(StringField);
  @field appType = contains(StringField);
  @field domain = contains(StringField0);
  @field customRequirements = contains(TextAreaField);
  @field prompt = contains(MarkdownField, {
    computeVia: function (this: ProductRequirementDocument) {
      if (!this.appType || !this.domain) {
        return '';
      }
      return `I want to build a **${this.appType}** tailored for a **${this.domain}**
    that has these features: ${this.customRequirements}`;
    },
  });
  @field overview = contains(MarkdownField);
  @field schema = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: ProductRequirementDocument) {
      if (this.appTitle) {
        return this.appTitle;
      }
      if (!this.appType || !this.domain) {
        return 'Untitled App';
      }
      return `${this.domain} ${this.appType}`;
    },
  });

  static isolated = Isolated;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <section class='prd-editor'>
        <FieldContainer @label='I want to make a'>
          <@fields.appType />
        </FieldContainer>
        <FieldContainer @label='Tailored for'>
          <@fields.domain />
        </FieldContainer>
        <FieldContainer class='features' @label='That has these features'>
          <@fields.customRequirements />
        </FieldContainer>
      </section>
      <style>
        .prd-editor {
          padding: var(--boxel-sp-xxl);
        }
        .prd-editor > * + * {
          margin-top: var(--boxel-sp);
        }
        .features {
          --boxel-input-height: 4rem;
        }
      </style>
    </template>
  };
}
