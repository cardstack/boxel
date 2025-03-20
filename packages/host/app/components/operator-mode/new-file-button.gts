import { capitalize } from '@ember/string';
import Component from '@glimmer/component';

import flatMap from 'lodash/flatMap';
import startCase from 'lodash/startCase';

import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';

import { type FileType, newFileTypes } from './create-file-modal';

interface Signature {
  Args: {
    onSelectNewFileType: (fileType: FileType) => void;
    isCreateModalShown: boolean;
  };
}

export default class NewFileButton extends Component<Signature> {
  <template>
    <BoxelDropdown>
      <:trigger as |bindings|>
        <Button
          class='new-file-button'
          @kind='primary'
          @size='small'
          @disabled={{@isCreateModalShown}}
          {{bindings}}
          data-test-new-file-button
        >
          <IconPlus
            @width='var(--boxel-icon-sm)'
            @height='var(--boxel-icon-sm)'
            stroke='var(--boxel-dark)'
            stroke-width='1px'
            aria-label='Add'
            class='new-file-button-icon'
          />
          New File
        </Button>
      </:trigger>
      <:content as |dd|>
        <Menu
          @items={{this.menuItems}}
          @closeMenu={{dd.close}}
          data-test-new-file-dropdown-menu
        />
      </:content>
    </BoxelDropdown>

    <style scoped>
      .new-file-button {
        --new-file-button-width: 7.5rem;
        --new-file-button-height: var(--operator-mode-top-bar-item-height);
        --boxel-button-text-color: var(--boxel-dark);

        height: var(--new-file-button-height);
        width: var(--new-file-button-width);
        margin-left: var(--operator-mode-spacing);
        flex-shrink: 0;
      }
      .new-file-button-icon {
        --icon-color: var(--boxel-dark);
        width: 14px;
        height: 14px;
        margin-right: var(--boxel-sp-xs);
        flex-shrink: 0;
      }
    </style>
  </template>

  private get menuItems() {
    return flatMap(newFileTypes, (id) => {
      if (id === 'duplicate-instance' || id === 'spec-instance') {
        return [];
      }
      let displayName = capitalize(startCase(id));
      return [
        new MenuItem(displayName, 'action', {
          action: () => this.args.onSelectNewFileType({ id, displayName }),
        }),
      ];
    });
  }
}
