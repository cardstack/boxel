import TextAreaField from 'https://cardstack.com/base/text-area';
import MarkdownField from 'https://cardstack.com/base/markdown';
import {
  CardDef,
  FieldDef,
  field,
  contains,
  StringField,
  Component,
} from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { and } from '@cardstack/boxel-ui/helpers';

export class Prompt extends FieldDef {
  static displayName = 'Prompt';
  @field appType = contains(StringField);
  @field domain = contains(StringField);
  @field customRequirements = contains(TextAreaField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{#if (and @model.appType @model.domain)}}
        <p>
          I want to build a
          <strong><@fields.appType /></strong>
          tailored for a
          <strong><@fields.domain /></strong>
          {{#if @model.customRequirements}}
            that has these features:
            <@fields.customRequirements />
          {{/if}}
        </p>
      {{/if}}
    </template>
  };

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

export class ProductRequirementDocument extends CardDef {
  static displayName = 'Product Requirements';
  @field prompt = contains(Prompt);
  @field appName = contains(StringField);
  @field overview = contains(MarkdownField);
  @field schema = contains(MarkdownField);
  @field title = contains(StringField, {
    computeVia: function (this: ProductRequirementDocument) {
      if (this.appName) {
        return this.appName;
      }
      if (!this.prompt?.appType || !this.prompt?.domain) {
        return 'Untitled App';
      }
      return `${this.prompt.domain} ${this.prompt.appType}`;
    },
  });
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='embedded-prd'>
        <h3><@fields.title /></h3>
        <p><@fields.description /></p>
      </div>
      <style>
        .embedded-prd {
          padding: var(--boxel-sp);
        }
      </style>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='prd'>
        <header>
          <h1><@fields.title /></h1>
          <p class='description'><@fields.description /></p>
        </header>
        <div class='content'>
          <div class='item'>
            <h2>Prompt</h2>
            <p><@fields.prompt /></p>
          </div>
          <section class='item'>
            <h2>Overview</h2>
            <p><@fields.overview /></p>
          </section>
          <section class='item'>
            <h2>Schema</h2>
            <pre><@fields.schema /></pre>
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
        .content {
          margin-top: var(--boxel-sp-xl);
        }
        .item + .item {
          margin-top: var(--boxel-sp-lg);
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
      </style>
    </template>
  };
}
