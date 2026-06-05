import { on } from '@ember/modifier';
import {
  FieldContainer,
  GridContainer,
  Button,
  BoxelInput,
  IconButton,
} from '@cardstack/boxel-ui/components';
import {
  entriesToCssRuleMap,
  markdownEscape,
  not,
  type CssRuleMap,
} from '@cardstack/boxel-ui/helpers';

import { chooseFile, identifyCard } from '@cardstack/runtime-common';
import XIcon from '@cardstack/boxel-icons/x';

import {
  field,
  contains,
  getFields,
  Component,
  FieldDef,
  ImageDef,
  StringField,
  getFieldDescription,
} from './card-api';
import { buildCssVariableName } from '@cardstack/boxel-ui/helpers';
import { markdownLink } from './markdown-helpers';
import {
  type CssVariableField,
  type CssVariableFieldEntry,
} from './structured-theme-variables';
import URLField, { isValidUrl } from './url';

class Embedded extends Component<typeof BrandLogo> {
  <template>
    <GridContainer class='mark-usage-embedded'>
      <FieldContainer @label='Clearance Area' @vertical={{true}}>
        <div class='preview-field'>
          <p>Scales in proportion to size of logo used</p>
          <div class='preview-grid border-container'>
            <div class='preview-container'>
              <@fields.primaryMark1
                class='primary-mark clearance-annotation-border'
              />
            </div>
            <div class='preview-container'>
              <@fields.secondaryMark1
                class='secondary-mark clearance-annotation-border'
              />
            </div>
          </div>
        </div>
      </FieldContainer>
      {{! minimum size }}
      <FieldContainer @label='Minimum Size' @vertical={{true}}>
        <div class='preview-field'>
          <p>For screen use</p>
          <div class='preview-flex-container border-container'>
            <div class='preview-container'>
              <span class='annotation'><@fields.primaryMarkMinHeight /></span>
              <@fields.primaryMark1
                class='primary-mark height-annotation-border'
              />
            </div>
            <div class='preview-container'>
              <span class='annotation'>
                <@fields.secondaryMarkMinHeight />
              </span>
              <@fields.secondaryMark1
                class='secondary-mark height-annotation-border'
              />
            </div>
          </div>
        </div>
      </FieldContainer>
      {{! primary mark }}
      <GridContainer class='preview-grid'>
        <FieldContainer @label='Primary Mark 1' @vertical={{true}}>
          <div class='preview-field'>
            {{#let
              (getFieldDescription @model 'primaryMark1')
              as |description|
            }}
              <p>{{description}}</p>
            {{/let}}
            <div class='preview-container border-container'>
              <@fields.primaryMark1 class='primary-mark' />
            </div>
          </div>
        </FieldContainer>
        <FieldContainer @label='Primary Mark 2' @vertical={{true}}>
          <div class='preview-field'>
            {{#let
              (getFieldDescription @model 'primaryMark2')
              as |description|
            }}
              <p>{{description}}</p>
            {{/let}}
            <div class='preview-container border-container dark-container'>
              <@fields.primaryMark2 class='primary-mark' />
            </div>
          </div>
        </FieldContainer>
      </GridContainer>
      {{! secondary mark }}
      <GridContainer class='preview-grid'>
        <FieldContainer @label='Secondary Mark 1' @vertical={{true}}>
          <div class='preview-field'>
            {{#let
              (getFieldDescription @model 'secondaryMark1')
              as |description|
            }}
              <p>{{description}}</p>
            {{/let}}
            <div class='preview-container border-container'>
              <@fields.secondaryMark1 class='secondary-mark' />
            </div>
          </div>
        </FieldContainer>
        <FieldContainer @label='Secondary Mark 2' @vertical={{true}}>
          <div class='preview-field'>
            {{#let
              (getFieldDescription @model 'secondaryMark2')
              as |description|
            }}
              <p>{{description}}</p>
            {{/let}}
            <div class='preview-container border-container dark-container'>
              <@fields.secondaryMark2 class='secondary-mark' />
            </div>
          </div>
        </FieldContainer>
      </GridContainer>
      {{! greyscale versions }}
      <FieldContainer @label='Greyscale versions' @vertical={{true}}>
        <div class='preview-field'>
          <p>When full color option is not available, for display on light &
            dark backgrounds</p>
          <div class='preview-grid border-container border-group'>
            <div class='preview-container greyscale-group'>
              {{#if @model.primaryMarkGreyscale1}}
                <@fields.primaryMarkGreyscale1 class='primary-mark' />
              {{else}}
                <@fields.primaryMark1 class='primary-mark grayscale' />
              {{/if}}
              {{#if @model.secondaryMarkGreyscale1}}
                <@fields.secondaryMarkGreyscale1 class='secondary-mark' />
              {{else if @model.secondaryMark1}}
                <@fields.secondaryMark1 class='secondary-mark grayscale' />
              {{/if}}
            </div>
            <div class='preview-container greyscale-group dark-container'>
              {{#if @model.primaryMarkGreyscale2}}
                <@fields.primaryMarkGreyscale2 class='primary-mark' />
              {{else}}
                <@fields.primaryMark2 class='primary-mark grayscale' />
              {{/if}}
              {{#if @model.secondaryMarkGreyscale2}}
                <@fields.secondaryMarkGreyscale2 class='secondary-mark' />
              {{else if @model.secondaryMark2}}
                <@fields.secondaryMark2 class='secondary-mark grayscale' />
              {{/if}}
            </div>
          </div>
        </div>
      </FieldContainer>
      {{! social media icon }}
      <FieldContainer @label='Social media/profile icon' @vertical={{true}}>
        <div class='preview-field'>
          {{#let
            (getFieldDescription @model 'socialMediaProfileIcon')
            as |description|
          }}
            <p>{{description}}</p>
          {{/let}}
          <div class='preview-grid border-container border-group'>
            <div class='preview-container'>
              <div class='icon-preview-container'>
                <@fields.socialMediaProfileIcon class='profile-icon' />
              </div>
            </div>
            <div class='preview-container'>
              <div class='icon-preview-container'>
                <@fields.socialMediaProfileIcon class='profile-icon' />
              </div>
              <span class='media-handle'>@username</span>
            </div>
          </div>
        </div>
      </FieldContainer>
    </GridContainer>

    <style scoped>
      p {
        margin-block: 0;
      }
      .mark-usage-embedded {
        --annotation: rgba(255 0 0 / 0.15);
        --annotation-foreground: rgb(255 0 0);
        --container-border: 1px solid var(--border, var(--boxel-400));
        gap: var(--boxel-sp-xl);
      }
      .preview-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .preview-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
      .preview-flex-container {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-around;
      }
      .preview-flex-container > .preview-container {
        flex-wrap: nowrap;
      }
      .border-container {
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        border: var(--container-border);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .border-group > * + * {
        border-left: var(--container-border);
      }
      .preview-container {
        min-height: 11.25rem; /* 180px */
        max-width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        overflow: hidden;
      }
      .dark-container {
        background-color: var(--boxel-dark);
        color: var(--boxel-light);
      }
      .greyscale-group {
        justify-content: space-evenly;
        gap: var(--boxel-sp-6xs);
      }
      .clearance-annotation-border {
        border-color: var(--annotation);
        border-style: solid;
        border-width: var(--mark-clearance, 0px);
        box-sizing: content-box;
      }
      .annotation {
        color: var(--annotation-foreground);
        font-weight: 700;
        white-space: nowrap;
      }
      .height-annotation-border {
        padding-left: var(--boxel-sp-xs);
        border-left: 4px solid var(--annotation);
      }
      .primary-mark {
        --logo-min-height: var(--brand-primary-mark-min-height);
        --mark-clearance: calc(
          var(--brand-primary-mark-clearance-ratio) *
            var(--brand-primary-mark-min-height)
        );
      }
      .secondary-mark {
        --logo-min-height: var(--brand-secondary-mark-min-height);
        --mark-clearance: calc(
          var(--brand-secondary-mark-clearance-ratio) *
            var(--brand-secondary-mark-min-height)
        );
      }
      .profile-icon {
        --logo-min-height: var(--boxel-icon-lg);
        aspect-ratio: 1;
      }
      .grayscale {
        filter: grayscale(1);
      }
      .icon-preview-container {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: var(--container-border);
        border-radius: var(--boxel-border-radius-sm);
        overflow: hidden;
      }
      .media-handle {
        font-weight: 600;
      }
    </style>
  </template>
}

class MarkFieldEdit extends Component<typeof MarkField> {
  get validationState() {
    if (!this.args.model) {
      // do not error before any input
      return;
    }
    return isValidUrl(this.args.model) ? 'valid' : 'invalid';
  }

  uploadImage = async () => {
    let imageRef = identifyCard(ImageDef);
    let file = await chooseFile(
      imageRef ? { fileType: imageRef, fileTypeName: 'Image' } : undefined,
    );
    if (file?.url) {
      this.args.set(file.url);
    }
  };

  clearImage = () => {
    this.args.set(null);
  };

  <template>
    <div class='mark-field-edit'>
      <div class='mark-field-inputs'>
        <BoxelInput
          type='url'
          value={{@model}}
          @onInput={{@set}}
          @disabled={{not @canEdit}}
          @state={{this.validationState}}
          data-test-mark-url-input
        />
        {{#if @model}}
          {{#if @canEdit}}
            <IconButton
              class='mark-field-clear'
              @icon={{XIcon}}
              @width='16px'
              @height='16px'
              aria-label='Clear image'
              data-test-mark-clear
              {{on 'click' this.clearImage}}
            />
          {{/if}}
        {{/if}}
      </div>
      {{#unless @model}}
        {{#if @canEdit}}
          <span class='mark-field-or'>or</span>
          <Button
            @kind='secondary'
            @size='extra-small'
            data-test-mark-select-image
            {{on 'click' this.uploadImage}}
          >
            Select Image
          </Button>
        {{/if}}
      {{/unless}}
    </div>
    <style scoped>
      .mark-field-edit {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .mark-field-inputs {
        flex: 1;
        min-width: 0;
        position: relative;
      }
      .mark-field-inputs :deep(input) {
        width: 100%;
        padding-right: 2.5rem;
      }
      .mark-field-clear {
        position: absolute;
        top: 0;
        right: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 100%;
        opacity: 0.5;
        z-index: 1;
      }
      .mark-field-clear:hover,
      .mark-field-clear:focus {
        opacity: 1;
        outline: 0;
      }
      .mark-field-or {
        flex-shrink: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-400));
      }
    </style>
  </template>
}

export class MarkField extends URLField {
  static displayName = 'Mark URL';
  static edit = MarkFieldEdit;

  static embedded = class Embedded extends Component<typeof MarkField> {
    <template>
      <img
        class='mark-image'
        src={{@model}}
        {{! @glint-ignore }}
        ...attributes
      />
      <style scoped>
        @layer {
          .mark-image {
            width: auto;
            height: var(--logo-min-height, 2.5rem);
          }
        }
      </style>
    </template>
  };

  // CS-10787: render the mark as a markdown image — the URL is the asset,
  // and the alt text is empty (callers set alt via context).
  static markdown = class Markdown extends Component<typeof MarkField> {
    get text() {
      let url = this.args.model;
      if (!url) {
        return '';
      }
      let encoded: string;
      try {
        encoded = encodeURI(url);
      } catch {
        encoded = url;
      }
      encoded = encoded.replace(/\(/g, '%28').replace(/\)/g, '%29');
      return `![](${encoded})`;
    }
    <template>{{this.text}}</template>
  };
}

class BrandLogoEdit extends Component<typeof BrandLogo> {
  <template>
    <div class='brand-logo-edit'>

      <section class='brand-logo-edit-section'>
        <h4 class='brand-logo-edit-heading'>Primary Mark</h4>
        <div class='brand-logo-edit-row brand-logo-edit-row--2col'>
          <FieldContainer
            @label='Min Height'
            @vertical={{true}}
            data-test-field='primaryMarkMinHeight'
          >
            <@fields.primaryMarkMinHeight />
          </FieldContainer>
          <FieldContainer
            @label='Clearance Ratio'
            @vertical={{true}}
            data-test-field='primaryMarkClearanceRatio'
          >
            <@fields.primaryMarkClearanceRatio />
          </FieldContainer>
        </div>
        <div class='brand-logo-edit-row brand-logo-edit-row--2col'>
          <FieldContainer
            @label='Light Background'
            @vertical={{true}}
            data-test-field='primaryMark1'
          >
            <@fields.primaryMark1 />
          </FieldContainer>
          <FieldContainer
            @label='Dark Background'
            @vertical={{true}}
            data-test-field='primaryMark2'
          >
            <@fields.primaryMark2 />
          </FieldContainer>
        </div>
        <div class='brand-logo-edit-row brand-logo-edit-row--2col'>
          <FieldContainer
            @label='Greyscale — Light'
            @vertical={{true}}
            data-test-field='primaryMarkGreyscale1'
          >
            <@fields.primaryMarkGreyscale1 />
          </FieldContainer>
          <FieldContainer
            @label='Greyscale — Dark'
            @vertical={{true}}
            data-test-field='primaryMarkGreyscale2'
          >
            <@fields.primaryMarkGreyscale2 />
          </FieldContainer>
        </div>
      </section>

      <section class='brand-logo-edit-section'>
        <h4 class='brand-logo-edit-heading'>Secondary Mark</h4>
        <div class='brand-logo-edit-row brand-logo-edit-row--2col'>
          <FieldContainer
            @label='Min Height'
            @vertical={{true}}
            data-test-field='secondaryMarkMinHeight'
          >
            <@fields.secondaryMarkMinHeight />
          </FieldContainer>
          <FieldContainer
            @label='Clearance Ratio'
            @vertical={{true}}
            data-test-field='secondaryMarkClearanceRatio'
          >
            <@fields.secondaryMarkClearanceRatio />
          </FieldContainer>
        </div>
        <div class='brand-logo-edit-row brand-logo-edit-row--2col'>
          <FieldContainer
            @label='Light Background'
            @vertical={{true}}
            data-test-field='secondaryMark1'
          >
            <@fields.secondaryMark1 />
          </FieldContainer>
          <FieldContainer
            @label='Dark Background'
            @vertical={{true}}
            data-test-field='secondaryMark2'
          >
            <@fields.secondaryMark2 />
          </FieldContainer>
        </div>
        <div class='brand-logo-edit-row brand-logo-edit-row--2col'>
          <FieldContainer
            @label='Greyscale — Light'
            @vertical={{true}}
            data-test-field='secondaryMarkGreyscale1'
          >
            <@fields.secondaryMarkGreyscale1 />
          </FieldContainer>
          <FieldContainer
            @label='Greyscale — Dark'
            @vertical={{true}}
            data-test-field='secondaryMarkGreyscale2'
          >
            <@fields.secondaryMarkGreyscale2 />
          </FieldContainer>
        </div>
      </section>

      <section class='brand-logo-edit-section'>
        <h4 class='brand-logo-edit-heading'>Social Media Icon</h4>
        <FieldContainer
          @label='Profile Icon'
          @vertical={{true}}
          data-test-field='socialMediaProfileIcon'
        >
          <@fields.socialMediaProfileIcon />
        </FieldContainer>
      </section>

    </div>
    <style scoped>
      .brand-logo-edit {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      .brand-logo-edit-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .brand-logo-edit-heading {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-400));
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding-bottom: var(--boxel-sp-xs);
        border-bottom: 1px solid var(--border, var(--boxel-border-color));
      }
      .brand-logo-edit-row {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .brand-logo-edit-row--2col {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-sm);
      }
    </style>
  </template>
}

export default class BrandLogo extends FieldDef {
  static displayName = 'Mark Usage';

  // Mark Usage
  // primary mark
  @field primaryMarkClearanceRatio = contains(StringField);
  @field primaryMarkMinHeight = contains(StringField);
  @field primaryMark1 = contains(MarkField, {
    description: 'For use on light background',
  });
  @field primaryMark2 = contains(MarkField, {
    description: 'For use on dark background',
  });
  @field primaryMarkGreyscale1 = contains(MarkField, {
    description: 'Greyscale version for use on light background',
  });
  @field primaryMarkGreyscale2 = contains(MarkField, {
    description: 'Greyscale version for use on dark background',
  });

  // secondary mark
  @field secondaryMarkClearanceRatio = contains(StringField);
  @field secondaryMarkMinHeight = contains(StringField);
  @field secondaryMark1 = contains(MarkField, {
    description: 'For use on light background',
  });
  @field secondaryMark2 = contains(MarkField, {
    description: 'For use on dark background',
  });
  @field secondaryMarkGreyscale1 = contains(MarkField, {
    description: 'Greyscale version for use on light background',
  });
  @field secondaryMarkGreyscale2 = contains(MarkField, {
    description: 'Greyscale version for use on dark background',
  });

  // social media mark
  @field socialMediaProfileIcon = contains(MarkField, {
    description:
      'For social media purposes or any small format usage requiring 1:1 aspect ratio',
  });

  get cssVariableFields(): CssVariableFieldEntry[] | undefined {
    let fields = getFields(this);
    if (!fields) {
      return;
    }

    let fieldNames = Object.keys(fields);
    if (!fieldNames?.length) {
      return;
    }

    let cssVariableFields: CssVariableFieldEntry[] = [];
    for (let fieldName of fieldNames) {
      let cssVariableName = buildCssVariableName(fieldName, {
        prefix: 'brand',
      });
      let value = (this as CssVariableField)?.[fieldName];
      cssVariableFields.push({
        fieldName,
        cssVariableName,
        name: cssVariableName,
        value,
      });
    }

    return cssVariableFields;
  }

  get cssRuleMap(): CssRuleMap | undefined {
    if (!entriesToCssRuleMap) {
      return;
    }
    return entriesToCssRuleMap(this.cssVariableFields);
  }

  static edit = BrandLogoEdit;
  static embedded = Embedded;

  // CS-10787: emit a bulleted list of the logo URLs that are actually
  // populated. Skips empty slots so the output stays compact.
  static markdown = class Markdown extends Component<typeof BrandLogo> {
    get text() {
      let model = this.args.model;
      if (!model) {
        return '';
      }
      let rows: { label: string; url: string }[] = [];
      let pairs: { key: keyof typeof model; label: string }[] = [
        { key: 'primaryMark1', label: 'Primary mark (light)' },
        { key: 'primaryMark2', label: 'Primary mark (dark)' },
        {
          key: 'primaryMarkGreyscale1',
          label: 'Primary mark greyscale (light)',
        },
        {
          key: 'primaryMarkGreyscale2',
          label: 'Primary mark greyscale (dark)',
        },
        { key: 'secondaryMark1', label: 'Secondary mark (light)' },
        { key: 'secondaryMark2', label: 'Secondary mark (dark)' },
        {
          key: 'secondaryMarkGreyscale1',
          label: 'Secondary mark greyscale (light)',
        },
        {
          key: 'secondaryMarkGreyscale2',
          label: 'Secondary mark greyscale (dark)',
        },
        { key: 'socialMediaProfileIcon', label: 'Social media icon' },
      ];
      for (let { key, label } of pairs) {
        let url = model[key] as string | undefined;
        if (url) {
          rows.push({ label, url });
        }
      }
      if (!rows.length) {
        return '';
      }
      return rows
        .map(
          ({ label, url }) =>
            `- ${markdownEscape(label)}: ${markdownLink(url, url)}`,
        )
        .join('\n');
    }
    <template>{{this.text}}</template>
  };
}
