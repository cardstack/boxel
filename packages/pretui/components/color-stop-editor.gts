// Pretui — ColorStopEditor: the editor for one gradient stop.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Button } from './button';
import { ScrubInput } from './scrub-input';
import { Popover } from './popover';
import { describeColor, parseColor, round, toHex } from '../color-engine';
import type { ColorValue, GradientStop } from '../color-engine';
import { ColorPicker } from './color-picker';
import { SwatchChip } from './swatch-chip';

// ── ColorStopEditor ──────────────────────────────────────────────────────

/**
 * One row of the stop list: the swatch that opens a picker, the position,
 * and remove.
 *
 * This is the component the design-tools port's `GradientInput` should reuse
 * when it needs "let the user change this stop's colour" — it is the whole
 * of the colour half of a stop, and it holds no geometry beyond the position
 * number it is handed.
 */
export interface ColorStopEditorSignature {
  Args: {
    stop: GradientStop;
    selected?: boolean;
    disabled?: boolean;
    removable?: boolean;
    onSelect?: (id: string) => void;
    onColorChange: (id: string, color: string) => void;
    onPositionChange: (id: string, position: number | null) => void;
    onRemove?: (id: string) => void;
  };
  Element: HTMLDivElement;
}

export class ColorStopEditor extends Component<ColorStopEditorSignature> {
  get parsed(): ColorValue | null {
    return parseColor(this.args.stop.color);
  }
  get hex(): string {
    let parsed = this.parsed;
    return parsed ? toHex(parsed) : '';
  }
  get triggerLabel(): string {
    let parsed = this.parsed;
    return `Stop colour: ${parsed ? describeColor(parsed) : 'none'}`;
  }
  get removeLabel(): string {
    return `Remove stop at ${round(this.args.stop.position, 0)} percent`;
  }
  handleColor = (color: string) => {
    this.args.onColorChange(this.args.stop.id, color);
  };
  handlePosition = (value: number | null) => {
    this.args.onPositionChange(this.args.stop.id, value);
  };
  handleSelect = () => {
    this.args.onSelect?.(this.args.stop.id);
  };
  handleRemove = () => {
    this.args.onRemove?.(this.args.stop.id);
  };
  get removeDisabled(): boolean {
    return Boolean(this.args.disabled) || !this.args.removable;
  }
  get removeTitle(): string {
    return this.args.removable
      ? this.removeLabel
      : 'A gradient needs at least two stops';
  }
  <template>
    <div
      class='pretui-stoprow'
      data-state={{if @selected 'selected'}}
      data-test-pretui-color-stop={{@stop.id}}
      ...attributes
    >
      <Popover @placement='right-start' @label='Stop colour'>
        <:trigger as |open toggle|>
          <button
            type='button'
            class='pretui-stoprow-trigger'
            aria-expanded={{if open 'true' 'false'}}
            aria-haspopup='dialog'
            aria-label={{this.triggerLabel}}
            disabled={{@disabled}}
            {{on 'click' toggle}}
            {{on 'focus' this.handleSelect}}
          >
            <SwatchChip
              @color={{@stop.color}}
              @shape='square'
              @size={{16}}
              aria-hidden='true'
            />
            <span class='pretui-stoprow-hex'>{{this.hex}}</span>
          </button>
        </:trigger>
        <:default>
          <div class='pretui-stoprow-panel'>
            <ColorPicker
              @value={{@stop.color}}
              @format='hex'
              @onValueChange={{this.handleColor}}
            />
          </div>
        </:default>
      </Popover>

      <div class='pretui-stoprow-pos'>
        <ScrubInput
          @value={{@stop.position}}
          @min={{0}}
          @max={{100}}
          @step={{1}}
          @precision={{1}}
          @disabled={{@disabled}}
          @onInput={{this.handlePosition}}
        />
      </div>

      <Button
        @appearance='plain'
        @size='xs'
        @disabled={{this.removeDisabled}}
        aria-label={{this.removeLabel}}
        title={{this.removeTitle}}
        {{on 'click' this.handleRemove}}
      >✕</Button>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-stoprow {
          display: flex;
          align-items: center;
          gap: var(--space-2, 5px);
          padding: 2px;
          border-radius: calc(var(--radius) / 1.6);
        }
        .pretui-stoprow[data-state='selected'] {
          background: color-mix(
            in oklch,
            var(--primary) 10%,
            transparent
          );
        }
        .pretui-stoprow-trigger {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2, 5px);
          flex: 1 1 auto;
          min-width: 0;
          height: var(--control-h, 28px);
          padding: 0 var(--space-2, 5px);
          border: 0;
          border-radius: var(--radius);
          background: var(--field, var(--boxel-light));
          box-shadow: 0 0 0 1px var(--input);
          font: inherit;
          font-size: var(--text-ui-md, 12.5px);
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-stoprow-trigger:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-stoprow-hex {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
        }
        .pretui-stoprow-pos {
          flex: none;
          width: 72px;
        }
        .pretui-stoprow-panel {
          padding: var(--space-3, 8px);
          min-width: 264px;
        }
      }
    </style>
  </template>
}
