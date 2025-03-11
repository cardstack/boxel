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
} from '@cardstack/boxel-ui/components';
import {
  codeRefWithAbsoluteURL,
  Loader,
  loadCard,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';
import { eq } from '@cardstack/boxel-ui/helpers';

import GlimmerComponent from '@glimmer/component';
import BoxModel from '@cardstack/boxel-icons/box-model';
import BookOpenText from '@cardstack/boxel-icons/book-open-text';
import LayersSubtract from '@cardstack/boxel-icons/layers-subtract';
import GitBranch from '@cardstack/boxel-icons/git-branch';
import { DiagonalArrowLeftUp as ExportArrow } from '@cardstack/boxel-ui/icons';
import StackIcon from '@cardstack/boxel-icons/stack';
import AppsIcon from '@cardstack/boxel-icons/apps';
import LayoutList from '@cardstack/boxel-icons/layout-list';
import Brain from '@cardstack/boxel-icons/brain';
import { use, resource } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';

export type SpecType = 'card' | 'field' | 'app' | 'skill';

class SpecTypeField extends StringField {
  static displayName = 'Spec Type';
}

class Isolated extends Component<typeof Spec> {
  get defaultIcon() {
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
      if (this.args.model.ref && this.args.model.id) {
        let card = await loadCard(this.args.model.ref, {
          loader: myLoader(),
          relativeTo: new URL(this.args.model.id),
        });
        icon.value = card.icon;
      }
    })();
    return icon;
  });

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
          {{else}}
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
          <BookOpenText width='20' height='20' role='presentation' />
          <h2 id='readme'>Read Me</h2>
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
          <@fields.containedExamples />
        {{else}}
          <@fields.linkedExamples @typeConstraint={{this.absoluteRef}} />
        {{/if}}
      </section>
      <section class='module section'>
        <header class='row-header' aria-labelledby='module'>
          <GitBranch width='20' height='20' role='presentation' />
          <h2 id='module'>Module</h2>
        </header>
        <div class='code-ref-container'>
          <FieldContainer @label='URL' @vertical={{true}}>
            <div class='code-ref-row'>
              <RealmIcon class='realm-icon' @realmInfo={{this.realmInfo}} />
              <span class='code-ref-value' data-test-module-href>
                {{@model.moduleHref}}
              </span>
            </div>
          </FieldContainer>
          <FieldContainer @label='Module Name' @vertical={{true}}>
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
        word-break: break-word;
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
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-lg);
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
    </style>
  </template>
}

class Fitted extends Component<typeof Spec> {
  get defaultIcon() {
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
      if (this.args.model.ref && this.args.model.id) {
        let card = await loadCard(this.args.model.ref, {
          loader: myLoader(),
          relativeTo: new URL(this.args.model.id),
        });
        icon.value = card.icon;
      }
    })();
    return icon;
  });

  <template>
    <div class='fitted-template'>
      <div class='thumbnail-section'>
        {{#if this.icon}}
          <this.icon width='35' height='35' role='presentation' />
        {{else}}
          <this.defaultIcon width='35' height='35' role='presentation' />
        {{/if}}
      </div>
      <div class='info-section'>
        <h3 class='card-title' data-test-card-title><@fields.title /></h3>
        <h4 class='card-description' data-test-card-description>
          <@fields.description />
        </h4>
      </div>
      {{#if @model.specType}}
        <SpecTag @specType={{@model.specType}} />
      {{/if}}
    </div>
    <style scoped>
      @layer {
        .fitted-template {
          width: 100%;
          height: 100%;
          display: flex;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs);
          overflow: hidden;
          align-items: center;
        }
        .thumbnail-section {
          flex-shrink: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
        }
        .info-section {
          width: 100%;
          overflow: hidden;
        }
        .card-title {
          margin-block: 0;
          font: 600 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-sm);
          line-height: 1.25;
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
        }
        .card-description {
          margin-top: var(--boxel-sp-4xs);
          margin-bottom: 0;
          color: var(--boxel-450);
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-xs);
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
        }
        :deep(.spec-tag-pill) {
          height: max-content;
        }
        :deep(.spec-tag-pill .icon) {
          width: 18px;
        }
      }

      /* Aspect Ratio <= 1.0 (Vertical) */
      @container fitted-card (aspect-ratio <= 1.0) {
        .fitted-template {
          flex-direction: column;
        }
        .thumbnail-section {
          width: 100%;
          height: 50cqmin;
        }
        .info-section {
          text-align: center;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height <= 118px) {
        .thumbnail-section {
          display: none;
        }
      }
      /* Vertical Tiles*/
      /* Small Tile (150 x 170) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (170px <= height) {
        .thumbnail-section {
          min-height: 70px;
        }
        .card-title {
          -webkit-line-clamp: 3;
        }
      }
      /* CardsGrid Tile (170 x 250) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px < width < 250px ) and (170px < height < 275px) {
        .thumbnail-section {
          height: auto;
          aspect-ratio: 1 / 1;
        }
        .card-title {
          -webkit-line-clamp: 2;
        }
      }
      /* Tall Tile (150 x 275) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (275px <= height) {
        .thumbnail-section {
          min-height: 85px;
        }
        .card-title {
          font-size: var(--boxel-font-size);
          -webkit-line-clamp: 4;
        }
      }
      /* Large Tile (250 x 275) */
      @container fitted-card (aspect-ratio <= 1.0) and (250px <= width ) and (275px <= height) {
        .thumbnail-section {
          min-height: 150px;
        }
        .card-title {
          font-size: var(--boxel-font-size-sm);
          -webkit-line-clamp: 3;
        }
      }
      /* Vertical Cards */
      @container fitted-card (aspect-ratio <= 1.0) and (400px <= width) {
        .fitted-template {
          padding: var(--boxel-sp);
          gap: var(--boxel-sp);
        }
        .thumbnail-section {
          min-height: 236px;
        }
        .card-title {
          font-size: var(--boxel-font-size-med);
          -webkit-line-clamp: 4;
        }
      }
      /* Expanded Card (400 x 445) */

      /* 1.0 < Aspect Ratio (Horizontal) */
      @container fitted-card (1.0 < aspect-ratio) {
        .thumbnail-section {
          aspect-ratio: 1;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (height <= 65px) {
        .info-section {
          align-self: center;
        }
      }
      /* Badges */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) {
        .fitted-template {
          padding: var(--boxel-sp-xxxs);
        }
        .thumbnail-section {
          display: none;
        }
      }
      /* Small Badge (150 x 40) */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height < 65px) {
        .card-title {
          -webkit-line-clamp: 1;
          font: 600 var(--boxel-font-xs);
        }
        .card-display-name {
          margin-top: 0;
        }
      }
      /* Medium Badge (150 x 65) */

      /* Large Badge (150 x 105) */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (105px <= height) {
        .card-title {
          -webkit-line-clamp: 3;
        }
      }

      /* Strips */
      /* Single Strip (250 x 40) */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width) and (height < 65px) {
        .fitted-template {
          padding: var(--boxel-sp-xxxs);
        }
      }
      /* Double Strip (250 x 65) */
      /* Triple Strip (250 x 105) */
      /* Double Wide Strip (400 x 65) */
      /* Triple Wide Strip (400 x 105) */

      /* Horizontal Tiles */
      /* Regular Tile (250 x 170) */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width < 400px) and (170px <= height) {
        .thumbnail-section {
          height: 40%;
        }
        .card-title {
          -webkit-line-clamp: 4;
          font-size: var(--boxel-font-size);
        }
      }

      /* Horizontal Cards */
      /* Compact Card (400 x 170) */
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (170px <= height) {
        .thumbnail-section {
          height: 100%;
        }
      }
      /* Full Card (400 x 275) */
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (275px <= height) {
        .fitted-template {
          padding: var(--boxel-sp);
          gap: var(--boxel-sp);
        }
        .thumbnail-section {
          max-width: 44%;
        }
        .card-title {
          font-size: var(--boxel-font-size-med);
        }
      }
    </style>
  </template>
}

class Edit extends Component<typeof Spec> {
  get defaultIcon() {
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
      if (this.args.model.ref && this.args.model.id) {
        let card = await loadCard(this.args.model.ref, {
          loader: myLoader(),
          relativeTo: new URL(this.args.model.id),
        });
        icon.value = card.icon;
      }
    })();
    return icon;
  });

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
          {{else}}
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
          <BookOpenText width='20' height='20' role='presentation' />
          <h2 id='readme'>Read Me</h2>
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
          <@fields.containedExamples />
        {{else}}
          <@fields.linkedExamples @typeConstraint={{this.absoluteRef}} />
        {{/if}}
      </section>
      <section class='module section'>
        <header class='row-header' aria-labelledby='module'>
          <GitBranch width='20' height='20' role='presentation' />
          <h2 id='module'>Module</h2>
        </header>
        <div class='code-ref-container'>
          <FieldContainer @label='URL' @vertical={{true}}>
            <div class='code-ref-row'>
              <RealmIcon class='realm-icon' @realmInfo={{this.realmInfo}} />
              <span class='code-ref-value' data-test-module-href>
                {{@model.moduleHref}}
              </span>
            </div>
          </FieldContainer>
          <FieldContainer @label='Module Name' @vertical={{true}}>
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
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-lg);
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
      return (
        this.specType === 'card' ||
        this.specType === 'app' ||
        this.specType === 'skill'
      );
    },
  });
  @field moduleHref = contains(StringField, {
    computeVia: function (this: Spec) {
      return new URL(this.ref.module, this[relativeTo]).href;
    },
  });
  @field linkedExamples = linksToMany(CardDef);
  @field containedExamples = containsMany(FieldDef, { isUsed: true });
  @field title = contains(SpecTitleField);
  @field description = contains(SpecDescriptionField);

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
      <Pill class='spec-tag-pill' ...attributes>
        <:iconLeft>
          {{this.icon}}
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
    case 'skill':
      return Brain;
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
