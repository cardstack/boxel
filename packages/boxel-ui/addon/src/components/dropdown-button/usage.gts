import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type BoxelButtonSize,
  type BoxelButtonKind,
} from '../button/index.gts';
import BoxelDropdownButton from './index.gts';

export default class DropdownButtonUsageComponent extends Component {
  items = [{ name: 'USA' }, { name: 'Chile' }, { name: 'Brazil' }];
  sizeVariants: BoxelButtonSize[] = [
    'extra-small',
    'small',
    'base',
    'tall',
    'touch',
  ];
  kindVariants: BoxelButtonKind[] = [
    'primary',
    'primary-dark',
    'secondary-light',
    'secondary-dark',
    'danger',
  ];
  defaultSize: BoxelButtonSize = 'base';
  defaultKind: BoxelButtonKind = 'secondary-light';
  @tracked size = this.defaultSize;
  @tracked kind = this.defaultKind;
  @tracked isDisabled = false;
  @tracked selectedItem = this.items[0];

  @action onSelect(item: { name: string }): void {
    // eslint-disable-next-line no-console
    console.log(`Selected ${item}`);
  }

  <template>
    <FreestyleUsage @name='DropdownButton'>
      <:example>
        <BoxelDropdownButton
          @items={{this.items}}
          @onSelect={{this.onSelect}}
          @selectedItem={{this.selectedItem}}
          @kind={{this.kind}}
          @size={{this.size}}
          @disabled={{this.isDisabled}}
        >
          Select a country
        </BoxelDropdownButton>
      </:example>
      <:api as |Args|>
        <Args.Object
          @required={{true}}
          @name='items'
          @description="An array of objects with at minimum a 'name' property OR an array of MenuItem components"
        />
        <Args.Action
          @name='onSelect'
          @description='Action to be called when an item is selected from the dropdown'
        />
        <Args.Object
          @name='selectedItem'
          @description="The currently selected item from the 'items' array"
        />
        <Args.String
          @name='kind'
          @description='Controls the kind variants of the button'
          @defaultValue={{this.defaultKind}}
          @options={{this.kindVariants}}
          @onInput={{fn (mut this.kind)}}
          @value={{this.kind}}
        />
        <Args.String
          @name='size'
          @description='Controls the size variants of the button'
          @defaultValue={{this.defaultSize}}
          @options={{this.sizeVariants}}
          @onInput={{fn (mut this.size)}}
          @value={{this.size}}
        />
        <Args.Bool
          @name='disabled'
          @description='Controls whether the button is disabled'
          @onInput={{fn (mut this.isDisabled)}}
          @value={{this.isDisabled}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
