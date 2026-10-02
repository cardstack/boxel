// Pretui — Collapsible usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { FreestyleUsage } from './freestyle-usage';
import { Collapsible } from './collapsible';
import type { SizeAlias } from '../internal/structure-layout';

class CollapsibleUsage extends Component {
  @tracked open = false;
  @tracked disabled = false;
  @tracked hideCaret = false;
  @tracked size = 'm';
  @tracked events = 0;

  sizeOptions = ['xs', 's', 'm', 'l', 'xl'];

  setOpen = (v: boolean) => {
    this.open = v;
    this.events = this.events + 1;
  };
  setDisabled = (v: boolean) => {
    this.disabled = v;
  };
  setHideCaret = (v: boolean) => {
    this.hideCaret = v;
  };
  setSize = (v: string) => {
    this.size = v;
  };

  get sizeValue(): SizeAlias {
    return this.size as SizeAlias;
  }

  get usage(): string {
    return [
      '<Collapsible',
      "  @label='Advanced'",
      '  @open={{this.open}}',
      '  @onOpenChange={{this.setOpen}}',
      '>',
      '  <FormRow …/>',
      '</Collapsible>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Collapsible'
      @description='One trigger, one disclosed region. The height animates with the kit expand grammar — a grid row track going from 0fr to 1fr — so there is no measurement, no max-height guess and no stale pixel value when the content reflows mid-transition. Content stays mounted and visibility takes it out of the tab order, so an input inside keeps its value across a toggle.'
      @source={{this.usage}}
    >
      <:example>
        <div class='fold-stage'>
          <Collapsible
            @label='Grading notes'
            @open={{this.open}}
            @onOpenChange={{this.setOpen}}
            @disabled={{this.disabled}}
            @hideCaret={{this.hideCaret}}
            @size={{this.sizeValue}}
          >
            <div class='fold-body'>
              <p class='fold-p'>Leaf is even and tightly rolled, with a bright
                liquor and no astringency at the finish. Cupped twice, both
                against the reference lot.</p>
              <p class='fold-p'>Toggle this twice and note that the region is
                never remounted — Radix rebuilds its children on every open
                unless you opt into a mode that then leaks focus into the
                closed box.</p>
            </div>
          </Collapsible>
          <p class='fold-count'>onOpenChange fired
            <b>{{this.events}}</b>
            times</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='open'
          @description='Controlled state. Leave it undefined for the uncontrolled half; the callback fires either way.'
          @defaultValue={{false}}
          @value={{this.open}}
          @onInput={{this.setOpen}}
        />
        <Args.Bool
          @name='defaultOpen'
          @description='The uncontrolled initial state.'
          @defaultValue={{false}}
        />
        <Args.Action
          @name='onOpenChange'
          @description='Fires on every toggle with the next state, controlled or not.'
        />
        <Args.String
          @name='label'
          @description='Trigger text. Sugar for the trigger block, which wins when both are present and is yielded the open state.'
        />
        <Args.Bool
          @name='disabled'
          @description='Announced and styled as disabled, and still focusable — aria-disabled, never the native attribute, because a control that leaves the tab order is a control that vanished.'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='hideCaret'
          @description='Drop the rotating chevron, for a trigger that is its own affordance. Radix and shadcn have no indicator slot at all, so this gets hand-built in every consumer.'
          @defaultValue={{false}}
          @value={{this.hideCaret}}
          @onInput={{this.setHideCaret}}
        />
        <Args.String
          @name='size'
          @description='The kit size scale.'
          @options={{this.sizeOptions}}
          @value={{this.size}}
          @onInput={{this.setSize}}
          @defaultValue='m'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-collapsible-h'
          @type='dimension'
          @description='Minimum trigger height, in em.'
          @defaultValue='2.24em'
        />
        <Css.Basic
          @name='pretui-dur-morph'
          @type='time'
          @description='The expand duration. A season retunes it for the whole kit.'
          @defaultValue='300ms'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .fold-stage {
        max-inline-size: 460px;
        padding: var(--space-5, 14px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .fold-body {
        padding-block-start: var(--space-3, 8px);
        display: grid;
        gap: var(--space-3, 8px);
      }
      .fold-p {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.55;
        color: var(--muted-foreground);
      }
      .fold-count {
        margin: var(--space-4, 11px) 0 0;
        font-size: var(--text-ui-xs, 11px);
        font-variant-numeric: tabular-nums;
        color: var(--ink-3, var(--boxel-400));
      }
    </style>
  </template>
}

export const DEMOS_COLLAPSIBLE: Record<string, unknown> = {
  Collapsible: CollapsibleUsage,
};
