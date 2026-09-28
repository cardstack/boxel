// Pretui — Breadcrumb usage page.
import Component from '@glimmer/component';
import { FreestyleUsage } from './freestyle-usage';
import { Breadcrumb } from './breadcrumb';

const CRUMBS = [
  { label: 'Auctions', href: '#auctions' },
  { label: 'Spring 2026', href: '#spring-2026' },
  { label: 'Lot B-103' },
];

class BreadcrumbUsage extends Component {
  items = CRUMBS;
  <template>
    <FreestyleUsage @name='Breadcrumb' @description='A semantic navigation trail whose current location is plain emphasized text and whose ancestors remain links.' @source='<Breadcrumb @items={{this.items}} />'>
      <:example><Breadcrumb @items={{this.items}} /></:example>
      <:api as |Args|><Args.Object @name='items' @value={{this.items}} /></:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_BREADCRUMB: Record<string, unknown> = {
  Breadcrumb: BreadcrumbUsage,
};
