import { array } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import menuItem from '../../helpers/menu-item.ts';
import IconTrash from '../../icons/icon-trash.gts';
import BoxelSelectionSummary from './index.gts';

export default class SelectionSummaryUsage extends Component {
  @tracked totalCount = 4;
  @tracked selectedCount = 3;

  private get deleteLabel() {
    return `Delete ${this.selectedCount} items`;
  }

  @action selectAll() {
    console.log('Action: select all');
    this.selectedCount = this.totalCount;
  }

  @action deselectAll() {
    console.log('Action: deselect all');
    this.selectedCount = 0;
  }

  @action deleteSelected() {
    console.log('Action: delete selected');
  }

  @action handleSelectedCountInput(val: number) {
    this.selectedCount = val;
  }

  @action handleTotalCountInput(val: number) {
    this.totalCount = val;
  }

  <template>
    <FreestyleUsage @name='SelectionSummary'>
      <:description>
        Displays the selection pill and a menu when >= 1 item is selected. The
        consumer provides the menu items.
      </:description>
      <:example>
        <div class='demo-row'>
          <BoxelSelectionSummary
            @selectedCount={{this.selectedCount}}
            @totalCount={{this.totalCount}}
            @onSelectAll={{this.selectAll}}
            @onDeselectAll={{this.deselectAll}}
            @menuItems={{array
              (menuItem 'Deselect All' this.deselectAll)
              (menuItem
                this.deleteLabel
                this.deleteSelected
                dangerous=true
                icon=IconTrash
              )
            }}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='selectedCount'
          @description='Number of selected items within the current scope.'
          @value={{this.selectedCount}}
          @onInput={{this.handleSelectedCountInput}}
        />
        <Args.Number
          @name='totalCount'
          @description='Total number of items in the current grid scope.'
          @value={{this.totalCount}}
          @onInput={{this.handleTotalCountInput}}
        />
        <Args.Action
          @name='onSelectAll'
          @description='Called when the pill is clicked with zero selection.'
        />
        <Args.Action
          @name='onDeselectAll'
          @description='Called when the pill is clicked with an active selection.'
        />
        <Args.Array
          @name='menuItems'
          @description='Array of menu items to render in the dropdown.'
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .demo-row {
        display: flex;
        gap: var(--boxel-sp);
        align-items: center;
        margin-block: var(--boxel-sp-sm);
      }
    </style>
  </template>
}
