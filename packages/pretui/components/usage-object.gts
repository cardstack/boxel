// Pretui — UsageObject: a read-only object argument.
import Component from '@glimmer/component';
import { JsonTree } from './json-tree';
import { UsageArgument } from './usage-argument';
import { PropRow } from '../internal/freestyle';
import type { ArgsMode } from '../internal/freestyle';

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
  <template>
    {{#if this.isProp}}
      {{#unless @hideControls}}
        <PropRow @label={{@name}} @required={{@required}}>
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
        --pretui-json-max-height: 7.5rem;
        --pretui-json-indent: var(--boxel-sp-sm);
      }
    </style>
  </template>
}
