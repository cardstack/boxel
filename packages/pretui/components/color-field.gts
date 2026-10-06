// Pretui — ColorField: a colour value as a form field with a picker popover.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { Popover } from './popover';
import { FormField } from './form-field';
import { describeColor, parseColor, toHex } from '../color-engine';
import type { ColorValue, GamutId, SpaceId } from '../color-engine';
import { ColorPalette } from './color-palette';
import { ColorPicker } from './color-picker';
import type { ColorFormat } from './color-picker';
import { SwatchChip } from './swatch-chip';

// ── ColorField ───────────────────────────────────────────────────────────

/**
 * The small surface that OPENS the picker: a labelled form field whose
 * control is a swatch trigger plus a hex text input, with the full picker in
 * a popover.
 *
 * Composed rather than rebuilt: `FormField` (forms-core) owns the label,
 * description, required marking, issue routing and describedby wiring;
 * `Popover` (overlay) owns placement, dismissal, Escape and focus return;
 * `Swatch` is the trigger face. Nothing here re-implements any of that —
 * which is the point of having the foundations.
 */
export interface ColorFieldSignature {
  Args: {
    label?: string;
    value?: string;
    defaultValue?: string;
    description?: string;
    required?: boolean;
    disabled?: boolean;
    /** Path for form issue routing. */
    path?: string;
    space?: SpaceId;
    gamut?: GamutId;
    noAlpha?: boolean;
    format?: ColorFormat;
    /** Quick-pick swatches shown above the picker. */
    presets?: string[];
    onValueChange?: (value: string) => void;
  };
  Element: HTMLDivElement;
}

export class ColorField extends Component<ColorFieldSignature> {
  @tracked private internal: string | null = null;

  get value(): string {
    return this.args.value ?? this.internal ?? this.args.defaultValue ?? '';
  }
  get parsed(): ColorValue | null {
    return parseColor(this.value);
  }
  get display(): string {
    let parsed = this.parsed;
    return parsed ? toHex(parsed) : '';
  }
  get triggerLabel(): string {
    let parsed = this.parsed;
    return parsed
      ? `Colour: ${describeColor(parsed, this.args.gamut ?? 'srgb')}`
      : 'Choose a colour';
  }
  get swatchColor(): string {
    return this.value || 'transparent';
  }

  handleChange = (next: string) => {
    if (this.args.value === undefined) {
      this.internal = next;
    }
    this.args.onValueChange?.(next);
  };

  <template>
    <FormField
      @label={{@label}}
      @path={{@path}}
      @description={{@description}}
      @required={{@required}}
      @disabled={{@disabled}}
      data-test-pretui-color-field
      ...attributes
    >
      <:control as |control|>
        <div class='pretui-colorfield'>
          <Popover @placement='bottom-start' @label='Colour picker'>
            <:trigger as |open toggle|>
              <button
                type='button'
                class='pretui-colorfield-trigger'
                id={{control.id}}
                aria-expanded={{if open 'true' 'false'}}
                aria-haspopup='dialog'
                aria-label={{this.triggerLabel}}
                disabled={{@disabled}}
                {{on 'click' toggle}}
              >
                <SwatchChip
                  @color={{this.swatchColor}}
                  @shape='square'
                  @size={{18}}
                  aria-hidden='true'
                />
                <span class='pretui-colorfield-value'>{{this.display}}</span>
              </button>
            </:trigger>
            <:default>
              <div class='pretui-colorfield-panel'>
                {{#if @presets}}
                  <ColorPalette
                    @colors={{@presets}}
                    @value={{this.value}}
                    @label='Preset colours'
                    @onValueChange={{this.handleChange}}
                  />
                {{/if}}
                <ColorPicker
                  @value={{this.value}}
                  @space={{@space}}
                  @gamut={{@gamut}}
                  @noAlpha={{@noAlpha}}
                  @format={{@format}}
                  @onValueChange={{this.handleChange}}
                />
              </div>
            </:default>
          </Popover>
        </div>
      </:control>
    </FormField>
    <style scoped>
      @layer PretComponent {
        .pretui-colorfield {
          display: flex;
        }
        .pretui-colorfield-trigger {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2, 5px);
          height: var(--control-h, 28px);
          padding: 0 var(--space-3, 8px);
          border: 0;
          border-radius: var(--radius);
          background: var(--field, var(--boxel-light));
          box-shadow: 0 0 0 1px var(--input);
          font: inherit;
          font-size: var(--text-ui-md, 12.5px);
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-colorfield-trigger:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .pretui-colorfield-trigger:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-colorfield-value {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          min-width: 8ch;
          text-align: left;
        }
        .pretui-colorfield-panel {
          display: flex;
          flex-direction: column;
          gap: var(--space-3, 8px);
          padding: var(--space-3, 8px);
          min-width: 264px;
        }
      }
    </style>
  </template>
}
