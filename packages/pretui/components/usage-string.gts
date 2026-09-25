// Pretui — UsageString: a string argument with its knob.
import Component from '@glimmer/component';
import { Input } from './input';
import { Select } from './select';
import { UsageArgument } from './usage-argument';
import { PropReadOnly, PropRow, readOnlyText } from '../internal/freestyle';
import type { ArgsMode } from '../internal/freestyle';

// ── Freestyle::Usage::String ─────────────────────────────────────────────
export interface UsageStringSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
    value?: string | null;
    options?: string[];
    onInput?: (value: string) => void;
  };
  Element: HTMLElement;
}

export class UsageString extends Component<UsageStringSignature> {
  get isProp() {
    return this.args.mode === 'prop';
  }
  get selectOptions() {
    return (this.args.options ?? []).map((v) => ({ value: v, label: v }));
  }
  get valueStr() {
    return this.args.value ?? undefined;
  }
  get hasControl() {
    return typeof this.args.onInput === 'function';
  }
  get readOnlyValue() {
    return readOnlyText(this.args.value ?? this.args.defaultValue);
  }
  callOnInput = (v: string) => {
    this.args.onInput?.(v);
  };
  <template>
    {{#if this.isProp}}
      {{#unless @hideControls}}
        <PropRow @label={{@name}} @required={{@required}}>
          {{#if this.hasControl}}
            {{#if @options}}
              <Select
                @options={{this.selectOptions}}
                @value={{this.valueStr}}
                @onValueChange={{this.callOnInput}}
              />
            {{else}}
              <Input
                @value={{this.valueStr}}
                @onInput={{this.callOnInput}}
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
        @type='String'
        @name={{@name}}
        @description={{@description}}
        @required={{@required}}
        @defaultValue={{@defaultValue}}
      />
    {{/if}}
  </template>
}
