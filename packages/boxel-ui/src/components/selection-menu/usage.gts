import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import type { MenuDivider } from '../../helpers/menu-divider.ts';
import { MenuItem } from '../../helpers/menu-item.ts';
import SelectionCheckmark from '../selection-checkmark/index.gts';
import SelectionMenu from './index.gts';

export default class SelectionMenuUsage extends Component {
  @tracked private selectedCount = 3;

  @action private selectAll() {
    this.selectedCount = 10;
  }

  @action private deselectAll() {
    this.selectedCount = 0;
  }

  // The items are supplied by the consumer — the component itself is
  // content-agnostic. Here we mirror a typical bulk-selection menu: an
  // inert count header plus a couple of actions.
  private get items(): Array<MenuItem | MenuDivider> {
    return [
      new MenuItem({
        label: `${this.selectedCount} Selected`,
        action: () => {},
        icon: SelectionCheckmark,
        header: true,
      }),
      new MenuItem({ label: 'Select All', action: this.selectAll }),
      new MenuItem({ label: 'Deselect All', action: this.deselectAll }),
    ];
  }

  <template>
    <FreestyleUsage
      @name='SelectionMenu'
      @description='Primary dropdown control for bulk selection: a trigger showing a selection checkmark + count + flipping caret, opening a caller-supplied action menu. Content-agnostic — Select All / Deselect All and the count header are passed in via @items.'
    >
      <:example>
        <SelectionMenu
          @selectedCount={{this.selectedCount}}
          @items={{this.items}}
        />
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='selectedCount'
          @description='Count shown in the trigger'
          @value={{this.selectedCount}}
          @required={{true}}
        />
        <Args.Object
          @name='items'
          @description='Menu items (MenuItem | MenuDivider) supplied by the consumer'
          @value={{this.items}}
          @required={{true}}
        />
        <Args.String
          @name='label'
          @description='Accessible name for the trigger; defaults to the count'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
