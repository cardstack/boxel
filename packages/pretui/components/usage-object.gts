// Pretui — UsageObject: a read-only object argument.
import Component from '@glimmer/component';
import { JsonTree } from './json-tree';
import { UsageArgument } from './usage-argument';
import { PropRow } from '../internal/freestyle';
import type { ArgsMode } from '../internal/freestyle';

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}
// ── Freestyle::Usage::Object (read-only) ─────────────────────────────────
export interface UsageObjectSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
    value?: unknown;
  };
  Element: HTMLElement;
}

export class UsageObject extends Component<UsageObjectSignature> {
  get isProp() {
    return this.args.mode === 'prop';
  }
  get json() {
    return stringify(this.args.value);
  }
  <template>
    {{#if this.isProp}}
      {{#unless @hideControls}}
        <PropRow @label={{@name}} @required={{@required}}>
          {{!-- Adopted 2026-08-13: this was a plain <pre> of the stringified
                value. JsonTree gives every Args.Object knob in the gallery
                collapsible nodes, type badges, copy-path and keyboard
                navigation — and an empty state instead of the literal text
                "undefined" for the call sites that pass no @value.
                The json getter is kept: it is the only caller of stringify.
                NOTE the long-form comment delimiters. A short {{! }} comment
                ends at its first closing pair, so a mustache inside one
                escapes into the template and orphans the next closing tag —
                local parse accepts it; the realm transpiler does not. --}}
          <JsonTree
            @value={{@value}}
            @label={{@name}}
            @hideToolbar={{true}}
            @pageSize={{25}}
            class='jsonviewer'
          />
        </PropRow>
      {{/unless}}
    {{else}}
      <UsageArgument
        @type='Object'
        @name={{@name}}
        @description={{@description}}
        @required={{@required}}
        @defaultValue={{@defaultValue}}
      />
    {{/if}}
    <style scoped>
      /* JsonTree brings its own surface; the knob channel is all that is
         needed here. */
      .jsonviewer {
        --pretui-json-max-height: 120px;
        --pretui-json-indent: 12px;
        --pretui-json-row-height: 20px;
      }
    </style>
  </template>
}
