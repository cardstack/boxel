// Pretui — UsageString: a string argument with its knob.
import Component from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import { Input } from './input';
import { Select } from './select';
import { Textarea } from './textarea';
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
    /** edit the value in a Textarea, for text with line breaks */
    multiline?: boolean;
    /** with @multiline: the Textarea reads as code, in the mono font with
     * long lines scrolling sideways rather than wrapping */
    monospace?: boolean;
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
  controlId = `${guidFor(this)}-control`;
  // the rail labels the control when there is one
  get labelFor() {
    return this.hasControl ? this.controlId : undefined;
  }
  callOnInput = (v: string) => {
    this.args.onInput?.(v);
  };
  <template>
    {{#if this.isProp}}
      {{#unless @hideControls}}
        <PropRow
          @label={{@name}}
          @required={{@required}}
          @controlId={{this.labelFor}}
        >
          {{#if this.hasControl}}
            {{#if @options}}
              <Select
                @options={{this.selectOptions}}
                @value={{this.valueStr}}
                @onValueChange={{this.callOnInput}}
                @controlId={{this.controlId}}
              />
            {{else if @multiline}}
              {{! Textarea sets its own font to inherit, so the mono font is
                  the wrapper's and the textarea takes it from there. }}
              <div
                class='pretui-usage-string-multiline'
                data-monospace={{if @monospace 'true' 'false'}}
              >
                <Textarea
                  @value={{this.valueStr}}
                  @onInput={{this.callOnInput}}
                  @controlId={{this.controlId}}
                  rows='6'
                  wrap={{if @monospace 'off' 'soft'}}
                />
              </div>
            {{else}}
              <Input
                @value={{this.valueStr}}
                @onInput={{this.callOnInput}}
                @controlId={{this.controlId}}
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
    <style scoped>
      .pretui-usage-string-multiline[data-monospace='true'] {
        font-family: var(--font-mono);
        font-size: var(--pretui-code-size, var(--boxel-font-size-xs));
        line-height: var(--pretui-code-leading, 1.6);
      }
      .pretui-usage-string-multiline[data-monospace='true'] textarea {
        white-space: pre;
        overflow-x: auto;
      }
    </style>
  </template>
}
