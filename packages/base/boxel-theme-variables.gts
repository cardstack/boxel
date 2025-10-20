import { CopyButton } from '@cardstack/boxel-ui/components';
import {
  entriesToCssRuleMap,
  type CssVariableEntry,
} from '@cardstack/boxel-ui/helpers';

import {
  field,
  contains,
  Component,
  getFields,
  StringField,
  type BaseDefComponent,
  type BoxComponent,
  type FieldsTypeFor,
} from './card-api';
import URLField from './url';
import CSSValueField from './css-value';
import type { CssRuleMap } from '@cardstack/boxel-ui/helpers';
import ThemeVarField, { dasherize } from './structured-theme-variables';

type FieldNameType = keyof FieldsTypeFor<ThemeVarField> & string;

interface CssVariableField extends CssVariableEntry {
  fieldName: FieldNameType;
  cssVariableName: string;
  component?: BoxComponent;
}

class Embedded extends Component<typeof BoxelThemeVarField> {
  private get cssFields(): CssVariableField[] | undefined {
    let fields = this.args.fields;
    let cssFields = this.args.model.cssVariableFields;
    cssFields = cssFields?.map((f) => ({
      component: fields?.[f.fieldName],
      ...f,
    }));
    return cssFields;
  }

  <template>
    <div class='field-list'>
      {{#each this.cssFields as |field|}}
        <div class='code-preview'>
          <span class='css-label'>{{field.cssVariableName}}</span>
          <CopyButton
            class='copy-button'
            @textToCopy={{field.cssVariableName}}
            @width='16px'
            @height='16px'
            @ariaLabel='Copy CSS variable name'
          />
        </div>
        <div class='code-preview'>
          {{#if field.value}}
            <span
              class='css-value'
              data-test-var-value={{field.fieldName}}
            ><field.component /></span>
            <CopyButton
              class='copy-button'
              @textToCopy={{field.value}}
              @width='16px'
              @height='16px'
              @ariaLabel='Copy CSS variable value'
            />
          {{else}}
            <span class='css-value empty-state'>/* not set */</span>
          {{/if}}
        </div>
      {{/each}}
    </div>
    <style scoped>
      @layer baseComponent {
        .field-list {
          display: grid;
          grid-template-columns: 1fr 1.5fr;
          align-items: center;
          column-gap: var(--boxel-sp-xs);
          row-gap: var(--boxel-sp-sm);
        }
        .code-preview {
          min-height: 2.5em;
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
          overflow-wrap: break-word;
          word-break: break-word;
        }
        .css-label {
          font-weight: var(--boxel-font-weight-medium);
        }
        .css-value {
          display: flex;
          padding: var(--boxel-sp-4xs);
          border-radius: var(--boxel-border-radius-sm);
          background-color: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-500));
        }
        .empty-state {
          font-style: italic;
        }
        .copy-button {
          color: var(--primary);
          opacity: 0;
        }
        .code-preview:focus-within .copy-button,
        .code-preview:hover .copy-button {
          opacity: 1;
        }
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
            min-width: 50%;
            width: auto;
            height: var(--logo-min-height, 2.5rem);
          }
        }
      </style>
    </template>
  };
}

export default class BoxelThemeVarField extends ThemeVarField {
  static displayName = 'Boxel Theme Variables';

  @field cornerRadius = contains(CSSValueField);
  @field spacingUnit = contains(CSSValueField);

  @field headingFontFamily = contains(CSSValueField);
  @field headingFontSize = contains(CSSValueField);
  @field headingFontWeight = contains(CSSValueField);
  @field headingLineHeight = contains(CSSValueField);

  @field bodyFontFamily = contains(CSSValueField);
  @field bodyFontSize = contains(CSSValueField);
  @field bodyFontWeight = contains(CSSValueField);
  @field bodyLineHeight = contains(CSSValueField);

  // primary mark (logo)
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
  // secondary mark (logo)
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
  // social media mark (logo)
  @field socialMediaProfileIcon = contains(MarkField, {
    description:
      'For social media purposes or any small format usage requiring 1:1 aspect ratio',
  });

  get cssVariableFields(): CssVariableField[] | undefined {
    let fields = getFields(this);
    if (!fields) {
      return;
    }

    let fieldNames = Object.keys(fields) as FieldNameType[];
    if (!fieldNames?.length) {
      return;
    }
    let cssVariableFields: CssVariableField[] = [];
    for (let fieldName of fieldNames) {
      let cssVariableName = `--${dasherize(fieldName)}`;
      let value = this?.[fieldName] as string | undefined | null;
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

  static embedded: BaseDefComponent = Embedded;
}
