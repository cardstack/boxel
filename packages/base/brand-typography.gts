import { FieldContainer, GridContainer } from '@cardstack/boxel-ui/components';
import {
  entriesToCssRuleMap,
  sanitizeHtmlSafe,
  type CssVariableEntry,
  type CssRuleMap,
} from '@cardstack/boxel-ui/helpers';

import { field, contains, getFields, Component, FieldDef } from './card-api';
import CSSValueField from './css-value';
import {
  dasherize,
  type CssVariableField,
  type CssVariableFieldEntry,
} from './structured-theme-variables';

const DEFAULT_HEADING_FONT_SIZE = '20px';
const DEFAULT_BODY_FONT_SIZE = '13px';
const DEFAULT_FONT_FAMILY = 'Poppins';
const DEFAULT_FONT_WEIGHT = 'regular';

class Embedded extends Component<typeof BrandTypography> {
  <template>
    <GridContainer class='preview-grid'>
      <FieldContainer
        class='preview-container'
        @vertical={{true}}
        @label='Headline'
      >
        <@fields.heading />
      </FieldContainer>
      <FieldContainer
        class='preview-container'
        @vertical={{true}}
        @label='Body Copy'
      >
        <@fields.body />
      </FieldContainer>
    </GridContainer>

    <style scoped>
      .preview-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
      .preview-container {
        gap: 0;
      }
    </style>
  </template>
}

class TypographyEmbedded extends Component<typeof TypographyField> {
  <template>
    <div class='preview-field'>
      <p>{{this.styleSummary}}</p>
      <div class='typography-preview' style={{this.styles}}>
        The quick brown fox
      </div>
    </div>
    <style scoped>
      .preview-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      p {
        margin-block: 0;
      }
      .typography-preview {
        display: flex;
        align-items: center;
        justify-content: center;
        max-width: 100%;
        min-height: 11.25rem; /* 180px */
        background-color: var(--muted, var(--boxel-100));
        color: var(--foreground, var(--boxel-dark));
        border-radius: var(--boxel-border-radius);
        text-align: center;
        overflow: hidden;
      }
    </style>
  </template>

  private get styles() {
    let { fontFamily, fontSize, fontWeight, lineHeight } = this.args.model;
    let styles = [];
    let fontFamilyValue = fontFamily?.trim() || this.defaultFontFamily;
    if (fontFamilyValue) {
      styles.push(`font-family: ${fontFamilyValue}`);
    }
    let fontSizeValue = fontSize?.trim() || this.defaultFontSize;
    if (fontSizeValue) {
      styles.push(`font-size: ${fontSizeValue}`);
    }
    if (fontWeight) {
      styles.push(`font-weight: ${fontWeight}`);
    }
    if (lineHeight) {
      styles.push(`line-height: ${lineHeight}`);
    }
    return sanitizeHtmlSafe(styles.join('; '));
  }

  private get styleSummary() {
    let { fontFamily, fontSize, fontWeight } = this.args.model;
    let summaryFontFamily =
      fontFamily?.split(',')?.[0]?.trim()?.replace(/'/g, '') ??
      this.defaultFontFamily;
    let trimmedFontSize = fontSize?.trim();
    let summaryFontSize =
      trimmedFontSize && trimmedFontSize.length
        ? trimmedFontSize
        : this.defaultFontSize;
    let summaryFontWeight = this.normalizedFontWeight(fontWeight);

    return sanitizeHtmlSafe(
      `${summaryFontFamily} ${summaryFontSize}, ${summaryFontWeight}`,
    );
  }

  private get defaultFontSize() {
    return this.args.fieldName === 'heading'
      ? DEFAULT_HEADING_FONT_SIZE
      : DEFAULT_BODY_FONT_SIZE;
  }

  private get defaultFontFamily() {
    return DEFAULT_FONT_FAMILY;
  }

  private get defaultFontWeight() {
    return DEFAULT_FONT_WEIGHT;
  }

  private normalizedFontWeight(weight?: string) {
    if (!weight) {
      return this.defaultFontWeight;
    }
    switch (weight) {
      case '300':
      case 'light':
        return 'light';
      case '400':
      case 'normal':
        return 'regular';
      case '500':
      case 'medium':
        return 'medium';
      case '600':
      case 'semibold':
        return 'semibold';
      case '700':
      case 'bold':
        return 'bold';
      case '800':
      case 'extrabold':
        return 'extrabold';
      default:
        return weight;
    }
  }
}

export class TypographyField extends FieldDef {
  static displayName = 'Typography';

  @field fontFamily = contains(CSSValueField);
  @field fontSize = contains(CSSValueField);
  @field fontWeight = contains(CSSValueField);
  @field lineHeight = contains(CSSValueField);

  get fieldEntries(): CssVariableEntry[] | undefined {
    let fields = getFields(this);
    if (!fields) {
      return;
    }

    let fieldNames = Object.keys(fields);
    if (!fieldNames?.length) {
      return;
    }

    let entries: CssVariableEntry[] = [];
    for (let name of fieldNames) {
      let value = (this as CssVariableField)?.[name];
      entries.push({
        name,
        value,
      });
    }
    return entries;
  }

  static embedded = TypographyEmbedded;
}

export default class BrandTypography extends FieldDef {
  static displayName = 'Brand Typography';

  @field heading = contains(TypographyField);
  @field body = contains(TypographyField);

  get cssVariableFields(): CssVariableFieldEntry[] | undefined {
    let fields = getFields(this);
    if (!fields) {
      return;
    }

    let cssVariableFields: CssVariableFieldEntry[] = [];

    let headingFields = this.heading?.fieldEntries;
    if (headingFields) {
      for (let { name, value } of headingFields) {
        if (!name) {
          continue;
        }
        let resolvedValue = value;
        if (name === 'fontSize' && (!resolvedValue || resolvedValue.trim() === '')) {
          resolvedValue = DEFAULT_HEADING_FONT_SIZE;
        }
        if (!resolvedValue) {
          continue;
        }
        let cssVariableName = `--brand-heading-${dasherize(name)}`;
        cssVariableFields.push({
          fieldName: name,
          cssVariableName,
          name: cssVariableName,
          value: resolvedValue,
        });
      }
    }

    let bodyFields = this.body?.fieldEntries;
    if (bodyFields) {
      for (let { name, value } of bodyFields) {
        if (name && value) {
          let cssVariableName = `--brand-body-${dasherize(name)}`;
          cssVariableFields.push({
            fieldName: name,
            cssVariableName,
            name: cssVariableName,
            value,
          });
        }
      }
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
