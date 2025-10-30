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
        @label='Body'
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
    if (fontFamily) {
      styles.push(`font-family: ${fontFamily}`);
    }
    if (fontSize) {
      styles.push(`font-size: ${fontSize}`);
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

    switch (fontWeight) {
      case '300':
      case 'light':
        fontWeight = 'light';
        break;
      case '400':
      case 'normal':
        fontWeight = 'normal';
        break;
      case '500':
      case 'medium':
        fontWeight = 'medium';
        break;
      case '600':
      case 'semibold':
        fontWeight = 'semibold';
        break;
      case '700':
      case 'bold':
        fontWeight = 'bold';
        break;
      case '800':
      case 'extrabold':
        fontWeight = 'extrabold';
        break;
      default:
        fontWeight;
    }

    fontFamily = fontFamily?.split(',')?.[0]?.replace(/'/g, '') ?? 'Poppins';

    return sanitizeHtmlSafe(
      `${fontFamily} ${fontWeight ?? 'normal'}, ${fontSize ?? '16px'}`,
    );
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
        if (name && value) {
          let cssVariableName = `--brand-heading-${dasherize(name)}`;
          cssVariableFields.push({
            fieldName: name,
            cssVariableName,
            name: cssVariableName,
            value,
          });
        }
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
