// Pretui — Popup usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from '../freestyle';
import { Button } from '../controls';
import { Popup } from '../overlay';

class PopupUsage extends Component {
  @tracked open = false;
  toggle = () => (this.open = !this.open);
  <template>
    <FreestyleUsage @name='Popup' @description='The headless anchored-positioning foundation used by higher-level overlays. It owns clipping escape and placement, not panel appearance or dismissal policy.' @source='<Popup @open={{this.open}} @placement="bottom-start">…</Popup>'>
      <:example><Popup @open={{this.open}} @placement='bottom-start' @distance={{8}}><:anchor><Button @variant='secondary' {{on 'click' this.toggle}}>Toggle details</Button></:anchor><:default><div class='popup-panel'><b>Lot B-103</b><span>65 chests · Shizuoka</span><Button @variant='ghost' {{on 'click' this.toggle}}>Close</Button></div></:default></Popup></:example>
      <:api as |Args|><Args.Bool @name='open' @value={{this.open}} @onInput={{this.toggle}} /><Args.String @name='placement' @value='bottom-start' /><Args.Number @name='distance' @value={{8}} /><Args.Bool @name='matchWidth' @defaultValue={{false}} /><Args.Yield @name='anchor' /><Args.Yield @name='default' /></:api>
    </FreestyleUsage>
    <style scoped>.popup-panel { display: grid; gap: 5px; min-width: 220px; padding: 10px; border-radius: var(--radius); color: var(--foreground); background: var(--popover); box-shadow: var(--pretui-shadow-raised); font-size: var(--text-ui-md); }.popup-panel > span { color: var(--muted-foreground); }</style>
  </template>
}

export const DEMOS_POPUP: Record<string, unknown> = {
  Popup: PopupUsage,
};
