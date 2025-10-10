import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import menuDivider from '../../helpers/menu-divider.ts';
import menuItem, { menuItemFunc } from '../../helpers/menu-item.ts';
import IconTrash from '../../icons/icon-trash.gts';
import BoxelMenu from './index.gts';

export default class MenuUsage extends Component {
  @tracked isLoading = false;
  @tracked menuItems: any[] = [];

  @action log(message: string): void {
    console.log(message);
  }
  @action closeMenu(): void {
    console.log('closeMenu called');
  }

  @action simulatedFetch(): void {
    this.isLoading = true;
    this.menuItems = [];

    setTimeout(() => {
      this.menuItems = [
        menuItemFunc(
          ['Duplicate', () => console.log('Duplicate menu item clicked')],
          {},
        ),
        menuItemFunc(
          ['Share', () => console.log('Share menu item clicked')],
          {},
        ),
      ];
      this.isLoading = false;
    }, 2000);
  }

  <template>
    <FreestyleUsage @name='Menu'>
      <:example>
        <BoxelMenu
          @closeMenu={{this.closeMenu}}
          @items={{array
            (menuItem 'Duplicate' (fn this.log 'Duplicate menu item clicked'))
            (menuItem 'Share' (fn this.log 'Share menu item clicked'))
            (menuDivider)
            (menuItem
              'Remove'
              (fn this.log 'Remove menu item clicked')
              icon=IconTrash
              dangerous=true
            )
          }}
          @loading={{this.isLoading}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @description="An array of MenuItems, created using the 'menu-item' helper. The menu-item helper accepts the menu item text as its first argument, and an action as the second argument."
        />
        <Args.Action
          @name='closeMenu'
          @description='Invoke this action to close the menu (e.g. when it is displayed as part of a dropdown'
        />
        <Args.String
          @name='itemClass'
          @description='CSS class to be added to the menu item.'
        />
        <Args.Bool
          @name='loading'
          @description='Shows a loading indicator instead of menu items when true.'
          @onInput={{fn (mut this.isLoading)}}
          @value={{this.isLoading}}
        />
      </:api>
    </FreestyleUsage>
    <FreestyleUsage @name='Menu (Fetch Use Case)'>
      <:example>
        <button
          type='button'
          {{on 'click' this.simulatedFetch}}
          disabled={{this.isLoading}}
        >
          Simulate Fetch
        </button>
        <BoxelMenu
          @closeMenu={{this.closeMenu}}
          @loading={{this.isLoading}}
          @items={{this.menuItems}}
        />
      </:example>
    </FreestyleUsage>
  </template>
}
