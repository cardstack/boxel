// Pretui — UsageBool: a boolean argument with its knob.
import Component from '@glimmer/component';
import { Switch } from './switch';
import { UsageArgument } from './usage-argument';
import { PropReadOnly, PropRow, readOnlyText } from '../internal/freestyle';
import type { ArgsMode } from '../internal/freestyle';

// ── Freestyle::Usage::Bool ───────────────────────────────────────────────
export interface UsageBoolSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
    value?: boolean;
    onInput?: (value: boolean) => void;
  };
  Element: HTMLElement;
}

export class UsageBool extends Component<UsageBoolSignature> {
  get isProp() {
    return this.args.mode === 'prop';
  }
  get hasControl() {
    return typeof this.args.onInput === 'function';
  }
  get readOnlyValue() {
    return readOnlyText(this.args.value ?? this.args.defaultValue);
  }
  callOnInput = (v: boolean) => {
    this.args.onInput?.(v);
  };
  <template>
    {{#if this.isProp}}
      {{#unless @hideControls}}
        <PropRow @label={{@name}} @required={{@required}}>
          {{#if this.hasControl}}
            <Switch
              @checked={{@value}}
              @onCheckedChange={{this.callOnInput}}
              aria-label={{@name}}
            />
          {{else}}
            <PropReadOnly @value={{this.readOnlyValue}} />
          {{/if}}
        </PropRow>
      {{/unless}}
    {{else}}
      <UsageArgument
        @type='Bool'
        @name={{@name}}
        @description={{@description}}
        @required={{@required}}
        @defaultValue={{@defaultValue}}
      />
    {{/if}}
  </template>
}
