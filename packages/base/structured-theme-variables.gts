import { CopyButton } from '@cardstack/boxel-ui/components';
import {
  entriesToCssRuleMap,
  type CssVariableEntry,
} from '@cardstack/boxel-ui/helpers';

import {
  field,
  contains,
  Component,
  FieldDef,
  getFields,
  type BaseDefComponent,
  type BoxComponent,
  type FieldsTypeFor,
} from './card-api';
import ColorField from './color';
import CSSValueField from './css-value';
import type { CssRuleMap } from '@cardstack/boxel-ui/helpers';

export function dasherize(str?: string): string {
  return (
    str
      ?.trim()
      .replace(/\s+/g, '-')
      .replace(/([a-z\d])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z\d]+)/g, '$1-$2')
      .toLowerCase() ?? ''
  );
}

type FieldNameType = keyof FieldsTypeFor<ThemeVarField> & string;

interface CssVariableField extends CssVariableEntry {
  fieldName: FieldNameType;
  cssVariableName: string;
  component?: BoxComponent;
}

class Embedded extends Component<typeof ThemeVarField> {
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

export default class ThemeVarField extends FieldDef {
  static displayName = 'Structured Theme Variables';

  // color variables
  @field background = contains(ColorField);
  @field foreground = contains(ColorField);
  @field card = contains(ColorField);
  @field cardForeground = contains(ColorField);
  @field popover = contains(ColorField);
  @field popoverForeground = contains(ColorField);
  @field primary = contains(ColorField);
  @field primaryForeground = contains(ColorField);
  @field secondary = contains(ColorField);
  @field secondaryForeground = contains(ColorField);
  @field muted = contains(ColorField);
  @field mutedForeground = contains(ColorField);
  @field accent = contains(ColorField);
  @field accentForeground = contains(ColorField);
  @field destructive = contains(ColorField);
  @field destructiveForeground = contains(ColorField);
  @field border = contains(ColorField, {
    description: 'Specifies border-color.',
  });
  @field input = contains(ColorField);
  @field ring = contains(ColorField);

  // chart color variables
  @field chart1 = contains(ColorField);
  @field chart2 = contains(ColorField);
  @field chart3 = contains(ColorField);
  @field chart4 = contains(ColorField);
  @field chart5 = contains(ColorField);

  // sidebar color variables
  @field sidebar = contains(ColorField);
  @field sidebarForeground = contains(ColorField);
  @field sidebarPrimary = contains(ColorField);
  @field sidebarPrimaryForeground = contains(ColorField);
  @field sidebarAccent = contains(ColorField);
  @field sidebarAccentForeground = contains(ColorField);
  @field sidebarBorder = contains(ColorField);
  @field sidebarRing = contains(ColorField);

  // font variables
  @field fontSans = contains(CSSValueField);
  @field fontSerif = contains(CSSValueField);
  @field fontMono = contains(CSSValueField);

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
  @field shadow2xs = contains(CSSValueField);
  @field shadowXs = contains(CSSValueField);
  @field shadowSm = contains(CSSValueField);
  @field shadow = contains(CSSValueField, {
    description: 'Specifies box-shadow base value.',
  });
  @field shadowMd = contains(CSSValueField);
  @field shadowLg = contains(CSSValueField);
  @field shadowXl = contains(CSSValueField);
  @field shadow2xl = contains(CSSValueField);

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
