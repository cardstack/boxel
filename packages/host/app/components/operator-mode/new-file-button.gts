import Component from '@glimmer/component';
import { capitalize } from '@ember/string';
import startCase from 'lodash/startCase';
import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';
import flatMap from 'lodash/flatMap';
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
            stroke='var(--boxel-light)'
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

    <style>
      .new-file-button {
        --new-file-button-width: 7.5rem;
        --new-file-button-height: var(--boxel-form-control-height);
        --boxel-button-text-color: var(--boxel-light);

        height: var(--new-file-button-height);
        width: var(--new-file-button-width);
        margin-left: var(--boxel-sp);
      }
      .new-file-button-icon {
        --icon-color: var(--boxel-light);
        flex-shrink: 0;
        margin-right: var(--boxel-sp-5xs);
      }
    </style>
  </template>

  private get menuItems() {
    return flatMap(newFileTypes, (id) => {
      if (id === 'duplicate-instance') {
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
