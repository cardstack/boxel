import { CopyButton, Swatch } from '@cardstack/boxel-ui/components';
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
import GlimmerComponent from '@glimmer/component';

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
        grid-template-columns: repeat(auto-fit, minmax(12.5rem, 1fr));
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

  static embedded: BaseDefComponent = Embedded;
}
