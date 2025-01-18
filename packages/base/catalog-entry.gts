import {
  contains,
  field,
  Component,
  CardDef,
  relativeTo,
  linksToMany,
  FieldDef,
  containsMany,
} from './card-api';
import StringField from './string';
import BooleanField from './boolean';
import CodeRef from './code-ref';
import MarkdownField from './markdown';

import GlimmerComponent from '@glimmer/component';
import BoxModel from '@cardstack/boxel-icons/box-model';
import BookOpenText from '@cardstack/boxel-icons/book-open-text';
import LayersSubtract from '@cardstack/boxel-icons/layers-subtract';
import GitBranch from '@cardstack/boxel-icons/git-branch';
import { DiagonalArrowLeftUp } from '@cardstack/boxel-ui/icons';
import { Pill } from '@cardstack/boxel-ui/components';
import StackIcon from '@cardstack/boxel-icons/stack';
import AppsIcon from '@cardstack/boxel-icons/apps';
import LayoutList from '@cardstack/boxel-icons/layout-list';
import Brain from '@cardstack/boxel-icons/brain';

export type BoxelSpecType = 'card' | 'field' | 'app' | 'skill';

export class SpecType extends StringField {
  static displayName = 'Spec Type';
}

export class CatalogEntry extends CardDef {
  static displayName = 'Catalog Entry';
  static icon = BoxModel;
  @field name = contains(StringField);
  @field readMe = contains(MarkdownField);

  @field ref = contains(CodeRef);
  @field specType = contains(SpecType);

  @field isField = contains(BooleanField, {
    computeVia: function (this: CatalogEntry) {
      return this.specType === 'field';
    },
  });

  @field isCard = contains(BooleanField, {
    computeVia: function (this: CatalogEntry) {
      return this.specType === 'card';
    },
  });
  @field moduleHref = contains(StringField, {
    computeVia: function (this: CatalogEntry) {
      return new URL(this.ref.module, this[relativeTo]).href;
    },
  });
  @field linkedExamples = linksToMany(CardDef);
  @field containedExamples = containsMany(FieldDef);
  @field title = contains(StringField, {
    computeVia: function (this: CatalogEntry) {
      if (this.name) {
        return this.name;
      }
      return this.ref.name === 'default' ? undefined : this.ref.name;
    },
  });

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <CatalogEntryContainer class='fitted'>
        <header class='title' data-test-title>
          <@fields.title />
        </header>
        <p class='description' data-test-description>
          <@fields.description />
        </p>
      </CatalogEntryContainer>
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
            <this.icon class='box header-icon-svg' />
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
            README
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
          <@fields.linkedExamples />
          <@fields.containedExamples />
        </div>
        <div class='module section'>
          <div class='row-header'>
            <GitBranch />
            Module</div>
          <div class='container-code-ref'>
            <div class='row-code-ref'>
              <div class='row-code-ref-label'>URL</div>
              <div class='row-code-ref-value box' data-test-module-href>
                {{@model.moduleHref}}
              </div>
            </div>
            <div class='row-code-ref'>
              <div class='row-code-ref-label'>Exported Name</div>
              <div class='row-code-ref-value box'>
                <div class='exported-row'>
                  <div class='exported-name' data-test-exported-name>
                    <DiagonalArrowLeftUp class='exported-arrow' />
                    {{@model.ref.name}}
                  </div>
                  <div class='exported-type' data-test-exported-type>
                    {{@model.specType}}
                  </div>
                </div>
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
          border: 2px solid var(--boxel-border-color);
          border-radius: var(--boxel-border-radius-lg);
          padding: var(--boxel-sp-xs);
          background-color: var(--boxel-light);
        }
        .header {
          display: flex;
          gap: var(--boxel-sp-sm);
        }
        .section {
          padding: var(--boxel-sp-sm);
        }
        .header-icon-container {
          padding: var(--boxel-sp-sm);
          flex-shrink: 0;
        }
        .header-icon-svg {
          height: var(--boxel-icon-xxl);
          width: var(--boxel-icon-xxl);
          border: 2px solid var(--boxel-border-color);
          border-radius: var(--boxel-border-radius-lg);
        }
        .header-info-container {
          padding: var(--boxel-sp-sm);
          flex: 1;
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
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .exported-row {
          display: flex;
          justify-content: space-between;
        }
        .exported-name {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
        }
        .exported-type {
          text-transform: uppercase;
          font: 500 var(--boxel-font-xs);
          color: var(--boxel-450);
          letter-spacing: var(--boxel-lsp-xl);
        }
        .exported-arrow {
          width: var(--boxel-icon-xxs);
          height: var(--boxel-icon-xxs);
          --icon-color: var(--boxel-teal);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get icon() {
      return this.args.model.constructor?.icon;
    }
    <template>
      <div class='header'>
        <div class='header-icon-container'>
          <this.icon class='box header-icon-svg' />
        </div>
        <div class='header-info-container'>
          <header class='title'><@fields.title /></header>
          <p class='description'><@fields.description /></p>
        </div>
        <div class='pill-container'>
          {{#if @model.specType}}
            <SpecTag @specType={{@model.specType}} />
          {{/if}}
        </div>
      </div>
      <style scoped>
        .header {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
        }
        .header-icon-container {
          flex-shrink: 0;
          padding: var(--boxel-sp-sm);
        }
        .header-info-container {
          flex: 1;
        }
        .pill-container {
          padding-right: var(--boxel-sp-sm);
        }
        .header-icon-svg {
          width: 50px;
          height: 50px;
          border: 2px solid var(--boxel-border-color);
          border-radius: var(--boxel-border-radius-lg);
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
}

interface Signature {
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
}

class CatalogEntryContainer extends GlimmerComponent<Signature> {
  <template>
    <div class='entry' ...attributes>
      {{yield}}
    </div>
    <style scoped>
      .entry {
        display: grid;
        gap: 3px;
        font: var(--boxel-font-sm);
        margin-top: auto;
        margin-bottom: auto;
        margin-left: var(--boxel-sp-xs);
      }
    </style>
  </template>
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
      <Pill class='spec-tag-pill' ...attributes>
        <:iconLeft>
          <div>
            {{this.icon}}
          </div>
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
    case 'skill':
      return Brain;
    default:
      return;
  }
}
