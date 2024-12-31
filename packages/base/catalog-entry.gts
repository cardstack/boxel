import {
  contains,
  field,
  Component,
  CardDef,
  FieldDef,
  relativeTo,
  realmInfo,
  linksToMany,
} from './card-api';
import StringField from './string';
import BooleanField from './boolean';
import CodeRef from './code-ref';
import MarkdownField from './markdown';

import BoxModel from '@cardstack/boxel-icons/box-model';
import BookOpenText from '@cardstack/boxel-icons/book-open-text';
import LayersSubtract from '@cardstack/boxel-icons/layers-subtract';
import GitBranch from '@cardstack/boxel-icons/git-branch';

export class CatalogEntry extends CardDef {
  static displayName = 'Catalog Entry';
  static icon = BoxModel;
  @field readMe = contains(MarkdownField);

  @field ref = contains(CodeRef);

  // If it's not a field, then it's a card
  @field isField = contains(BooleanField);

  @field moduleHref = contains(StringField, {
    computeVia: function (this: CatalogEntry) {
      return new URL(this.ref.module, this[relativeTo]).href;
    },
  });
  @field demo = contains(FieldDef);
  @field realmName = contains(StringField, {
    computeVia: function (this: CatalogEntry) {
      return this[realmInfo]?.name;
    },
  });
  @field examples = linksToMany(CardDef);

  get showDemo() {
    return !this.isField;
  }

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <header class='title'>
        <@fields.title />
      </header>
      <p class='description' data-test-description>
        <@fields.description />
      </p>
      <style scoped>
        .fitted > * {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .title {
          font: 600 var(--boxel-font-sm);
        }

        .description {
          margin: 0;
          color: var(--boxel-500);
          font-size: var(--boxel-font-size-xs);
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    get icon() {
      return this.args.model.constructor?.icon;
    }

    <template>
      <div class='container'>
        <div class='header'>
          <div class='header-icon-container'>
            <this.icon class='box' />
          </div>
          <div class='header-info-container'>
            <div class='box'>
              <h1 data-test-title><@fields.title /></h1>
              <em data-test-description><@fields.description /></em>
            </div>
          </div>
        </div>
        <div class='readme section'>
          <div class='row-header'>
            <BookOpenText />
            Read Me
          </div>
          {{#if @model.readMe}}
            <div class='box'>
              <@fields.readMe />
            </div>
          {{/if}}
        </div>
        <div class='examples section'>
          <div class='row-header'>
            <LayersSubtract />
            Examples
          </div>
        </div>
        <div class='module section'>
          <div class='row-header'>
            <GitBranch />
            Module</div>
          <div class='container-code-ref'>
            <div class='row-code-ref'>
              <div class='row-code-ref-label'>URL</div>
              <div class='row-code-ref-value box'>
                {{@model.moduleHref}}
              </div>
            </div>
            <div class='row-code-ref'>
              <div class='row-code-ref-label'>Module Name</div>
              <div class='row-code-ref-value box'>
                {{@model.ref.name}}
              </div>
            </div>
            <div class='row-code-ref'>
              <div class='row-code-ref-label'>Realm Name</div>
              <div class='row-code-ref-value box' data-test-realm-name>
                {{@model.realmName}}
              </div>
            </div>
          </div>
        </div>
      </div>
      <style scoped>
        .container {
          background-color: var(--boxel-200);
        }
        .box {
          height: 100%;
          width: 100%;
          border: 2px solid var(--boxel-border-color);
          border-radius: var(--boxel-border-radius-lg);
          padding: var(--boxel-sp-xs);
          background-color: var(--boxel-light);
        }
        .header {
          display: grid;
          grid-template-columns: 1fr 3fr;
        }
        .section {
          padding: var(--boxel-sp-sm);
        }
        .header-icon-container {
          padding: var(--boxel-sp-sm);
        }
        .header-icon-svg {
          width: 100%;
          height: 100%;
          border: 2px solid var(--boxel-border-color);
          border-radius: var(--boxel-border-radius-lg);
        }
        .header-info-container {
          padding: var(--boxel-sp-sm);
        }
        .row-header {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: var(--boxel-sp-xs);
          font-weight: 600;
        }
        .container-code-ref {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .row-code-ref {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .row-code-ref-value {
          background-color: var(--boxel-300);
        }
      </style>
    </template>
  };
}
