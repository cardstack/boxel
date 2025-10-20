import {
  BoxelContainer,
  CopyButton,
  GridContainer,
  FieldContainer,
  Swatch,
} from '@cardstack/boxel-ui/components';
import {
  entriesToCssRuleMap,
  type CssVariableEntry,
} from '@cardstack/boxel-ui/helpers';

import {
  field,
  contains,
  Component,
  getFields,
  FieldDef,
  StringField,
  type BaseDefComponent,
  type BoxComponent,
  type FieldsTypeFor,
  type BaseDef,
} from './card-api';
import ColorField from './color';
import URLField from './url';
import CSSValueField from './css-value';
import type { CssRuleMap } from '@cardstack/boxel-ui/helpers';
import { dasherize } from './structured-theme-variables';

type FieldNameType<T extends BaseDef> = Exclude<
  keyof FieldsTypeFor<T>,
  ['constructor', 'cssVariableFields', 'cssRuleMap']
> &
  string;

type FunctionalPaletteKeys = Exclude<
  keyof FieldsTypeFor<FunctionalPalette>,
  ['constructor', 'cssVariableFields', 'cssRuleMap']
> &
  string;

interface CssVariableField extends CssVariableEntry {
  fieldName: FieldNameType<BrandThemeVarField | FunctionalPalette>;
  cssVariableName: string;
  component?: BoxComponent;
}

class Embedded extends Component<typeof BrandThemeVarField> {
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
    <BoxelContainer>
      <@fields.functionalPalette />

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
    </BoxelContainer>
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

class FunctionalPaletteEmbedded extends Component<typeof FunctionalPalette> {
  <template>
    <GridContainer class='functional-palette'>
      {{#each @model.cssVariableFields as |color|}}
        <FieldContainer
          class='functional-palette-item'
          @label={{color.name}}
          @vertical={{true}}
        >
          <Swatch @color={{color.value}} />
        </FieldContainer>
      {{/each}}
    </GridContainer>
    <style scoped>
      .functional-palette {
        grid-template-columns: repeat(auto-fill, 9rem);
        gap: var(--boxel-sp-xl) var(--boxel-sp);
      }
      .functional-palette-item {
        grid-template-rows: 1fr auto;
      }
    </style>
  </template>
}

export class FunctionalPalette extends FieldDef {
  static displayName = 'Functional Palette';
  @field primary = contains(ColorField);
  @field secondary = contains(ColorField);
  @field neutral = contains(ColorField);
  @field light = contains(ColorField);
  @field dark = contains(ColorField);
  @field accent = contains(ColorField);

  static embedded = FunctionalPaletteEmbedded;

  get cssVariableFields(): CssVariableField[] | undefined {
    let fields = getFields(this);
    if (!fields) {
      return;
    }

    let fieldNames = Object.keys(fields) as FunctionalPaletteKeys[];
    if (!fieldNames?.length) {
      return;
    }
    let cssVariableFields: CssVariableField[] = [];
    for (let fieldName of fieldNames) {
      let cssVariableName = `--brand-${dasherize(fieldName)}`;
      let value = this?.[fieldName] as string | undefined | null;
      cssVariableFields.push({
        fieldName: fieldName as FieldNameType<
          BrandThemeVarField | FunctionalPalette
        >,
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
}

export default class BrandThemeVarField extends FieldDef {
  static displayName = 'Brand Theme Variables';

  @field functionalPalette = contains(FunctionalPalette);

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

  // mark usage (logo)
  @field primaryMarkClearanceRatio = contains(StringField);
  @field primaryMarkMinHeight = contains(StringField);
  @field primaryMark = contains(URLField);
  @field primaryMarkGreyscale = contains(URLField);
  @field secondaryMarkClearanceRatio = contains(StringField);
  @field secondaryMarkMinHeight = contains(StringField);
  @field secondaryMark = contains(URLField);
  @field secondaryMarkGreyscale = contains(URLField);
  @field socialMediaProfileIcon = contains(URLField, {
    description:
      'For social media purposes or any small format usage requiring 1:1 aspect ratio',
  });

  get cssVariableFields(): CssVariableField[] | undefined {
    let fields = getFields(this);
    if (!fields) {
      return;
    }

    let fieldNames = Object.keys(fields) as FieldNameType<BrandThemeVarField>[];
    if (!fieldNames?.length) {
      return;
    }
    let cssVariableFields: CssVariableField[] = [];
    for (let fieldName of fieldNames) {
      if (fieldName === 'functionalPalette') {
        continue;
      }
      let cssVariableName = `--brand-${dasherize(fieldName)}`;
      let value = this?.[fieldName] as string | undefined | null;
      cssVariableFields.push({
        fieldName: fieldName as FieldNameType<
          BrandThemeVarField | FunctionalPalette
        >,
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
