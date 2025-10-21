import { FieldContainer, GridContainer } from '@cardstack/boxel-ui/components';
import {
  entriesToCssRuleMap,
  type CssRuleMap,
} from '@cardstack/boxel-ui/helpers';

import { getField } from '@cardstack/runtime-common';

import {
  field,
  contains,
  getFields,
  Component,
  FieldDef,
  StringField,
} from './card-api';
import {
  dasherize,
  type CssVariableField,
  type CssVariableFieldEntry,
} from './structured-theme-variables';
import URLField from './url';

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
          <div class='preview-grid border-container'>
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
            {{#let (getField @model 'primaryMark1') as |f|}}
              <p>{{f.description}}</p>
            {{/let}}
            <div class='preview-container border-container'>
              <@fields.primaryMark1 class='primary-mark' />
            </div>
          </div>
        </FieldContainer>
        <FieldContainer @label='Primary Mark 2' @vertical={{true}}>
          <div class='preview-field'>
            {{#let (getField @model 'primaryMark2') as |f|}}
              <p>{{f.description}}</p>
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
            {{#let (getField @model 'secondaryMark1') as |f|}}
              <p>{{f.description}}</p>
            {{/let}}
            <div class='preview-container border-container'>
              <@fields.secondaryMark1 class='secondary-mark' />
            </div>
          </div>
        </FieldContainer>
        <FieldContainer @label='Secondary Mark 2' @vertical={{true}}>
          <div class='preview-field'>
            {{#let (getField @model 'secondaryMark2') as |f|}}
              <p>{{f.description}}</p>
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
          {{#let (getField @model 'socialMediaProfileIcon') as |field|}}
            <p>{{field.description}}</p>
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
      .border-container {
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
        overflow: hidden;
      }
      .border-container {
        border: var(--container-border);
        border-radius: var(--boxel-border-radius);
      }
      .dark-container {
        background-color: var(--foreground);
        color: var(--background);
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
        font-weight: var(--boxel-font-weight-bold);
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
        padding: 5px;
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
        font-weight: var(--boxel-font-weight-semibold);
      }
    </style>
  </template>
}

export class MarkField extends URLField {
  static displayName = 'Mark URL';
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <img
        class='mark-image'
        src={{@model}}
        role='presentation'
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
      let cssVariableName = `--brand-${dasherize(fieldName)}`;
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

  static embedded = Embedded;
}
