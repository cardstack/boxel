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
  @tracked isRounded = true;
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
    <FreestyleUsage
      @name='Menu'
      @description='Vertical list of clickable menu items for dropdowns and context menus. Each item supports icons, separators, and disabled states.'
    >
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
          @isRounded={{this.isRounded}}
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
        <Args.Bool
          @name='isRounded'
          @optional={{true}}
          @description='Rounds the menu and its first/last items (via --boxel-menu-radius). Pass false when the menu fills a container that handles its own rounding.'
          @onInput={{fn (mut this.isRounded)}}
          @value={{this.isRounded}}
          @defaultValue={{true}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic @name='--boxel-menu-color' @type='background-color' />
        <Css.Basic @name='--boxel-menu-text-color' @type='color' />
        <Css.Basic
          @name='--boxel-menu-current-color'
          @type='background-color'
          @description='hovered item'
        />
        <Css.Basic
          @name='--boxel-menu-selected-color'
          @type='background-color'
          @description='selected (checked) item'
        />
        <Css.Basic
          @name='--boxel-menu-selected-font-color'
          @type='color'
          @description='selected (checked) item'
        />
        <Css.Basic
          @name='--boxel-menu-selected-hover-font-color'
          @type='color'
          @description='selected (checked) item on hover'
        />
        <Css.Basic
          @name='--boxel-menu-font'
          @type='font'
          @description='(css shorthand property)'
        />
        <Css.Basic
          @name='--boxel-menu-radius'
          @type='border-radius'
          @description='applies when @isRounded is true'
        />
        <Css.Basic
          @name='--boxel-menu-item-border-radius'
          @type='border-radius'
          @description='per-item border-radius'
        />
        <Css.Basic
          @name='--boxel-menu-item-gap'
          @type='gap'
          @description='between an item’s icon and text'
        />
        <Css.Basic @name='--boxel-menu-item-content-padding' @type='padding' />
      </:cssVars>
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
