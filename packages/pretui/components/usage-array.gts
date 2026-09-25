// Pretui — UsageArray: an array argument with its knob.
import Component from '@glimmer/component';
import { Input } from './input';
import { UsageArgument } from './usage-argument';
import { PropReadOnly, PropRow, readOnlyText } from '../internal/freestyle';
import type { ArgsMode } from '../internal/freestyle';

// ── Freestyle::Usage::Array ──────────────────────────────────────────────
export interface UsageArraySignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
    value?: string[];
    onInput?: (value: string[]) => void;
  };
  Element: HTMLElement;
}

export class UsageArray extends Component<UsageArraySignature> {
  get isProp() {
    return this.args.mode === 'prop';
  }
  get text() {
    return (this.args.value ?? []).join(', ');
  }
  get hasControl() {
    return typeof this.args.onInput === 'function';
  }
  get readOnlyValue() {
    return readOnlyText(this.args.value ?? this.args.defaultValue);
  }
  callOnInput = (raw: string) => {
    this.args.onInput?.(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  };
  <template>
    {{#if this.isProp}}
      {{#unless @hideControls}}
        <PropRow @label={{@name}} @required={{@required}}>
          {{#if this.hasControl}}
            <Input
              @value={{this.text}}
              @onInput={{this.callOnInput}}
              aria-label={{@name}}
            />
          {{else}}
            <PropReadOnly @value={{this.readOnlyValue}} />
          {{/if}}
        </PropRow>
      {{/unless}}
    {{else}}
      <UsageArgument
        @type='Array'
        @name={{@name}}
        @description={{@description}}
        @required={{@required}}
        @defaultValue={{@defaultValue}}
      />
    {{/if}}
  </template>
}
