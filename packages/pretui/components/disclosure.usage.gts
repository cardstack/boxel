// Pretui — Disclosure usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Disclosure } from './disclosure';

class DisclosureUsage extends Component {
  @tracked open = false;
  setOpen = (v: boolean) => (this.open = v);
  <template>
    <FreestyleUsage
      @name='Disclosure'
      @description='Collapsible under the React Aria name: one trigger, one disclosed region. Reach for this import when a port or an agent already speaks the Aria vocabulary; the component, its contract and its writeup are Collapsible’s.'
      @source="<Disclosure @label='Grading notes' @open={{this.open}} @onOpenChange={{this.setOpen}}>…</Disclosure>"
    >
      <:example>
        <Disclosure
          @label='Grading notes'
          @open={{this.open}}
          @onOpenChange={{this.setOpen}}
        >
          <p class='pretui-demo-readout'>Leaf is even and tightly rolled, with a
            bright liquor and no astringency at the finish.</p>
        </Disclosure>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='open'
          @description='Controlled state; leave undefined for the uncontrolled half. Aria’s isExpanded.'
          @value={{this.open}}
          @onInput={{this.setOpen}}
        />
        <Args.Action
          @name='onOpenChange'
          @description='Fires with the next state on every toggle. Aria’s onExpandedChange.'
        />
        <Args.String @name='label' @value='Grading notes' />
        <Args.Yield @name='trigger' @description='Replaces @label; yielded the open state.' />
        <Args.Yield @name='default' @description='The disclosed region.' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_DISCLOSURE: Record<string, unknown> = {
  Disclosure: DisclosureUsage,
};
