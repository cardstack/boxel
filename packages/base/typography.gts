import {
  markdownEscape,
  sanitizeHtmlSafe,
  type CssVariableEntry,
} from '@cardstack/boxel-ui/helpers';
import { FieldContainer } from '@cardstack/boxel-ui/components';

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

  static edit = class Edit extends Component<typeof TypographyField> {
    private get styles() {
      let { fontFamily, fontSize, fontWeight, lineHeight } = this.args.model;
      let styles = [];
      if (fontFamily) styles.push(`font-family: ${fontFamily}`);
      if (fontSize) styles.push(`font-size: ${fontSize}`);
      if (fontWeight) styles.push(`font-weight: ${fontWeight}`);
      if (lineHeight) styles.push(`line-height: ${lineHeight}`);
      return sanitizeHtmlSafe(styles.join('; '));
    }

    <template>
      <div class='typography-edit'>
        <div class='typography-edit-preview' style={{this.styles}}>
          {{#if @model.sampleText}}
            {{@model.sampleText}}
          {{else}}
            The quick brown fox
          {{/if}}
        </div>
        <div class='typography-edit-row typography-edit-row--2col'>
          <FieldContainer @label='Font Family' @vertical={{true}}>
            <@fields.fontFamily />
          </FieldContainer>
          <FieldContainer @label='Font Size' @vertical={{true}}>
            <@fields.fontSize />
          </FieldContainer>
        </div>
        <div class='typography-edit-row typography-edit-row--2col'>
          <FieldContainer @label='Font Weight' @vertical={{true}}>
            <@fields.fontWeight />
          </FieldContainer>
          <FieldContainer @label='Line Height' @vertical={{true}}>
            <@fields.lineHeight />
          </FieldContainer>
        </div>
        <FieldContainer @label='Sample Text' @vertical={{true}}>
          <@fields.sampleText />
        </FieldContainer>
      </div>
      <style scoped>
        .typography-edit {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .typography-edit-preview {
          padding: var(--boxel-sp-sm) var(--boxel-sp);
          background: var(--muted, var(--boxel-100));
          border-radius: var(--boxel-border-radius-sm);
          color: var(--foreground, var(--boxel-dark));
          min-height: 2.5rem;
          display: flex;
          align-items: center;
          word-break: break-word;
        }
        .typography-edit-row {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .typography-edit-row--2col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp-sm);
        }
      </style>
    </template>
  };

  static embedded = TypographyEmbedded;

  // CS-10787: render the typography settings as a compact bulleted list of
  // non-empty properties, each value wrapped in inline code for clarity.
  static markdown = class Markdown extends Component<typeof TypographyField> {
    get text() {
      let model = this.args.model;
      if (!model) {
        return '';
      }
      let rows: string[] = [];
      let labels: { key: keyof typeof model; label: string }[] = [
        { key: 'fontFamily', label: 'Font family' },
        { key: 'fontSize', label: 'Font size' },
        { key: 'fontWeight', label: 'Font weight' },
        { key: 'lineHeight', label: 'Line height' },
      ];
      for (let { key, label } of labels) {
        let value = model[key] as string | undefined;
        if (!value) continue;
        rows.push(`- ${markdownEscape(label)}: \`${value}\``);
      }
      if (model.sampleText) {
        rows.push(`- Sample text: ${markdownEscape(model.sampleText)}`);
      }
      return rows.join('\n');
    }
    <template>{{this.text}}</template>
  };
}
