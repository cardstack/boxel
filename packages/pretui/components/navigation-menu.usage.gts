// Pretui — NavigationMenu usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { NavigationMenu } from './navigation-menu';
import type { NavigationMenuItem } from './navigation-menu';

const SITE: NavigationMenuItem[] = [
  { id: 'home', label: 'Home', href: '#home' },
  {
    id: 'coffee',
    label: 'Coffee',
    children: [
      { id: 'single', label: 'Single origin', href: '#single', description: 'One farm, one lot, roasted to show it.' },
      { id: 'blends', label: 'Blends', href: '#blends', description: 'House espresso and the seasonal filter.' },
      { id: 'decaf', label: 'Decaf', href: '#decaf', description: 'Swiss water, no compromise.' },
    ],
  },
  {
    id: 'learn',
    label: 'Learn',
    children: [
      { id: 'brew', label: 'Brew guides', href: '#brew' },
      { id: 'origins', label: 'Origins', href: '#origins' },
    ],
  },
  { id: 'about', label: 'About', href: '#about' },
];

const SOURCE = "<NavigationMenu @items={{this.site}} @label='Site' @current='blends' />";

const NavigationMenuUsage: TemplateOnlyComponent = <template>
  <FreestyleUsage
    @name='NavigationMenu'
    @description='A site top navigation: destinations are real links, and an item with children is a disclosure button that opens a panel of links, on click and on hover. Escape, a press outside, or focus leaving the nav closes it. Menu holds actions; this holds destinations.'
    @source={{SOURCE}}
  >
    <:example>
      <div class='nm-demo'>
        <NavigationMenu @items={{SITE}} @label='Site' @current='blends' />
      </div>
    </:example>
    <:api as |Args|>
      <Args.Object @name='items' @required={{true}} @description='{ id, label, href?, children?: { id, label, href, description? }[] }[]' />
      <Args.String @name='label' @defaultValue='Main' />
      <Args.String @name='value' @description='Controlled open item id, or null.' />
      <Args.Action @name='onValueChange' />
      <Args.Bool @name='openOnHover' @defaultValue={{true}} />
      <Args.String @name='current' @description='The id of the current page link, marked aria-current.' />
      <Args.Yield @name='panel' @description='Replaces a panel link list, yielded the item and a close action.' />
    </:api>
  </FreestyleUsage>
  <style scoped>
    .nm-demo {
      padding-block-end: 10rem;
    }
  </style>
</template>;

export const DEMOS_NAVIGATION_MENU: Record<string, unknown> = {
  NavigationMenu: NavigationMenuUsage,
};
