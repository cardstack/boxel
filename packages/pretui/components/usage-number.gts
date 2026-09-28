// Pretui — UsageNumber: a number argument with its knob.
import Component from '@glimmer/component';
import { Input } from './input';
import { Slider } from './slider';
import { UsageArgument } from './usage-argument';
import { PropReadOnly, PropRow, isPresent, readOnlyText } from '../internal/freestyle';
import type { ArgsMode } from '../internal/freestyle';

// ── Freestyle::Usage::Number ─────────────────────────────────────────────
export interface UsageNumberSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
    value?: number | null;
    min?: number;
    max?: number;
    step?: number;
    onInput?: (value: number | null) => void;
  };
  Element: HTMLElement;
}

export class UsageNumber extends Component<UsageNumberSignature> {
  get isProp() {
    return this.args.mode === 'prop';
  }
  get shouldRenderRangeInput() {
    return isPresent(this.args.min) && isPresent(this.args.max);
  }
  get hasControl() {
    return typeof this.args.onInput === 'function';
  }
  get readOnlyValue() {
    return readOnlyText(this.args.value ?? this.args.defaultValue);
  }
  get numValue() {
    return this.args.value ?? undefined;
  }
  get textValue() {
    return this.args.value == null ? undefined : String(this.args.value);
  }
  onSlide = (v: number) => {
    this.args.onInput?.(v);
  };
  onText = (v: string) => {
    this.args.onInput?.(v ? parseFloat(v) : null);
  };
  <template>
    {{#if this.isProp}}
      {{#unless @hideControls}}
        <PropRow @label={{@name}} @required={{@required}}>
          {{#if this.hasControl}}
            {{#if this.shouldRenderRangeInput}}
              <span class='numrange'>
                <Slider
                  @value={{this.numValue}}
                  @min={{@min}}
                  @max={{@max}}
                  @step={{@step}}
                  @label={{@name}}
                  @onValueChange={{this.onSlide}}
                />
                <span class='numrange-readout'>{{@value}}</span>
              </span>
            {{else}}
              <Input
                @type='number'
                @value={{this.textValue}}
                @onInput={{this.onText}}
                aria-label={{@name}}
              />
            {{/if}}
          {{else}}
            <PropReadOnly @value={{this.readOnlyValue}} />
          {{/if}}
        </PropRow>
      {{/unless}}
    {{else}}
      <UsageArgument
        @type='Number'
        @name={{@name}}
        @description={{@description}}
        @required={{@required}}
        @defaultValue={{@defaultValue}}
      />
    {{/if}}
    <style scoped>
      .numrange {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .numrange > :first-child {
        flex: 1;
      }
      .numrange-readout {
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        min-width: 30px;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}
