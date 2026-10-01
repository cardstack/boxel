// Pretui — BottomNav usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { BottomNav } from './bottom-nav';
import type { BottomNavItem } from './bottom-nav';

const ITEMS: BottomNavItem[] = [
  { id: 'home', label: 'Home' },
  { id: 'lots', label: 'Lots', badge: '3' },
  { id: 'roasts', label: 'Roasts' },
  { id: 'account', label: 'Account' },
];
const GLYPHS: Record<string, string> = { home: '⌂', lots: '▦', roasts: '◉', account: '◎' };

export class BottomNavUsage extends Component {
  items = ITEMS;
  @tracked current = 'lots';
  setCurrent = (v: string) => (this.current = v);
  glyph = (id: string) => GLYPHS[id] ?? '•';
  get usage() {
    return "<BottomNav @items={{this.items}} @value={{this.current}} @onChange={{this.go}} @label='Roastery'>\n  <:icon as |item|>…</:icon>\n</BottomNav>";
  }
  <template>
    <FreestyleUsage
      @name='BottomNav'
      @description='The mobile tab bar docked to the bottom of its pane: a named navigation landmark of links or buttons, the current one marked aria-current, labels always visible. It is sticky inside its scroll container, not fixed to the viewport, and padded clear of the safe area. Tabs switches content in flow; Sidebar is the desktop rail.'
      @source={{this.usage}}
    >
      <:example>
        <div class='bn-demo'>
          <p class='bn-demo-body'>Showing: {{this.current}}</p>
          <BottomNav @items={{this.items}} @value={{this.current}} @onChange={{this.setCurrent}} @label='Roastery'>
            <:icon as |item|>{{this.glyph item.id}}</:icon>
          </BottomNav>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object @name='items' @required={{true}} @description='{ id, label, href?, badge?, disabled? }[]' />
        <Args.String @name='value' @description='Controlled current id; defaultValue seeds the uncontrolled form.' />
        <Args.Action @name='onChange' />
        <Args.String @name='label' @defaultValue='Primary' />
        <Args.String @name='position' @defaultValue='sticky' @description='sticky or static.' />
        <Args.Yield @name='icon' @description='One item icon, yielded the item and whether it is current.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .bn-demo {
        display: grid;
        grid-template-rows: 1fr auto;
        block-size: 12rem;
        max-inline-size: 24rem;
        border-radius: var(--radius-surface, 10px);
        box-shadow: 0 0 0 1px var(--border);
        overflow: hidden;
      }
      .bn-demo-body {
        margin: 0;
        padding: var(--space-4, 0.6875rem);
        font-size: var(--text-ui-md, 0.78rem);
      }
    </style>
  </template>
}

export const DEMOS_BOTTOM_NAV: Record<string, unknown> = {
  BottomNav: BottomNavUsage,
};
