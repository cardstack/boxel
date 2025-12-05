import { CopyButton } from '@cardstack/boxel-ui/components';
import {
  buildCssVariableName,
  dasherize,
  entriesToCssRuleMap,
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
import TypographyField from './typography';

export interface CssVariableFieldEntry extends CssVariableEntry {
  fieldName: string;
  cssVariableName: string;
  component?: BoxComponent;
}

export type CssVariableField = Record<string, any>;

const COLOR_VALUE_INPUT_HELP =
  'Use CSS color values such as hex (#ff00ff), rgb(...), hsl(...), or okhcl(...).';

function describeColor(base: string) {
  return `${base} ${COLOR_VALUE_INPUT_HELP}`;
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
      console.log(
        cssVariableName,
        `--${prefix}-${dasherize(`${fieldName}-${name}`)}`,
      );

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
    let cssVariableFields = calculateTypographyVariables(this, 'theme');
    return cssVariableFields;
  }

  get cssRuleMap(): CssRuleMap | undefined {
    if (!entriesToCssRuleMap) {
      return;
    }
    return entriesToCssRuleMap(this.cssVariableFields);
  }

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
        }
        h1,
        h2,
        h3,
        h4,
        h5,
        h6,
        p {
          margin: 0;
        }
      </style>
    </template>
  };
}

class Embedded extends Component<typeof ThemeVarField> {
  private get cssFields(): CssVariableFieldEntry[] | undefined {
    let fields: CssVariableField = this.args.fields;
    let cssFields = this.args.model?.cssVariableFields;
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
          row-gap: var(--boxel-sp-6xs);
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
          font-weight: 500;
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

export default class ThemeVarField extends FieldDef {
  static displayName = 'Structured Theme Variables';

  // color variables
  @field background = contains(ColorField, {
    description: describeColor('Base page background color.'),
  });
  @field foreground = contains(ColorField, {
    description: describeColor('Primary foreground/text color.'),
  });
  @field card = contains(ColorField, {
    description: describeColor('Default card surface color.'),
  });
  @field cardForeground = contains(ColorField, {
    description: describeColor('Text color used on card surfaces.'),
  });
  @field popover = contains(ColorField, {
    description: describeColor('Background color for popovers/overlays.'),
  });
  @field popoverForeground = contains(ColorField, {
    description: describeColor('Text color for popover content.'),
  });
  @field primary = contains(ColorField, {
    description: describeColor('Primary brand/action color.'),
  });
  @field primaryForeground = contains(ColorField, {
    description: describeColor('Text/icon color on primary surfaces.'),
  });
  @field secondary = contains(ColorField, {
    description: describeColor('Secondary emphasis color.'),
  });
  @field secondaryForeground = contains(ColorField, {
    description: describeColor('Text/icon color on secondary surfaces.'),
  });
  @field muted = contains(ColorField, {
    description: describeColor('Muted background color for subtle UI.'),
  });
  @field mutedForeground = contains(ColorField, {
    description: describeColor('Foreground color on muted surfaces.'),
  });
  @field accent = contains(ColorField, {
    description: describeColor('Accent/highlight color.'),
  });
  @field accentForeground = contains(ColorField, {
    description: describeColor('Text/icon color on accent surfaces.'),
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
    description: describeColor('Sidebar background color.'),
  });
  @field sidebarForeground = contains(ColorField, {
    description: describeColor('Sidebar text/icon color.'),
  });
  @field sidebarPrimary = contains(ColorField, {
    description: describeColor('Primary action color within sidebar.'),
  });
  @field sidebarPrimaryForeground = contains(ColorField, {
    description: describeColor('Text/icon color for sidebar primary actions.'),
  });
  @field sidebarAccent = contains(ColorField, {
    description: describeColor('Accent color within sidebar.'),
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

  get cssRuleMap(): CssRuleMap | undefined {
    if (!entriesToCssRuleMap) {
      return;
    }
    return entriesToCssRuleMap(this.cssVariableFields);
  }

  static embedded: BaseDefComponent = Embedded;
}
