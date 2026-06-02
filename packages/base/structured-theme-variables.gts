import {
  CopyButton,
  FieldContainer,
  Swatch,
} from '@cardstack/boxel-ui/components';
import {
  buildCssVariableName,
  dasherize,
  entriesToCssRuleMap,
  markdownEscape,
  sanitizeHtmlSafe,
  type CssVariableEntry,
  type CssRuleMap,
} from '@cardstack/boxel-ui/helpers';

import {
  field,
  contains,
  Component,
  FieldDef,
  getFields,
  type BaseDef,
  type BaseDefComponent,
  type BoxComponent,
} from './card-api';
import ColorField from './color';
import CSSValueField from './css-value';
import enumField from './enum';
import StringField from './string';
import TypographyField from './typography';
import GlimmerComponent from '@glimmer/component';

export interface CssVariableFieldEntry extends CssVariableEntry {
  fieldName: string;
  cssVariableName: string;
  component?: BoxComponent;
}

export type CssVariableField = Record<string, any>;

const COLOR_VALUE_INPUT_HELP =
  'Use CSS color values such as hex (#ff00ff), rgb(...), hsl(...), or okhcl(...).';

export const DEFAULT_THEME_SCALE = '1.333';

const TYPESCALE_OPTIONS = [
  { value: '1.067', label: 'Minor Second (1.067)' },
  { value: '1.125', label: 'Major Second (1.125)' },
  { value: '1.200', label: 'Minor Third (1.200)' },
  { value: '1.250', label: 'Major Third (1.250)' },
  { value: DEFAULT_THEME_SCALE, label: 'Perfect Fourth (1.333)' },
  { value: '1.414', label: 'Augmented Fourth (1.414)' },
  { value: '1.500', label: 'Perfect Fifth (1.500)' },
  { value: '1.618', label: 'Golden Ratio (1.618)' },
];

function describeColor(base: string) {
  return `${base} ${COLOR_VALUE_INPUT_HELP}`;
}

function getFieldGroup(fieldNames: string[], model?: Record<string, any>) {
  return fieldNames?.map((fieldName: string) => ({
    name: dasherize(fieldName).replace('-', ' '),
    value: model?.[fieldName],
  }));
}

export function calculateTypographyVariables(
  fieldDef: BaseDef,
  prefix?: string,
): CssVariableFieldEntry[] | undefined {
  let fields = getFields(fieldDef);
  if (!fields) {
    return;
  }

  let fieldNames = Object.keys(fields);
  if (!fieldNames?.length) {
    return;
  }

  let cssVariableFields: CssVariableFieldEntry[] = [];

  for (let fieldName of fieldNames) {
    let fieldValue = (fieldDef as CssVariableField)?.[fieldName];
    if (!fieldValue?.fieldEntries) {
      continue;
    }

    let entries = fieldValue.fieldEntries as CssVariableEntry[] | undefined;
    if (!entries?.length) {
      continue;
    }

    for (let { name, value } of entries) {
      if (!name || !value) {
        continue;
      }
      if (name === 'sampleText') {
        continue;
      }
      let camelInnerName = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
      let combinedFieldName = `${fieldName}${camelInnerName}`;
      let cssVariableName = buildCssVariableName(combinedFieldName, {
        prefix,
      });

      cssVariableFields.push({
        fieldName: combinedFieldName,
        cssVariableName,
        name: cssVariableName,
        value,
      });
    }
  }

  if (!cssVariableFields.length) {
    return;
  }

  return cssVariableFields;
}

export class ThemeTypographyField extends FieldDef {
  static displayName = 'Theme Typography Variables';

  @field heading = contains(TypographyField, {
    description: 'Primary hero/heading typography settings.',
  });
  @field sectionHeading = contains(TypographyField, {
    description: 'Section heading typography settings.',
  });
  @field subheading = contains(TypographyField, {
    description: 'Subheading or tertiary title typography settings.',
  });
  @field body = contains(TypographyField, {
    description: 'Default body copy typography settings.',
  });
  @field caption = contains(TypographyField, {
    description: 'Caption/annotation and small text typography settings.',
  });
  get cssVariableFields(): CssVariableFieldEntry[] | undefined {
    return calculateTypographyVariables(this, 'theme');
  }

  get cssRuleMap(): CssRuleMap | undefined {
    if (!entriesToCssRuleMap) {
      return;
    }
    return entriesToCssRuleMap(this.cssVariableFields);
  }

  // CS-10787: emit a small header + bulleted entries section for each
  // populated typography slot. Delegates the per-slot rendering to
  // TypographyField.markdown by emitting its text directly.
  static markdown = class Markdown extends Component<
    typeof ThemeTypographyField
  > {
    get text() {
      let model = this.args.model;
      if (!model) {
        return '';
      }
      let entries = model.cssVariableFields ?? [];
      if (!entries.length) {
        return '';
      }
      let rows: string[] = [];
      for (let { name, value } of entries) {
        if (!value) continue;
        rows.push(`- ${markdownEscape(name ?? '')}: \`${value}\``);
      }
      return rows.join('\n');
    }
    <template>{{this.text}}</template>
  };

  static edit = class Edit extends Component<typeof ThemeTypographyField> {
    <template>
      <div class='theme-typography-edit'>

        <section class='theme-typography-edit-section'>
          <h4 class='theme-typography-edit-heading'>Heading</h4>
          <@fields.heading />
        </section>

        <section class='theme-typography-edit-section'>
          <h4 class='theme-typography-edit-heading'>Section Heading</h4>
          <@fields.sectionHeading />
        </section>

        <section class='theme-typography-edit-section'>
          <h4 class='theme-typography-edit-heading'>Subheading</h4>
          <@fields.subheading />
        </section>

        <section class='theme-typography-edit-section'>
          <h4 class='theme-typography-edit-heading'>Body</h4>
          <@fields.body />
        </section>

        <section class='theme-typography-edit-section'>
          <h4 class='theme-typography-edit-heading'>Caption</h4>
          <@fields.caption />
        </section>

      </div>
      <style scoped>
        .theme-typography-edit {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }
        .theme-typography-edit-section {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .theme-typography-edit-heading {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-400));
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding-bottom: var(--boxel-sp-xs);
          border-bottom: 1px solid var(--border, var(--boxel-border-color));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <section class='theme-typography'>
        <h1>
          {{#if @model.heading.sampleText}}
            {{@model.heading.sampleText}}
          {{else}}
            Sample Heading (H1)
          {{/if}}
        </h1>
        <h2>
          {{#if @model.sectionHeading.sampleText}}
            {{@model.sectionHeading.sampleText}}
          {{else}}
            Sample Section Heading (H2)
          {{/if}}
        </h2>
        <h3>
          {{#if @model.subheading.sampleText}}
            {{@model.subheading.sampleText}}
          {{else}}
            Sample Subheading (H3)
          {{/if}}
        </h3>
        <p>
          {{#if @model.body.sampleText}}
            {{@model.body.sampleText}}
          {{else}}
            Sample body text.
          {{/if}}
        </p>
        <small>
          {{#if @model.caption.sampleText}}
            {{@model.caption.sampleText}}
          {{else}}
            Small text
          {{/if}}
        </small>
      </section>
      <style scoped>
        .theme-typography {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          word-break: break-word;
        }
        h1,
        h2,
        h3,
        h4,
        h5,
        h6,
        p {
          margin: 0;
          word-break: break-word;
        }
      </style>
    </template>
  };
}

class Embedded extends Component<typeof ThemeVarField> {
  <template>
    {{#each @model.fieldGroups as |group|}}
      <h4 class='field-group-title'>{{group.title}}</h4>
      <FieldGrid class='field-group-grid' @fields={{group.fields}} />
    {{/each}}
    <style scoped>
      @layer baseComponent {
        .field-group-title {
          margin-block: var(--boxel-sp);
          color: var(--muted-foreground);
          font-weight: 500;
          font-size: var(--boxel-font-size);
        }
        .field-group-grid {
          margin-bottom: var(--boxel-sp-2xl);
        }
      }
    </style>
  </template>
}

class ThemeSwatch extends GlimmerComponent<{
  Args: {
    value: string;
    label?: string;
  };
  Element: HTMLElement;
}> {
  <template>
    {{#if @value.length}}
      <div
        class='theme-swatch-display'
        data-test-var-value={{@label}}
        ...attributes
      >
        <Swatch class='theme-swatch' @color={{@value}} @label={{@label}} />
        <CopyButton
          @width='16px'
          @height='16px'
          @ariaLabel='Copy {{@value}}'
          @tooltipText='Copy {{@value}}'
          @textToCopy={{@value}}
        />
      </div>
    {{else if @label.length}}
      <div data-test-var-value={{@label}}>
        <div class='empty-field-name'>{{@label}}</div>
        <code class='empty-value'>/* not set */</code>
      </div>
    {{/if}}
    <style scoped>
      @layer {
        .theme-swatch-display {
          display: inline-grid;
          grid-template-columns: minmax(50%, 1fr) 1.875rem;
          align-items: end;
          width: 20rem;
          max-width: 100%;
        }
        .theme-swatch {
          --swatch-width: 3.375rem;
          display: flex;
          flex-direction: row-reverse;
          justify-content: flex-end;
          align-items: center;
        }
        :deep(.boxel-swatch-preview) {
          box-shadow: var(--swatch-background);
        }
        :deep(.boxel-swatch-label) {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .empty-field-name,
        :deep(.boxel-swatch-name) {
          font-weight: 600;
          text-wrap: wrap;
          text-transform: capitalize;
        }
        :deep(.boxel-swatch-value) {
          font-size: var(--boxel-font-size-xs);
          text-transform: lowercase;
        }
        .empty-value {
          padding: var(--boxel-sp-4xs);
          font-style: italic;
          font-size: var(--boxel-font-size-xs);
        }
      }
    </style>
  </template>
}

class FieldGrid extends GlimmerComponent<{
  Args: {
    fields: { name: string; value: string }[];
  };
  Element: HTMLElement;
}> {
  <template>
    <div class='field-grid' ...attributes>
      {{#each @fields as |field|}}
        <ThemeSwatch @value={{field.value}} @label={{field.name}} />
      {{/each}}
    </div>
    <style scoped>
      .field-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(12.5rem, 1fr));
        gap: var(--boxel-sp-xs) var(--boxel-sp-2xs);
      }
    </style>
  </template>
}

export default class ThemeVarField extends FieldDef {
  static displayName = 'Structured Theme Variables';

  // color variables
  @field background = contains(ColorField, {
    description: describeColor('Base page background color.'),
  });
  @field foreground = contains(ColorField, {
    description: describeColor('The main foreground/text color.'),
  });
  @field card = contains(ColorField, {
    description: describeColor(
      'Nested card or box background-color. Do not use as foreground color.',
    ),
  });
  @field cardForeground = contains(ColorField, {
    description: describeColor('Foreground text color used on card surfaces.'),
  });
  @field popover = contains(ColorField, {
    description: describeColor('Background color for popovers/overlays.'),
  });
  @field popoverForeground = contains(ColorField, {
    description: describeColor('Text color for popover content.'),
  });
  @field primary = contains(ColorField, {
    description: describeColor(
      'Primary brand/action cta background-color. Do not use as foreground color.',
    ),
  });
  @field primaryForeground = contains(ColorField, {
    description: describeColor(
      'Text/icon foreground color on primary surfaces.',
    ),
  });
  @field secondary = contains(ColorField, {
    description: describeColor(
      'Secondary brand/action cta background-color. Do not use as foreground color.',
    ),
  });
  @field secondaryForeground = contains(ColorField, {
    description: describeColor(
      'Text/icon foreground color on secondary surfaces.',
    ),
  });
  @field muted = contains(ColorField, {
    description: describeColor('Muted background color for subtle UI.'),
  });
  @field mutedForeground = contains(ColorField, {
    description: describeColor('Muted foreground color.'),
  });
  @field accent = contains(ColorField, {
    description: describeColor('Accent background-color.'),
  });
  @field accentForeground = contains(ColorField, {
    description: describeColor(
      'Text/icon foreground color on accent surfaces.',
    ),
  });
  @field destructive = contains(ColorField, {
    description: describeColor('Destructive/error action color.'),
  });
  @field destructiveForeground = contains(ColorField, {
    description: describeColor('Text/icon color on destructive actions.'),
  });
  @field border = contains(ColorField, {
    description: describeColor('Specifies border-color.'),
  });
  @field input = contains(ColorField, {
    description: describeColor('Background/border color for inputs.'),
  });
  @field ring = contains(ColorField, {
    description: describeColor('Focus ring color.'),
  });

  // chart color variables
  @field chart1 = contains(ColorField, {
    description: describeColor('Primary chart/graph color.'),
  });
  @field chart2 = contains(ColorField, {
    description: describeColor('Secondary chart/graph color.'),
  });
  @field chart3 = contains(ColorField, {
    description: describeColor('Tertiary chart/graph color.'),
  });
  @field chart4 = contains(ColorField, {
    description: describeColor('Quaternary chart/graph color.'),
  });
  @field chart5 = contains(ColorField, {
    description: describeColor('Quinary chart/graph color.'),
  });

  // sidebar color variables
  @field sidebar = contains(ColorField, {
    description: describeColor('Sidebar background-color.'),
  });
  @field sidebarForeground = contains(ColorField, {
    description: describeColor('Sidebar text/icon foreground color.'),
  });
  @field sidebarPrimary = contains(ColorField, {
    description: describeColor(
      'Primary action background-color within sidebar. Do not use as foreground color.',
    ),
  });
  @field sidebarPrimaryForeground = contains(ColorField, {
    description: describeColor('Text/icon color on sidebar primary surface.'),
  });
  @field sidebarAccent = contains(ColorField, {
    description: describeColor(
      'Accent background-color within sidebar. Do not use as foreground color.',
    ),
  });
  @field sidebarAccentForeground = contains(ColorField, {
    description: describeColor('Text/icon color for sidebar accent surfaces.'),
  });
  @field sidebarBorder = contains(ColorField, {
    description: describeColor('Border color used in sidebar.'),
  });
  @field sidebarRing = contains(ColorField, {
    description: describeColor('Focus ring color in sidebar.'),
  });

  // font variables
  @field fontSans = contains(CSSValueField, {
    description: 'Font stack for sans-serif text.',
  });
  @field fontSerif = contains(CSSValueField, {
    description: 'Font stack for serif text.',
  });
  @field fontMono = contains(CSSValueField, {
    description: 'Font stack for monospaced text.',
  });

  // geometry variables
  @field radius = contains(CSSValueField, {
    description: 'Specifies border-radius base value.',
  });
  @field spacing = contains(CSSValueField, {
    description:
      'Specifies a quarter of the base value for spacing properties such as padding, margin, gap. For example, if a gap of 1rem is desired, enter 0.25rem.',
  });
  @field themeFontSize = contains(CSSValueField, {
    description:
      'Base font size used to derive all --boxel-font-size-* and --boxel-fs-* steps. Defaults to 1rem (16px).',
  });
  @field themeScale = contains(
    enumField(StringField, { options: TYPESCALE_OPTIONS }),
    {
      description: `Typescale ratio used to derive --boxel-fs-* (font-size) steps and --boxel-sp-* (spacing) steps from the base --boxel-font-size and --boxel-sp values, respectively (both default to 1rem - 16px). Scale defaults to Perfect Fourth (${DEFAULT_THEME_SCALE}).`,
    },
  );
  @field trackingNormal = contains(CSSValueField, {
    description: 'Specifies letter-spacing base value.',
  });
  // box-shadow variables
  @field shadow2xs = contains(CSSValueField, {
    description: 'Smallest shadow depth.',
  });
  @field shadowXs = contains(CSSValueField, {
    description: 'Extra-small shadow depth.',
  });
  @field shadowSm = contains(CSSValueField, {
    description: 'Small shadow depth.',
  });
  @field shadow = contains(CSSValueField, {
    description: 'Specifies box-shadow base value.',
  });
  @field shadowMd = contains(CSSValueField, {
    description: 'Medium shadow depth.',
  });
  @field shadowLg = contains(CSSValueField, {
    description: 'Large shadow depth.',
  });
  @field shadowXl = contains(CSSValueField, {
    description: 'Extra-large shadow depth.',
  });
  @field shadow2xl = contains(CSSValueField, {
    description: 'Largest shadow depth.',
  });

  get cssVariableFields(): CssVariableFieldEntry[] | undefined {
    let fields = getFields(this);
    if (!fields) {
      return;
    }

    let fieldNames = Object.keys(fields)?.sort();
    if (!fieldNames?.length) {
      return;
    }
    let cssVariableFields: CssVariableFieldEntry[] = [];
    for (let fieldName of fieldNames) {
      let cssVariableName = buildCssVariableName(fieldName);
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

  private primaryColors = [
    'background',
    'foreground',
    'primary',
    'primaryForeground',
  ];
  private secondaryColors = [
    'secondary',
    'secondaryForeground',
    'accent',
    'accentForeground',
  ];
  private uiComponentColors = [
    'card',
    'cardForeground',
    'popover',
    'popoverForeground',
    'muted',
    'mutedForeground',
  ];
  private formColors = [
    'border',
    'input',
    'ring',
    'destructive',
    'destructiveForeground',
  ];
  private chartColors = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'];
  private sidebarColors = [
    'sidebar',
    'sidebarForeground',
    'sidebarPrimary',
    'sidebarPrimaryForeground',
    'sidebarAccent',
    'sidebarAccentForeground',
    'sidebarBorder',
    'sidebarRing',
  ];
  private boxShadows = ['shadowSm', 'shadowMd', 'shadowLg', 'shadowXl'];
  get fieldGroups() {
    return [
      {
        title: 'Primary Colors',
        fields: getFieldGroup(this.primaryColors, this),
      },
      {
        title: 'Secondary & Accent Colors',
        fields: getFieldGroup(this.secondaryColors, this),
      },
      {
        title: 'UI Component Colors',
        fields: getFieldGroup(this.uiComponentColors, this),
      },
      {
        title: 'Form & Feedback Colors',
        fields: getFieldGroup(this.formColors, this),
      },
      {
        title: 'Chart Colors',
        fields: getFieldGroup(this.chartColors, this),
      },
      {
        title: 'Sidebar Colors',
        fields: getFieldGroup(this.sidebarColors, this),
      },
      {
        title: 'Box Shadow',
        fields: getFieldGroup(this.boxShadows, this),
      },
    ];
  }

  get cssRuleMap(): CssRuleMap | undefined {
    if (!entriesToCssRuleMap) {
      return;
    }
    return entriesToCssRuleMap(this.cssVariableFields);
  }

  static edit = class Edit extends Component<typeof ThemeVarField> {
    private get fontSansStyle() {
      let v = this.args.model.fontSans;
      return v ? sanitizeHtmlSafe(`font-family: ${v}`) : undefined;
    }
    private get fontSerifStyle() {
      let v = this.args.model.fontSerif;
      return v ? sanitizeHtmlSafe(`font-family: ${v}`) : undefined;
    }
    private get fontMonoStyle() {
      let v = this.args.model.fontMono;
      return v ? sanitizeHtmlSafe(`font-family: ${v}`) : undefined;
    }

    private get typescaleSteps() {
      let baseStr = this.args.model.themeFontSize;
      let scaleStr = this.args.model.themeScale;
      if (!baseStr && !scaleStr) return [];
      let base = 1;
      if (baseStr) {
        let remMatch = baseStr.match(/^([\d.]+)rem$/);
        let pxMatch = baseStr.match(/^([\d.]+)px$/);
        if (remMatch) base = parseFloat(remMatch[1]);
        else if (pxMatch) base = parseFloat(pxMatch[1]) / 16;
      }
      let scale = parseFloat(scaleStr ?? DEFAULT_THEME_SCALE);
      return [
        { label: '2xs', exp: -3 },
        { label: 'xs', exp: -2 },
        { label: 'sm', exp: -1 },
        { label: 'base', exp: 0 },
        { label: 'md', exp: 1 },
        { label: 'lg', exp: 2 },
        { label: 'xl', exp: 3 },
        { label: '2xl', exp: 4 },
      ].map(({ label, exp }) => {
        let size = base * Math.pow(scale, exp);
        return {
          label,
          remLabel: `${parseFloat(size.toFixed(2))}rem`,
          pxLabel: `${parseFloat((size * 16).toFixed(2))}px`,
          style: sanitizeHtmlSafe(`font-size: ${size.toFixed(3)}rem`),
        };
      });
    }

    private shadowStyle(value: string | undefined) {
      return value ? sanitizeHtmlSafe(`box-shadow: ${value}`) : undefined;
    }
    private get shadows() {
      let m = this.args.model;
      return [
        { label: '2xs', value: m.shadow2xs },
        { label: 'xs', value: m.shadowXs },
        { label: 'sm', value: m.shadowSm },
        { label: 'Base', value: m.shadow },
        { label: 'md', value: m.shadowMd },
        { label: 'lg', value: m.shadowLg },
        { label: 'xl', value: m.shadowXl },
        { label: '2xl', value: m.shadow2xl },
      ].filter((s) => s.value);
    }

    <template>
      <div class='theme-var-edit'>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Main</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Background' @vertical={{true}}>
              <@fields.background />
            </FieldContainer>
            <FieldContainer @label='Foreground' @vertical={{true}}>
              <@fields.foreground />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Primary</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Primary' @vertical={{true}}>
              <@fields.primary />
            </FieldContainer>
            <FieldContainer @label='Primary Foreground' @vertical={{true}}>
              <@fields.primaryForeground />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Secondary & Accent</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Secondary' @vertical={{true}}>
              <@fields.secondary />
            </FieldContainer>
            <FieldContainer @label='Secondary Foreground' @vertical={{true}}>
              <@fields.secondaryForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Accent' @vertical={{true}}>
              <@fields.accent />
            </FieldContainer>
            <FieldContainer @label='Accent Foreground' @vertical={{true}}>
              <@fields.accentForeground />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>UI Components</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Card' @vertical={{true}}>
              <@fields.card />
            </FieldContainer>
            <FieldContainer @label='Card Foreground' @vertical={{true}}>
              <@fields.cardForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Popover' @vertical={{true}}>
              <@fields.popover />
            </FieldContainer>
            <FieldContainer @label='Popover Foreground' @vertical={{true}}>
              <@fields.popoverForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Muted' @vertical={{true}}>
              <@fields.muted />
            </FieldContainer>
            <FieldContainer @label='Muted Foreground' @vertical={{true}}>
              <@fields.mutedForeground />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Form & Feedback</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Border' @vertical={{true}}>
              <@fields.border />
            </FieldContainer>
            <FieldContainer @label='Input' @vertical={{true}}>
              <@fields.input />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Ring' @vertical={{true}}>
              <@fields.ring />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Destructive' @vertical={{true}}>
              <@fields.destructive />
            </FieldContainer>
            <FieldContainer @label='Destructive Foreground' @vertical={{true}}>
              <@fields.destructiveForeground />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Chart Colors</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Chart 1' @vertical={{true}}>
              <@fields.chart1 />
            </FieldContainer>
            <FieldContainer @label='Chart 2' @vertical={{true}}>
              <@fields.chart2 />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Chart 3' @vertical={{true}}>
              <@fields.chart3 />
            </FieldContainer>
            <FieldContainer @label='Chart 4' @vertical={{true}}>
              <@fields.chart4 />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Chart 5' @vertical={{true}}>
              <@fields.chart5 />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Sidebar</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Sidebar' @vertical={{true}}>
              <@fields.sidebar />
            </FieldContainer>
            <FieldContainer @label='Sidebar Foreground' @vertical={{true}}>
              <@fields.sidebarForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Sidebar Primary' @vertical={{true}}>
              <@fields.sidebarPrimary />
            </FieldContainer>
            <FieldContainer
              @label='Sidebar Primary Foreground'
              @vertical={{true}}
            >
              <@fields.sidebarPrimaryForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Sidebar Accent' @vertical={{true}}>
              <@fields.sidebarAccent />
            </FieldContainer>
            <FieldContainer
              @label='Sidebar Accent Foreground'
              @vertical={{true}}
            >
              <@fields.sidebarAccentForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Sidebar Border' @vertical={{true}}>
              <@fields.sidebarBorder />
            </FieldContainer>
            <FieldContainer @label='Sidebar Ring' @vertical={{true}}>
              <@fields.sidebarRing />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Fonts</h4>
          <p class='theme-var-edit-hint'>
            Custom font family links must be added to the
            <strong>CSS Imports</strong>
            section (e.g. a Google Fonts url) before they will render correctly.
          </p>
          <div class='theme-var-font-previews'>
            {{#if @model.fontSans}}
              <div class='theme-var-font-preview' style={{this.fontSansStyle}}>
                <span class='theme-var-font-label'>Sans-serif</span>
                The quick brown fox
              </div>
            {{/if}}
            {{#if @model.fontSerif}}
              <div class='theme-var-font-preview' style={{this.fontSerifStyle}}>
                <span class='theme-var-font-label'>Serif</span>
                The quick brown fox
              </div>
            {{/if}}
            {{#if @model.fontMono}}
              <div
                class='theme-var-font-preview theme-var-font-preview--mono'
                style={{this.fontMonoStyle}}
              >
                <span class='theme-var-font-label'>Monospace</span>
                const hello = "world"
              </div>
            {{/if}}
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Sans-serif' @vertical={{true}}>
              <@fields.fontSans />
            </FieldContainer>
            <FieldContainer @label='Serif' @vertical={{true}}>
              <@fields.fontSerif />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Monospace' @vertical={{true}}>
              <@fields.fontMono />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Geometry</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Border Radius' @vertical={{true}}>
              <@fields.radius />
            </FieldContainer>
            <FieldContainer @label='Spacing' @vertical={{true}}>
              <@fields.spacing />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Base Font Size' @vertical={{true}}>
              <@fields.themeFontSize />
            </FieldContainer>
            <FieldContainer @label='Typescale' @vertical={{true}}>
              <@fields.themeScale />
            </FieldContainer>
          </div>
          {{#if this.typescaleSteps.length}}
            <div class='theme-var-typescale-preview'>
              {{#each this.typescaleSteps as |step|}}
                <div class='theme-var-typescale-step'>
                  <span
                    class='theme-var-typescale-sample'
                    style={{step.style}}
                  >Aa</span>
                  <span class='theme-var-typescale-label'>{{step.label}}</span>
                  <span
                    class='theme-var-typescale-size'
                  >{{step.remLabel}}</span>
                  <span class='theme-var-typescale-size'>{{step.pxLabel}}</span>
                </div>
              {{/each}}
            </div>
          {{/if}}
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='Letter Spacing' @vertical={{true}}>
              <@fields.trackingNormal />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Box Shadows</h4>
          {{#if this.shadows.length}}
            <div class='theme-var-shadow-previews'>
              {{#each this.shadows as |s|}}
                <div class='theme-var-shadow-preview'>
                  <div
                    class='theme-var-shadow-swatch'
                    style={{this.shadowStyle s.value}}
                  ></div>
                  <span class='theme-var-shadow-label'>{{s.label}}</span>
                </div>
              {{/each}}
            </div>
          {{/if}}
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='2xs' @vertical={{true}}>
              <@fields.shadow2xs />
            </FieldContainer>
            <FieldContainer @label='xs' @vertical={{true}}>
              <@fields.shadowXs />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='sm' @vertical={{true}}>
              <@fields.shadowSm />
            </FieldContainer>
            <FieldContainer @label='Base' @vertical={{true}}>
              <@fields.shadow />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='md' @vertical={{true}}>
              <@fields.shadowMd />
            </FieldContainer>
            <FieldContainer @label='lg' @vertical={{true}}>
              <@fields.shadowLg />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer @label='xl' @vertical={{true}}>
              <@fields.shadowXl />
            </FieldContainer>
            <FieldContainer @label='2xl' @vertical={{true}}>
              <@fields.shadow2xl />
            </FieldContainer>
          </div>
        </section>

      </div>
      <style scoped>
        .theme-var-edit {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }
        .theme-var-edit-section {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .theme-var-edit-heading {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-400));
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding-bottom: var(--boxel-sp-xs);
          border-bottom: 1px solid var(--border, var(--boxel-border-color));
        }
        .theme-var-edit-row {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .theme-var-edit-row--2col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp-sm);
        }
        .theme-var-edit-hint {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-400));
        }
        .theme-var-typescale-preview {
          display: flex;
          align-items: flex-end;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-sm) var(--boxel-sp);
          background: var(--muted, var(--boxel-100));
          border-radius: var(--boxel-border-radius-sm);
          overflow-x: auto;
        }
        .theme-var-typescale-step {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          flex-shrink: 0;
        }
        .theme-var-typescale-sample {
          color: var(--foreground, var(--boxel-dark));
          line-height: 1;
        }
        .theme-var-typescale-label {
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-400));
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .theme-var-typescale-size {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-400));
          font-variant-numeric: tabular-nums;
        }
        .theme-var-shadow-previews {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-lg) var(--boxel-sp);
          padding: var(--boxel-sp) var(--boxel-sp-sm);
          background: var(--muted, var(--boxel-100));
          border-radius: var(--boxel-border-radius-sm);
        }
        .theme-var-shadow-preview {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .theme-var-shadow-swatch {
          width: 2.5rem;
          height: 2.5rem;
          background: var(--card, var(--boxel-light));
          border-radius: var(--boxel-border-radius-sm);
        }
        .theme-var-shadow-label {
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-400));
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .theme-var-font-previews {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-2xs);
        }
        .theme-var-font-preview {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xs) var(--boxel-sp);
          background: var(--muted, var(--boxel-100));
          border-radius: var(--boxel-border-radius-sm);
          color: var(--foreground, var(--boxel-dark));
          font-size: 1rem;
          word-break: break-word;
        }
        .theme-var-font-preview--mono {
          font-size: 0.875rem;
        }
        .theme-var-font-label {
          flex-shrink: 0;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-400));
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-family: var(--boxel-font);
        }
      </style>
    </template>
  };

  static embedded: BaseDefComponent = Embedded;

  // CS-10787: emit a bulleted list of populated CSS variables — each entry
  // is the CSS variable name paired with its value in inline code. Empty
  // slots are skipped.
  static markdown = class Markdown extends Component<typeof ThemeVarField> {
    get text() {
      let model = this.args.model;
      if (!model) {
        return '';
      }
      let entries = model.cssVariableFields ?? [];
      if (!entries.length) {
        return '';
      }
      let rows: string[] = [];
      for (let { name, value } of entries) {
        if (!value) continue;
        rows.push(`- ${markdownEscape(name ?? '')}: \`${value}\``);
      }
      return rows.join('\n');
    }
    <template>{{this.text}}</template>
  };
}
