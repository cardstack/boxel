import {
  sanitizeHtmlSafe,
  type CssVariableEntry,
} from '@cardstack/boxel-ui/helpers';

import {
  field,
  contains,
  Component,
  FieldDef,
  getFields,
  StringField,
} from './card-api';
import CSSValueField from './css-value';
import { type CssVariableField } from './structured-theme-variables';

class TypographyEmbedded extends Component<typeof TypographyField> {
  <template>
    <div class='typography-sample' style={{this.styles}}>
      {{#if @model.sampleText}}
        {{@model.sampleText}}
      {{else}}
        The quick brown fox
      {{/if}}
    </div>
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
}

export default class TypographyField extends FieldDef {
  static displayName = 'Typography';

  @field fontFamily = contains(CSSValueField);
  @field fontSize = contains(CSSValueField);
  @field fontWeight = contains(CSSValueField);
  @field lineHeight = contains(CSSValueField);
  @field sampleText = contains(StringField);

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

  get styleSummary() {
    let { fontFamily, fontSize, fontWeight } = this;

    switch (fontWeight) {
      case '300':
      case 'light':
        fontWeight = 'light';
        break;
      case '400':
      case 'normal':
        fontWeight = 'regular';
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

    fontFamily = fontFamily?.split(',')?.[0]?.replace(/'/g, '') ?? 'Sans-serif';

    return sanitizeHtmlSafe(
      `${fontFamily} ${fontWeight ?? 'regular'}, ${fontSize ?? '14px'}`,
    );
  }

  static embedded = TypographyEmbedded;
}
