import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Button, Tooltip } from '@cardstack/boxel-ui/components';
import CopyIcon from '@cardstack/boxel-icons/copy';

import {
  field,
  contains,
  Component,
  FieldDef,
  type FieldsTypeFor,
} from './card-api';
import ColorField from './color';
import CSSValueField from './css-value';

function dasherize(str: string): string {
  return str
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z\d]+)/g, '$1-$2')
    .toLowerCase();
}

type FieldNameType = keyof FieldsTypeFor<ThemeVarField> & string;

class TooltipWrapper extends GlimmerComponent<{
  Args: { value?: string; isCopied: boolean };
  Blocks: { default: [] };
}> {
  <template>
    <Tooltip @placement='right'>
      <:trigger>
        {{yield}}
      </:trigger>
      <:content>
        <div class='copy-tooltip-content'>
          <CopyIcon
            class='copy-icon'
            width='16'
            height='16'
            role='presentation'
          />
          {{#if @isCopied}}
            Copied!
          {{else}}
            Copy
          {{/if}}
        </div>
      </:content>
    </Tooltip>
    <style scoped>
      .copy-tooltip-content {
        display: flex;
        align-items: center;
        column-gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

class Embedded extends Component<typeof ThemeVarField> {
  @tracked
  recentlyCopiedValue?: string;

  private get fields() {
    if (!this.args.fields) {
      return;
    }
    let fieldNames = Object.keys(this.args.fields ?? {}) as FieldNameType[];
    if (!fieldNames?.length) {
      return;
    }
    let fields = [];
    for (let fieldName of fieldNames) {
      fields.push({
        fieldName,
        cssVariableName: `--${dasherize(fieldName)}`,
        component: this.args.fields[fieldName],
        value: this.args.model?.[fieldName] as string | undefined,
      });
    }
    return fields;
  }

  private copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    this.recentlyCopiedValue = text;
    setTimeout(() => {
      this.recentlyCopiedValue = undefined;
    }, 2000);
  };

  private isRecentyCopied = (text: string) => {
    return this.recentlyCopiedValue === text;
  };

  <template>
    <div class='field-list'>
      {{#each this.fields as |field|}}
        <TooltipWrapper
          @isCopied={{this.isRecentyCopied field.cssVariableName}}
        >
          <Button
            @kind='default'
            @size='auto'
            class='copy-code-button css-label'
            {{on 'click' (fn this.copyToClipboard field.cssVariableName)}}
            aria-label='copy CSS variable name'
          >
            {{field.cssVariableName}}
          </Button>
        </TooltipWrapper>
        {{#if field.value}}
          <TooltipWrapper @isCopied={{this.isRecentyCopied field.value}}>
            <button
              class='copy-code-button css-value'
              {{on 'click' (fn this.copyToClipboard field.value)}}
              aria-label='copy CSS variable value'
            >
              <field.component />
            </button>
          </TooltipWrapper>
        {{else}}
          <span class='code-preview empty-state'>/* not set */</span>
        {{/if}}
      {{/each}}
    </div>
    <style scoped>
      @layer baseComponent {
        .field-list {
          display: grid;
          grid-template-columns: 1fr 1.5fr;
          align-items: center;
          column-gap: var(--boxel-sp-xs);
          row-gap: var(--boxel-sp);
        }
        .copy-code-button {
          min-height: 2.5em;
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          column-gap: var(--boxel-sp-4xs);
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
          border: none;
          border-radius: var(--boxel-border-radius-sm);
          overflow-wrap: break-word;
          word-break: break-word;
          transition: none;
        }
        .css-label {
          font-weight: var(--boxel-font-weight-medium);
        }
        .css-value {
          background-color: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-500));
          font-weight: var(--boxel-font-weight-normal);
        }
        .empty-state {
          font-style: italic;
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

  static embedded = Embedded;
}
