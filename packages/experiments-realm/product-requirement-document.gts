import { Base64ImageField } from 'https://cardstack.com/base/base64-image';
import TextAreaField from 'https://cardstack.com/base/text-area';
import MarkdownField from 'https://cardstack.com/base/markdown';
import {
  CardDef,
  field,
  contains,
  StringField,
  Component,
} from 'https://cardstack.com/base/card-api';
import { Button } from '@cardstack/boxel-ui/components';
import { ImagePlaceholder } from '@cardstack/boxel-ui/icons';
import { bool, cn, not } from '@cardstack/boxel-ui/helpers';

export class ProductRequirementDocument extends CardDef {
  static displayName = 'Product Requirements';
  @field appTitle = contains(StringField);
  @field shortDescription = contains(TextAreaField);
  @field thumbnail = contains(Base64ImageField);
  @field prompt = contains(TextAreaField);
  @field overview = contains(MarkdownField);
  @field schema = contains(MarkdownField);
  @field layoutAndNavigation = contains(MarkdownField);
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
  static isolated = class Isolated extends Component<typeof this> {
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
            <Button
              class='generate-button'
              @kind='primary-dark'
              @disabled={{true}}
            >
              <span class='generate-button-logo' />
              Generate App Now
            </Button>
          </div>
          <p class='description'><@fields.description /></p>
        </header>
        <div class='content'>
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
        }
        .generate-button :deep(svg) {
          width: var(--icon-size);
          height: var(--icon-size);
        }
        .generate-button :deep(.loading-indicator) {
          margin-right: 0;
        }
        .generate-button-logo {
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
      </style>
    </template>
  };
}
