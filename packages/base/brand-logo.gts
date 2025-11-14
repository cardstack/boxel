import { concat } from '@ember/helper';
import GlimmerComponent from '@glimmer/component';
import { FieldContainer, GridContainer } from '@cardstack/boxel-ui/components';
import {
  cn,
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
  type BaseDef,
} from './card-api';
import {
  dasherize,
  type CssVariableField,
  type CssVariableFieldEntry,
} from './structured-theme-variables';
import URLField from './url';

const DEFAULT_LOGO_MIN_HEIGHT = '40px';
const DEFAULT_LOGO_CLEARANCE_RATIO = 0.25;
const LOGO_MIN_HEIGHT_FIELDS = new Set([
  'primaryMarkMinHeight',
  'secondaryMarkMinHeight',
]);
const LOGO_CLEARANCE_FIELDS: Record<string, string> = {
  primaryMarkClearanceRatio: '--brand-primary-mark-min-height',
  secondaryMarkClearanceRatio: '--brand-secondary-mark-min-height',
};

const getFieldValue = (model?: Partial<BrandLogo>, fieldName?: string) => {
  if (!model || !fieldName) {
    return;
  }
  return getField(model as BaseDef, fieldName);
};

class Embedded extends Component<typeof BrandLogo> {
  <template>
    <GridContainer class='mark-usage-embedded'>
      <FieldContainer @label='Clearance Area' @vertical={{true}}>
        <div class='preview-field'>
          <p>Scales in proportion to size of logo used</p>
          <div class='preview-grid border-container'>
            <div class='preview-container'>
              <div class='primary-mark clearance-annotation-border'>
                <@fields.primaryMark1 />
              </div>
            </div>
            <div class='preview-container'>
              <div class='secondary-mark clearance-annotation-border'>
                <@fields.secondaryMark1 />
              </div>
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
              <span class='annotation'>
                {{#if @model.primaryMarkMinHeight}}
                  <@fields.primaryMarkMinHeight />
                {{else}}
                  {{DEFAULT_LOGO_MIN_HEIGHT}}
                {{/if}}
              </span>
              <div class='primary-mark height-annotation-border'>
                <@fields.primaryMark1 />
              </div>
            </div>
            <div class='preview-container'>
              <span class='annotation'>
                {{#if @model.secondaryMarkMinHeight}}
                  <@fields.secondaryMarkMinHeight />
                {{else}}
                  {{DEFAULT_LOGO_MIN_HEIGHT}}
                {{/if}}
              </span>
              <div class='secondary-mark height-annotation-border'>
                <@fields.secondaryMark1 />
              </div>
            </div>
          </div>
        </div>
      </FieldContainer>
      {{! primary mark }}
      <GridContainer class='preview-grid'>
        <FieldContainer @label='Primary Mark 1' @vertical={{true}}>
          <div class='preview-field'>
            {{#let (getFieldValue @model 'primaryMark1') as |f|}}
              <p>{{f.description}}</p>
            {{/let}}
            <div class='preview-container border-container'>
              <LogoContainer @variant='primary'>
                <@fields.primaryMark1 />
              </LogoContainer>
            </div>
          </div>
        </FieldContainer>
        <FieldContainer @label='Primary Mark 2' @vertical={{true}}>
          <div class='preview-field'>
            {{#let (getFieldValue @model 'primaryMark2') as |f|}}
              <p>{{f.description}}</p>
            {{/let}}
            <div class='preview-container border-container dark-container'>
              <LogoContainer @variant='primary'>
                {{#if @model.primaryMark2}}
                  <@fields.primaryMark2 />
                {{else if @model.primaryMark1}}
                  <@fields.primaryMark1 />
                {{/if}}
              </LogoContainer>
            </div>
          </div>
        </FieldContainer>
      </GridContainer>
      {{! secondary mark }}
      <GridContainer class='preview-grid'>
        <FieldContainer @label='Secondary Mark 1' @vertical={{true}}>
          <div class='preview-field'>
            {{#let (getFieldValue @model 'secondaryMark1') as |f|}}
              <p>{{f.description}}</p>
            {{/let}}
            <div class='preview-container border-container'>
              <LogoContainer @variant='secondary'>
                <@fields.secondaryMark1 />
              </LogoContainer>
            </div>
          </div>
        </FieldContainer>
        <FieldContainer @label='Secondary Mark 2' @vertical={{true}}>
          <div class='preview-field'>
            {{#let (getFieldValue @model 'secondaryMark2') as |f|}}
              <p>{{f.description}}</p>
            {{/let}}
            <div class='preview-container border-container dark-container'>
              <LogoContainer @variant='secondary'>
                {{#if @model.secondaryMark2}}
                  <@fields.secondaryMark2 />
                {{else if @model.secondaryMark1}}
                  <@fields.secondaryMark1 />
                {{/if}}
              </LogoContainer>
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
                <LogoContainer @variant='primary'>
                  <@fields.primaryMarkGreyscale1 />
                </LogoContainer>
              {{else}}
                <LogoContainer @variant='primary' @isGreyscale={{true}}>
                  <@fields.primaryMark1 />
                </LogoContainer>
              {{/if}}
              {{#if @model.secondaryMarkGreyscale1}}
                <LogoContainer @variant='secondary'>
                  <@fields.secondaryMarkGreyscale1 />
                </LogoContainer>
              {{else if @model.secondaryMark1}}
                <LogoContainer @variant='secondary' @isGreyscale={{true}}>
                  <@fields.secondaryMark1 />
                </LogoContainer>
              {{/if}}
            </div>
            <div class='preview-container greyscale-group dark-container'>
              {{#if @model.primaryMarkGreyscale2}}
                <LogoContainer @variant='primary'>
                  <@fields.primaryMarkGreyscale2 />
                </LogoContainer>
              {{else}}
                <LogoContainer @variant='primary' @isGreyscale={{true}}>
                  <@fields.primaryMark2 />
                </LogoContainer>
              {{/if}}
              {{#if @model.secondaryMarkGreyscale2}}
                <LogoContainer @variant='secondary'>
                  <@fields.secondaryMarkGreyscale2 />
                </LogoContainer>
              {{else if @model.secondaryMark2}}
                <LogoContainer @variant='secondary' @isGreyscale={{true}}>
                  <@fields.secondaryMark2 />
                </LogoContainer>
              {{/if}}
            </div>
          </div>
        </div>
      </FieldContainer>
      {{! social media icon }}
      <FieldContainer @label='Social media/profile icon' @vertical={{true}}>
        <div class='preview-field'>
          {{#let (getFieldValue @model 'socialMediaProfileIcon') as |field|}}
            <p>{{field.description}}</p>
          {{/let}}
          <div class='preview-grid border-container border-group'>
            <div class='preview-container'>
              <LogoContainer @variant='profile' class='icon-preview-container'>
                <@fields.socialMediaProfileIcon />
              </LogoContainer>
            </div>
            <div class='preview-container'>
              <LogoContainer @variant='profile' class='icon-preview-container'>
                <@fields.socialMediaProfileIcon />
              </LogoContainer>
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
        --logo-min-height: 40px;
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
        background-color: var(--foreground, var(--boxel-dark));
        color: var(--background, var(--boxel-light));
      }
      .greyscale-group {
        justify-content: space-evenly;
        gap: var(--boxel-sp-6xs);
      }
      .clearance-annotation-border {
        height: var(--logo-min-height);
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
        height: var(--logo-min-height);
        padding-left: var(--mark-clearance, var(--boxel-sp-xs));
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
      <img class='mark-image' src={{@model}} />
      <style scoped>
        .mark-image {
          min-height: var(--logo-min-height, 40px);
          max-width: 100%;
          max-height: 100%;
        }
      </style>
    </template>
  };
}

export class LogoContainer extends GlimmerComponent<{
  Args: {
    height?: string;
    margin?: string;
    width?: string;
    variant?: 'primary' | 'secondary' | 'profile';
    isGreyscale?: boolean;
  };
  Element: HTMLElement;
  Blocks: { default: [] };
}> {
  <template>
    <figure
      class={{cn
        'mark-container'
        (if @variant (concat 'mark--' @variant))
        mark--greyscale=@isGreyscale
      }}
      ...attributes
    >
      {{yield}}
    </figure>
    <style scoped>
      @layer {
        .mark-container {
          --logo-height: var(--logo-min-height, 40px);
          --mark-container-height: calc(
            var(--logo-height) + 2 * var(--mark-clearance, 0px)
          );
          margin: 0;
          padding: var(--mark-clearance, 0px);
          height: var(--mark-container-height);
        }
        .mark--primary {
          --logo-min-height: var(--brand-primary-mark-min-height);
          --mark-clearance: calc(
            var(--brand-primary-mark-clearance-ratio) *
              var(--brand-primary-mark-min-height)
          );
        }
        .mark--secondary {
          --logo-min-height: var(--brand-secondary-mark-min-height);
          --mark-clearance: calc(
            var(--brand-secondary-mark-clearance-ratio) *
              var(--brand-secondary-mark-min-height)
          );
        }
        .mark--greyscale {
          filter: grayscale(1);
        }
        .mark--profile {
          --logo-min-height: var(--boxel-icon-med);
          --mark-clearance: 5px;
          aspect-ratio: 1;
        }
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
      let cssVariableName = `--brand-${dasherize(fieldName)}`;
      let value = (this as CssVariableField)?.[fieldName];
      if (
        (value == null || value === '') &&
        LOGO_MIN_HEIGHT_FIELDS.has(fieldName)
      ) {
        value = DEFAULT_LOGO_MIN_HEIGHT;
      } else if (
        (value == null || value === '') &&
        fieldName in LOGO_CLEARANCE_FIELDS
      ) {
        value = DEFAULT_LOGO_CLEARANCE_RATIO;
      } else if (!value && this.primaryMark1 && fieldName === 'primaryMark2') {
        value = (this as CssVariableField)?.primaryMark1;
      } else if (
        !value &&
        this.secondaryMark1 &&
        fieldName === 'secondaryMark2'
      ) {
        value = (this as CssVariableField)?.secondaryMark1;
      }
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
