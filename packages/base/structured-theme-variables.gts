import { schedule } from '@ember/runloop';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import {
  CopyButton,
  FieldContainer,
  Swatch,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import {
  buildCssVariableName,
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

// `property` is what an unset variable is probed through to resolve its
// inherited default (see resolveThemeVariable)
function getFieldGroup(
  fieldNames: string[],
  model?: Record<string, any>,
  property = 'background-color',
) {
  return fieldNames?.map((fieldName: string) => ({
    name: buildCssVariableName(fieldName),
    value: model?.[fieldName],
    property,
  }));
}

// what a probe computes to when the variable is undeclared or not valid for
// the probed property
const UNRESOLVED_PROBE_VALUES = new Set([
  '',
  'none',
  'auto',
  'rgba(0, 0, 0, 0)',
]);

// Resolves a contract token the theme leaves unset. The swatch grid renders
// inside the dashboard's theme scope, where theme.css declares every token, so
// reading it there yields the default the card actually renders with, in the
// color mode the preview is showing. `expression` is the declared value with
// var() substituted (a color-mix formula stays a formula); `resolved` applies
// it to `property` on a probe so formulas collapse to a literal.
function resolveThemeVariable(el: HTMLElement, name: string, property: string) {
  let expression = getComputedStyle(el).getPropertyValue(name).trim();
  let probe = document.createElement('span');
  probe.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none';
  probe.style.setProperty(property, `var(${name})`);
  el.appendChild(probe);
  let resolved = getComputedStyle(probe).getPropertyValue(property).trim();
  probe.remove();
  if (UNRESOLVED_PROBE_VALUES.has(resolved)) {
    resolved = expression;
  }
  return { expression, resolved };
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
  @field label = contains(TypographyField, {
    description:
      'UI label typography: control text, table headers, badges, and other chrome.',
  });
  @field eyebrow = contains(TypographyField, {
    description:
      'Eyebrow typography: the small, tracked-out kicker above a title.',
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

        <section class='theme-typography-edit-section'>
          <h4 class='theme-typography-edit-heading'>Label</h4>
          <@fields.label />
        </section>

        <section class='theme-typography-edit-section'>
          <h4 class='theme-typography-edit-heading'>Eyebrow</h4>
          <@fields.eyebrow />
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
        <span class='theme-typography-eyebrow'>
          {{#if @model.eyebrow.sampleText}}
            {{@model.eyebrow.sampleText}}
          {{else}}
            Eyebrow
          {{/if}}
        </span>
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
        <span class='theme-typography-label'>
          {{#if @model.label.sampleText}}
            {{@model.label.sampleText}}
          {{else}}
            UI label
          {{/if}}
        </span>
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
        .theme-typography-label {
          font-family: var(--boxel-ui-label-font-family);
          font-size: var(--boxel-ui-label-font-size);
          font-weight: var(--boxel-ui-label-font-weight);
          line-height: var(--boxel-ui-label-line-height);
          letter-spacing: var(--boxel-ui-label-letter-spacing);
        }
        .theme-typography-eyebrow {
          font-family: var(--boxel-eyebrow-font-family);
          font-size: var(--boxel-eyebrow-font-size);
          font-weight: var(--boxel-eyebrow-font-weight);
          line-height: var(--boxel-eyebrow-line-height);
          letter-spacing: var(--boxel-eyebrow-letter-spacing);
          text-transform: uppercase;
        }
      </style>
    </template>
  };
}

export class FontPreviews extends GlimmerComponent<{
  Args: {
    fontStack?: { label: string; stack?: string }[];
  };
  Element: HTMLElement;
}> {
  private fontStyle(stack: string | null | undefined) {
    return stack ? sanitizeHtmlSafe(`font-family: ${stack}`) : undefined;
  }

  <template>
    <div class='theme-var-font-previews' ...attributes>
      {{#each @fontStack as |font|}}
        {{#if font.stack}}
          <div
            class='theme-var-font-preview'
            style={{this.fontStyle font.stack}}
          >
            <div class='theme-var-font-preview-line'>
              <span class='theme-var-font-label'>{{font.label}}</span>
              The quick brown fox
            </div>
          </div>
        {{/if}}
      {{/each}}
    </div>
    <style scoped>
      .theme-var-font-previews {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-2xs);
      }
      .theme-var-font-preview {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        background: var(--muted, var(--boxel-100));
        border-radius: var(--boxel-border-radius-sm);
        color: var(--foreground, var(--boxel-dark));
        font-size: 1rem;
        word-break: break-word;
      }
      .theme-var-font-preview-line {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--boxel-sp-sm);
      }
      .theme-var-font-label {
        flex-shrink: 0;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-400));
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
    </style>
  </template>
}

class Embedded extends Component<typeof ThemeVarField> {
  <template>
    {{#each @model.fieldGroups as |group|}}
      <h4 class='field-group-title'>{{group.title}}</h4>
      {{#if group.description}}
        <p class='field-group-description'>{{group.description}}</p>
      {{/if}}
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
        .field-group-description {
          margin: calc(-1 * var(--boxel-sp-xs)) 0 var(--boxel-sp);
          color: var(--muted-foreground);
          font-size: var(--boxel-font-size-sm);
        }
        .field-group-grid {
          margin-bottom: var(--boxel-sp-2xl);
        }
      }
    </style>
  </template>
}

// A field the theme leaves blank, shown with the value it inherits from the
// Boxel defaults so the preview reads as the card will render
class InheritedSwatch extends GlimmerComponent<{
  Args: {
    name: string;
    property: string;
  };
  Element: HTMLElement;
}> {
  @tracked private resolved?: string;
  @tracked private expression?: string;

  // Tracked state is written after render: the values are consumed by this
  // template before the modifier installs. The preview's light/dark toggle
  // flips `data-theme` on an ancestor without necessarily tearing this tree
  // down (Style Reference renders the palette unconditionally), so watch that
  // attribute and re-resolve rather than relying on a re-render.
  private resolve = modifier(
    (el: HTMLElement, [name, property]: [string, string]) => {
      let read = () =>
        schedule('afterRender', () => {
          if (!el.isConnected) {
            return;
          }
          let { expression, resolved } = resolveThemeVariable(
            el,
            name,
            property,
          );
          this.expression = expression;
          this.resolved = resolved;
        });
      read();
      let scheme = el.closest('[data-theme]');
      let observer: MutationObserver | undefined;
      if (scheme) {
        observer = new MutationObserver(read);
        observer.observe(scheme, { attributeFilter: ['data-theme'] });
      }
      return () => observer?.disconnect();
    },
  );

  <template>
    {{! class names here must not repeat ThemeSwatch's: its scoped rules reach
        this element through ...attributes }}
    <div
      class='inherited-swatch'
      {{this.resolve @name @property}}
      data-test-var-value={{@name}}
      data-test-var-inherited={{this.resolved}}
      ...attributes
    >
      <Tooltip class='inherited-swatch-tag' @placement='top'>
        <:trigger>
          <span class='inherited-tag'>inherited</span>
        </:trigger>
        <:content>
          Not set on this theme. Resolves from the Boxel defaults as
          <code>{{this.expression}}</code>
        </:content>
      </Tooltip>
      <Swatch
        class='inherited-swatch-preview'
        @color={{this.resolved}}
        @label={{@name}}
      />
    </div>
    <style scoped>
      @layer {
        /* tag at the top of the cell and swatch at the bottom, so across a row
           the tags line up with each other and the swatches with the set
           swatches in neighbouring cells, which also bottom-align */
        .inherited-swatch {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--boxel-sp-4xs);
          width: 100%;
          min-width: 0;
        }
        /* same swatch layout as ThemeSwatch */
        .inherited-swatch-preview {
          --swatch-width: 2.75rem;
          --swatch-height: 2.75rem;
          display: flex;
          flex-direction: row-reverse;
          justify-content: flex-end;
          align-items: center;
          align-self: stretch;
          min-width: 0;
        }
        :deep(.boxel-swatch-preview) {
          box-shadow: var(--swatch-background);
          flex-shrink: 0;
          aspect-ratio: 1;
          border-style: dashed;
        }
        :deep(.boxel-swatch-label) {
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        :deep(.boxel-swatch-name) {
          font-weight: 600;
          font-size: var(--boxel-font-size-xs);
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          text-wrap: wrap;
          overflow-wrap: anywhere;
        }
        :deep(.boxel-swatch-value) {
          font-size: var(--boxel-font-size-xs);
          text-transform: lowercase;
        }
        .inherited-tag {
          padding: var(--boxel-sp-5xs) var(--boxel-sp-3xs);
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius-xs);
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-2xs);
          font-weight: 600;
          letter-spacing: var(--boxel-lsp-xs);
          text-transform: uppercase;
          white-space: nowrap;
        }
      }
    </style>
  </template>
}

class ThemeSwatch extends GlimmerComponent<{
  Args: {
    value: string;
    label: string;
    property?: string;
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
      <InheritedSwatch
        @name={{@label}}
        @property={{if @property @property 'background-color'}}
        ...attributes
      />
    {{/if}}
    <style scoped>
      @layer {
        .theme-swatch-display {
          display: inline-grid;
          grid-template-columns: minmax(50%, 1fr) 1.875rem;
          align-items: end;
          width: 100%;
        }
        .theme-swatch {
          --swatch-width: 2.75rem;
          --swatch-height: 2.75rem;
          display: flex;
          flex-direction: row-reverse;
          justify-content: flex-end;
          align-items: center;
        }
        :deep(.boxel-swatch-preview) {
          box-shadow: var(--swatch-background);
          flex-shrink: 0;
          aspect-ratio: 1;
        }
        :deep(.boxel-swatch-label) {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        :deep(.boxel-swatch-name) {
          font-weight: 600;
          font-size: var(--boxel-font-size-xs);
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          text-wrap: wrap;
          overflow-wrap: anywhere;
        }
        :deep(.boxel-swatch-value) {
          font-size: var(--boxel-font-size-xs);
          text-transform: lowercase;
        }
      }
    </style>
  </template>
}

class FieldGrid extends GlimmerComponent<{
  Args: {
    fields: { name: string; value: string; property?: string }[];
  };
  Element: HTMLElement;
}> {
  <template>
    <div class='field-grid' ...attributes>
      {{#each @fields as |field|}}
        <ThemeSwatch
          @value={{field.value}}
          @label={{field.name}}
          @property={{field.property}}
        />
      {{/each}}
    </div>
    <style scoped>
      .field-grid {
        display: grid;
        /* min() lets the column shrink instead of overflowing a narrow card */
        grid-template-columns: repeat(auto-fill, minmax(min(11rem, 100%), 1fr));
        gap: var(--boxel-sp-sm) var(--boxel-sp-2xs);
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
  // neutral surfaces beyond shadcn's; --foreground must read on all of them
  @field canvas = contains(ColorField, {
    description: describeColor(
      'Workspace ground behind the page background. Do not use as foreground color.',
    ),
  });
  @field inset = contains(ColorField, {
    description: describeColor(
      'Background of a well sunk into a card. Do not use as foreground color.',
    ),
  });
  @field field = contains(ColorField, {
    description: describeColor(
      'Background of an editable input at rest; its border is --input. Do not use as foreground color.',
    ),
  });
  @field hover = contains(ColorField, {
    description: describeColor(
      'Pointer-hover surface, usually translucent so it composes over any background.',
    ),
  });
  @field stripe = contains(ColorField, {
    description: describeColor(
      'Alternate (zebra) row background. Sits between --card and --hover.',
    ),
  });
  @field selected = contains(ColorField, {
    description: describeColor(
      'Selected row/item background. Falls back to a tint of --primary over --card when unset.',
    ),
  });
  @field tooltip = contains(ColorField, {
    description: describeColor(
      'Tooltip background; the one inverted surface. Do not use as foreground color.',
    ),
  });
  @field tooltipForeground = contains(ColorField, {
    description: describeColor('Text color on tooltip surfaces.'),
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
  @field subtleForeground = contains(ColorField, {
    description: describeColor(
      'Third ink step, fainter than --muted-foreground: timestamps, tertiary counts, placeholder-adjacent text.',
    ),
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
  @field success = contains(ColorField, {
    description: describeColor(
      'Success/positive feedback color. Not standard shadcn: falls back to the fixed Boxel status palette green (--boxel-success) when unset.',
    ),
  });
  @field successForeground = contains(ColorField, {
    description: describeColor('Text/icon color on success surfaces.'),
  });
  @field warning = contains(ColorField, {
    description: describeColor(
      'Warning/caution feedback color. Not standard shadcn: falls back to the fixed Boxel status palette yellow (--boxel-warning) when unset.',
    ),
  });
  @field warningForeground = contains(ColorField, {
    description: describeColor('Text/icon color on warning surfaces.'),
  });
  @field info = contains(ColorField, {
    description: describeColor(
      'Informational feedback color. Not standard shadcn. Do not use as foreground color.',
    ),
  });
  @field infoForeground = contains(ColorField, {
    description: describeColor('Text/icon color on info surfaces.'),
  });
  @field attention = contains(ColorField, {
    description: describeColor(
      'Needs-your-attention feedback color, distinct from warning and destructive. Not standard shadcn. Do not use as foreground color.',
    ),
  });
  @field attentionForeground = contains(ColorField, {
    description: describeColor('Text/icon color on attention surfaces.'),
  });
  @field overlay = contains(ColorField, {
    description: describeColor('Translucent scrim behind modals and drawers.'),
  });

  // hue-as-ink variables: each hue used as text/icon color on a neutral
  // surface, as opposed to the -foreground color used on the hue's own fill
  @field primaryInk = contains(ColorField, {
    description: describeColor(
      'Primary hue as text/icon color on neutral surfaces (links, labels). Falls back to a mix of --primary and --foreground when unset.',
    ),
  });
  @field secondaryInk = contains(ColorField, {
    description: describeColor(
      'Secondary hue as text/icon color on neutral surfaces. Falls back to a mix of --secondary and --foreground when unset.',
    ),
  });
  @field accentInk = contains(ColorField, {
    description: describeColor(
      'Accent hue as text/icon color on neutral surfaces. Falls back to a mix of --accent and --foreground when unset.',
    ),
  });
  @field destructiveInk = contains(ColorField, {
    description: describeColor(
      'Destructive hue as text/icon color on neutral surfaces. Falls back to a mix of --destructive and --foreground when unset.',
    ),
  });
  @field successInk = contains(ColorField, {
    description: describeColor(
      'Success hue as text/icon color on neutral surfaces. Falls back to a mix of --success and --foreground when unset.',
    ),
  });
  @field warningInk = contains(ColorField, {
    description: describeColor(
      'Warning hue as text/icon color on neutral surfaces. Falls back to a mix of --warning and --foreground when unset.',
    ),
  });
  @field infoInk = contains(ColorField, {
    description: describeColor(
      'Info hue as text/icon color on neutral surfaces. Falls back to a mix of --info and --foreground when unset.',
    ),
  });
  @field attentionInk = contains(ColorField, {
    description: describeColor(
      'Attention hue as text/icon color on neutral surfaces. Falls back to a mix of --attention and --foreground when unset.',
    ),
  });

  @field border = contains(ColorField, {
    description: describeColor('Specifies border-color.'),
  });
  @field borderStrong = contains(ColorField, {
    description: describeColor(
      'One visible step darker than --border, for dividers that must hold their own.',
    ),
  });
  @field input = contains(ColorField, {
    description: describeColor(
      'Border color for inputs, and the track fill of unfilled controls such as a switch. Input backgrounds come from --field.',
    ),
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
  @field chart6 = contains(ColorField, {
    description: describeColor('Sixth chart/graph color.'),
  });
  @field chart7 = contains(ColorField, {
    description: describeColor('Seventh chart/graph color.'),
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
  @field controlHeight = contains(CSSValueField, {
    description:
      'Height of form controls (inputs, selects, buttons). Defaults to 2.5rem.',
  });
  // box-shadow primitives, stored so tweakcn themes round-trip losslessly.
  // The composed shadow scale below does not derive from them; editing these
  // has no effect on rendered shadows.
  @field shadowX = contains(CSSValueField, {
    description: 'Horizontal shadow offset (e.g. 0, 3px).',
  });
  @field shadowY = contains(CSSValueField, {
    description: 'Vertical shadow offset (e.g. 1px, 3px).',
  });
  @field shadowBlur = contains(CSSValueField, {
    description: 'Shadow blur radius (e.g. 3px, 0px).',
  });
  @field shadowSpread = contains(CSSValueField, {
    description: 'Shadow spread radius (e.g. 0px, -1px).',
  });
  @field shadowOpacity = contains(CSSValueField, {
    description: 'Shadow opacity as a 0-1 number (e.g. 0.1).',
  });
  @field shadowColor = contains(ColorField, {
    description: describeColor(
      'Shadow base color from tweakcn; not applied to the shadow scale.',
    ),
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
  @field shadowInset = contains(CSSValueField, {
    description: 'Inset shadow for sunken wells and inputs.',
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
    'subtleForeground',
  ];
  private surfaceColors = [
    'canvas',
    'inset',
    'field',
    'hover',
    'stripe',
    'selected',
    'tooltip',
    'tooltipForeground',
  ];
  private formColors = [
    'border',
    'borderStrong',
    'input',
    'ring',
    'destructive',
    'destructiveForeground',
    'success',
    'successForeground',
    'warning',
    'warningForeground',
    'info',
    'infoForeground',
    'attention',
    'attentionForeground',
    'overlay',
  ];
  private inkColors = [
    'primaryInk',
    'secondaryInk',
    'accentInk',
    'destructiveInk',
    'successInk',
    'warningInk',
    'infoInk',
    'attentionInk',
  ];
  private chartColors = [
    'chart1',
    'chart2',
    'chart3',
    'chart4',
    'chart5',
    'chart6',
    'chart7',
  ];
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
  private boxShadows = [
    'shadowColor',
    'shadow2xs',
    'shadowXs',
    'shadowSm',
    'shadow',
    'shadowMd',
    'shadowLg',
    'shadowXl',
    'shadow2xl',
    'shadowInset',
  ];
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
        title: 'Surface Colors',
        description:
          'Neutral backgrounds beyond the card: the workspace ground, sunken wells, hover and selected states, zebra rows, and tooltips.',
        fields: getFieldGroup(this.surfaceColors, this),
      },
      {
        title: 'Form & Feedback Colors',
        fields: getFieldGroup(this.formColors, this),
      },
      {
        title: 'Ink Colors',
        description:
          "Each hue used as text or icon color on a neutral surface, as opposed to the -foreground color used on the hue's own fill.",
        fields: getFieldGroup(this.inkColors, this),
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
        fields: getFieldGroup(this.boxShadows, this, 'box-shadow'),
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
        { label: 'Inset', value: m.shadowInset },
      ].filter((s) => s.value);
    }

    private get fontStack() {
      if (!this.args.model) {
        return undefined;
      }
      let { fontSans, fontSerif, fontMono } = this.args.model;
      return [
        {
          label: 'sans-serif',
          stack: fontSans,
        },
        {
          label: 'serif',
          stack: fontSerif,
        },
        {
          label: 'monospace',
          stack: fontMono,
        },
      ];
    }

    <template>
      <div class='theme-var-edit'>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Main</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Background'
              @vertical={{true}}
              data-test-field='background'
            >
              <@fields.background />
            </FieldContainer>
            <FieldContainer
              @label='Foreground'
              @vertical={{true}}
              data-test-field='foreground'
            >
              <@fields.foreground />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Primary</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Primary'
              @vertical={{true}}
              data-test-field='primary'
            >
              <@fields.primary />
            </FieldContainer>
            <FieldContainer
              @label='Primary Foreground'
              @vertical={{true}}
              data-test-field='primaryForeground'
            >
              <@fields.primaryForeground />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Secondary & Accent</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Secondary'
              @vertical={{true}}
              data-test-field='secondary'
            >
              <@fields.secondary />
            </FieldContainer>
            <FieldContainer
              @label='Secondary Foreground'
              @vertical={{true}}
              data-test-field='secondaryForeground'
            >
              <@fields.secondaryForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Accent'
              @vertical={{true}}
              data-test-field='accent'
            >
              <@fields.accent />
            </FieldContainer>
            <FieldContainer
              @label='Accent Foreground'
              @vertical={{true}}
              data-test-field='accentForeground'
            >
              <@fields.accentForeground />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>UI Components</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Card'
              @vertical={{true}}
              data-test-field='card'
            >
              <@fields.card />
            </FieldContainer>
            <FieldContainer
              @label='Card Foreground'
              @vertical={{true}}
              data-test-field='cardForeground'
            >
              <@fields.cardForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Popover'
              @vertical={{true}}
              data-test-field='popover'
            >
              <@fields.popover />
            </FieldContainer>
            <FieldContainer
              @label='Popover Foreground'
              @vertical={{true}}
              data-test-field='popoverForeground'
            >
              <@fields.popoverForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Muted'
              @vertical={{true}}
              data-test-field='muted'
            >
              <@fields.muted />
            </FieldContainer>
            <FieldContainer
              @label='Muted Foreground'
              @vertical={{true}}
              data-test-field='mutedForeground'
            >
              <@fields.mutedForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Subtle Foreground'
              @vertical={{true}}
              data-test-field='subtleForeground'
            >
              <@fields.subtleForeground />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Surfaces</h4>
          <p class='theme-var-edit-hint'>
            Neutral backgrounds beyond the card: the workspace ground, sunken
            wells, hover and selected states, zebra rows, and tooltips.
          </p>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Canvas'
              @vertical={{true}}
              data-test-field='canvas'
            >
              <@fields.canvas />
            </FieldContainer>
            <FieldContainer
              @label='Inset'
              @vertical={{true}}
              data-test-field='inset'
            >
              <@fields.inset />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Field'
              @vertical={{true}}
              data-test-field='field'
            >
              <@fields.field />
            </FieldContainer>
            <FieldContainer
              @label='Hover'
              @vertical={{true}}
              data-test-field='hover'
            >
              <@fields.hover />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Stripe'
              @vertical={{true}}
              data-test-field='stripe'
            >
              <@fields.stripe />
            </FieldContainer>
            <FieldContainer
              @label='Selected'
              @vertical={{true}}
              data-test-field='selected'
            >
              <@fields.selected />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Tooltip'
              @vertical={{true}}
              data-test-field='tooltip'
            >
              <@fields.tooltip />
            </FieldContainer>
            <FieldContainer
              @label='Tooltip Foreground'
              @vertical={{true}}
              data-test-field='tooltipForeground'
            >
              <@fields.tooltipForeground />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Form & Feedback</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Border'
              @vertical={{true}}
              data-test-field='border'
            >
              <@fields.border />
            </FieldContainer>
            <FieldContainer
              @label='Border Strong'
              @vertical={{true}}
              data-test-field='borderStrong'
            >
              <@fields.borderStrong />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Input'
              @vertical={{true}}
              data-test-field='input'
            >
              <@fields.input />
            </FieldContainer>
            <FieldContainer
              @label='Ring'
              @vertical={{true}}
              data-test-field='ring'
            >
              <@fields.ring />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Destructive'
              @vertical={{true}}
              data-test-field='destructive'
            >
              <@fields.destructive />
            </FieldContainer>
            <FieldContainer
              @label='Destructive Foreground'
              @vertical={{true}}
              data-test-field='destructiveForeground'
            >
              <@fields.destructiveForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Success'
              @vertical={{true}}
              data-test-field='success'
            >
              <@fields.success />
            </FieldContainer>
            <FieldContainer
              @label='Success Foreground'
              @vertical={{true}}
              data-test-field='successForeground'
            >
              <@fields.successForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Warning'
              @vertical={{true}}
              data-test-field='warning'
            >
              <@fields.warning />
            </FieldContainer>
            <FieldContainer
              @label='Warning Foreground'
              @vertical={{true}}
              data-test-field='warningForeground'
            >
              <@fields.warningForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Info'
              @vertical={{true}}
              data-test-field='info'
            >
              <@fields.info />
            </FieldContainer>
            <FieldContainer
              @label='Info Foreground'
              @vertical={{true}}
              data-test-field='infoForeground'
            >
              <@fields.infoForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Attention'
              @vertical={{true}}
              data-test-field='attention'
            >
              <@fields.attention />
            </FieldContainer>
            <FieldContainer
              @label='Attention Foreground'
              @vertical={{true}}
              data-test-field='attentionForeground'
            >
              <@fields.attentionForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Overlay'
              @vertical={{true}}
              data-test-field='overlay'
            >
              <@fields.overlay />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Ink Colors</h4>
          <p class='theme-var-edit-hint'>
            Each hue used as text or icon color on a neutral surface. Leave
            blank to derive from the hue and the foreground color.
          </p>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Primary Ink'
              @vertical={{true}}
              data-test-field='primaryInk'
            >
              <@fields.primaryInk />
            </FieldContainer>
            <FieldContainer
              @label='Secondary Ink'
              @vertical={{true}}
              data-test-field='secondaryInk'
            >
              <@fields.secondaryInk />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Accent Ink'
              @vertical={{true}}
              data-test-field='accentInk'
            >
              <@fields.accentInk />
            </FieldContainer>
            <FieldContainer
              @label='Destructive Ink'
              @vertical={{true}}
              data-test-field='destructiveInk'
            >
              <@fields.destructiveInk />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Success Ink'
              @vertical={{true}}
              data-test-field='successInk'
            >
              <@fields.successInk />
            </FieldContainer>
            <FieldContainer
              @label='Warning Ink'
              @vertical={{true}}
              data-test-field='warningInk'
            >
              <@fields.warningInk />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Info Ink'
              @vertical={{true}}
              data-test-field='infoInk'
            >
              <@fields.infoInk />
            </FieldContainer>
            <FieldContainer
              @label='Attention Ink'
              @vertical={{true}}
              data-test-field='attentionInk'
            >
              <@fields.attentionInk />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Chart Colors</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Chart 1'
              @vertical={{true}}
              data-test-field='chart1'
            >
              <@fields.chart1 />
            </FieldContainer>
            <FieldContainer
              @label='Chart 2'
              @vertical={{true}}
              data-test-field='chart2'
            >
              <@fields.chart2 />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Chart 3'
              @vertical={{true}}
              data-test-field='chart3'
            >
              <@fields.chart3 />
            </FieldContainer>
            <FieldContainer
              @label='Chart 4'
              @vertical={{true}}
              data-test-field='chart4'
            >
              <@fields.chart4 />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Chart 5'
              @vertical={{true}}
              data-test-field='chart5'
            >
              <@fields.chart5 />
            </FieldContainer>
            <FieldContainer
              @label='Chart 6'
              @vertical={{true}}
              data-test-field='chart6'
            >
              <@fields.chart6 />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Chart 7'
              @vertical={{true}}
              data-test-field='chart7'
            >
              <@fields.chart7 />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Sidebar</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Sidebar'
              @vertical={{true}}
              data-test-field='sidebar'
            >
              <@fields.sidebar />
            </FieldContainer>
            <FieldContainer
              @label='Sidebar Foreground'
              @vertical={{true}}
              data-test-field='sidebarForeground'
            >
              <@fields.sidebarForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Sidebar Primary'
              @vertical={{true}}
              data-test-field='sidebarPrimary'
            >
              <@fields.sidebarPrimary />
            </FieldContainer>
            <FieldContainer
              @label='Sidebar Primary Foreground'
              @vertical={{true}}
              data-test-field='sidebarPrimaryForeground'
            >
              <@fields.sidebarPrimaryForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Sidebar Accent'
              @vertical={{true}}
              data-test-field='sidebarAccent'
            >
              <@fields.sidebarAccent />
            </FieldContainer>
            <FieldContainer
              @label='Sidebar Accent Foreground'
              @vertical={{true}}
              data-test-field='sidebarAccentForeground'
            >
              <@fields.sidebarAccentForeground />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Sidebar Border'
              @vertical={{true}}
              data-test-field='sidebarBorder'
            >
              <@fields.sidebarBorder />
            </FieldContainer>
            <FieldContainer
              @label='Sidebar Ring'
              @vertical={{true}}
              data-test-field='sidebarRing'
            >
              <@fields.sidebarRing />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Geometry</h4>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Border Radius'
              @vertical={{true}}
              data-test-field='radius'
            >
              <@fields.radius />
            </FieldContainer>
            <FieldContainer
              @label='Spacing'
              @vertical={{true}}
              data-test-field='spacing'
            >
              <@fields.spacing />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Base Font Size'
              @vertical={{true}}
              data-test-field='themeFontSize'
            >
              <@fields.themeFontSize />
            </FieldContainer>
            <FieldContainer
              @label='Typescale'
              @vertical={{true}}
              data-test-field='themeScale'
            >
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
            <FieldContainer
              @label='Letter Spacing'
              @vertical={{true}}
              data-test-field='trackingNormal'
            >
              <@fields.trackingNormal />
            </FieldContainer>
            <FieldContainer
              @label='Control Height'
              @vertical={{true}}
              data-test-field='controlHeight'
            >
              <@fields.controlHeight />
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
            <FieldContainer
              @label='2xs'
              @vertical={{true}}
              data-test-field='shadow2xs'
            >
              <@fields.shadow2xs />
            </FieldContainer>
            <FieldContainer
              @label='xs'
              @vertical={{true}}
              data-test-field='shadowXs'
            >
              <@fields.shadowXs />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='sm'
              @vertical={{true}}
              data-test-field='shadowSm'
            >
              <@fields.shadowSm />
            </FieldContainer>
            <FieldContainer
              @label='Base'
              @vertical={{true}}
              data-test-field='shadow'
            >
              <@fields.shadow />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='md'
              @vertical={{true}}
              data-test-field='shadowMd'
            >
              <@fields.shadowMd />
            </FieldContainer>
            <FieldContainer
              @label='lg'
              @vertical={{true}}
              data-test-field='shadowLg'
            >
              <@fields.shadowLg />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='xl'
              @vertical={{true}}
              data-test-field='shadowXl'
            >
              <@fields.shadowXl />
            </FieldContainer>
            <FieldContainer
              @label='2xl'
              @vertical={{true}}
              data-test-field='shadow2xl'
            >
              <@fields.shadow2xl />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Shadow inset'
              @vertical={{true}}
              data-test-field='shadowInset'
            >
              <@fields.shadowInset />
            </FieldContainer>
          </div>
          <h5 class='theme-var-edit-subheading'>Imported shadow primitives</h5>
          <p class='theme-var-edit-hint'>
            Kept so a tweakcn export round-trips. The shadow scale above is not
            derived from them, so editing these has no effect on rendered
            shadows.
          </p>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='X Offset'
              @vertical={{true}}
              data-test-field='shadowX'
            >
              <@fields.shadowX />
            </FieldContainer>
            <FieldContainer
              @label='Y Offset'
              @vertical={{true}}
              data-test-field='shadowY'
            >
              <@fields.shadowY />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Blur'
              @vertical={{true}}
              data-test-field='shadowBlur'
            >
              <@fields.shadowBlur />
            </FieldContainer>
            <FieldContainer
              @label='Spread'
              @vertical={{true}}
              data-test-field='shadowSpread'
            >
              <@fields.shadowSpread />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Opacity'
              @vertical={{true}}
              data-test-field='shadowOpacity'
            >
              <@fields.shadowOpacity />
            </FieldContainer>
            <FieldContainer
              @label='Color'
              @vertical={{true}}
              data-test-field='shadowColor'
            >
              <@fields.shadowColor />
            </FieldContainer>
          </div>
        </section>

        <section class='theme-var-edit-section'>
          <h4 class='theme-var-edit-heading'>Fonts</h4>
          <p class='theme-var-edit-hint'>
            Custom font family links must be added to the
            <strong>CSS Imports</strong>
            section (e.g. a Google Fonts url) below before they will render
            correctly.
          </p>
          <FontPreviews @fontStack={{this.fontStack}} />
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Sans-serif'
              @vertical={{true}}
              data-test-field='fontSans'
            >
              <@fields.fontSans />
            </FieldContainer>
            <FieldContainer
              @label='Serif'
              @vertical={{true}}
              data-test-field='fontSerif'
            >
              <@fields.fontSerif />
            </FieldContainer>
          </div>
          <div class='theme-var-edit-row theme-var-edit-row--2col'>
            <FieldContainer
              @label='Monospace'
              @vertical={{true}}
              data-test-field='fontMono'
            >
              <@fields.fontMono />
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
        .theme-var-edit-subheading {
          margin: var(--boxel-sp-sm) 0 0;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-400));
          text-transform: uppercase;
          letter-spacing: 0.04em;
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
