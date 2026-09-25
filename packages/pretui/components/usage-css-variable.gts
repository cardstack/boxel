// Pretui — UsageCssVariable: a documented CSS custom property.
import Component from '@glimmer/component';
import { Input } from './input';
import { UsageArgument } from './usage-argument';
import { PropRow } from '../internal/freestyle';
import type { ArgsMode } from '../internal/freestyle';

// ── Freestyle::Usage::BasicCssVariable ───────────────────────────────────
export interface UsageCssVariableSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    value?: string | null;
    onInput?: (value: string) => void;
  };
  Element: HTMLElement;
}

export class UsageCssVariable extends Component<UsageCssVariableSignature> {
  get isProp() {
    return this.args.mode === 'prop';
  }
  get valueStr() {
    return this.args.value ?? undefined;
  }
  get hasControl() {
    return this.args.onInput !== undefined;
  }
  callOnInput = (v: string) => {
    this.args.onInput?.(v);
  };
  <template>
    {{#if this.isProp}}
      {{#if this.hasControl}}
        <PropRow @label={{@name}}>
          <Input
            @value={{this.valueStr}}
            @onInput={{this.callOnInput}}
            aria-label={{@name}}
          />
        </PropRow>
      {{/if}}
    {{else}}
      <UsageArgument
        @typeLabel='CSS'
        @name={{@name}}
        @description={{@description}}
        @defaultValue={{@defaultValue}}
      />
    {{/if}}
  </template>
}
