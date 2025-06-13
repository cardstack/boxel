import { capitalize } from '@ember/string';
import Component from '@glimmer/component';

import flatMap from 'lodash/flatMap';
import startCase from 'lodash/startCase';

import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown, IconPlus } from '@cardstack/boxel-ui/icons';

import { type FileType, newFileTypes } from './create-file-modal';

interface Signature {
  Args: {
    onSelectNewFileType: (fileType: FileType) => void;
    isCreateModalShown: boolean;
  };
  Element: HTMLElement;
}

export default class NewFileButton extends Component<Signature> {
  <template>
    <BoxelDropdown @contentClass='gap-above'>
      <:trigger as |bindings|>
        <Button
          class='new-file-dropdown-trigger'
          @kind='primary'
          @size='tall'
          @disabled={{@isCreateModalShown}}
          {{bindings}}
          aria-label='Create new file'
          ...attributes
          data-test-new-file-button
        >
          <IconPlus
            class='new-file-button-icon'
            width='14px'
            height='14px'
            role='presentation'
          />
          New
          <DropdownArrowDown
            class='dropdown-arrow'
            width='12px'
            height='12px'
            role='presentation'
          />
        </Button>
      </:trigger>
      <:content as |dd|>
        <Menu
          class='new-file-menu'
          @items={{this.menuItems}}
          @closeMenu={{dd.close}}
          data-test-new-file-dropdown-menu
        />
      </:content>
    </BoxelDropdown>

    <style scoped>
      .new-file-dropdown-trigger {
        --new-file-button-width: 6.25rem; /* 100px */
        --new-file-button-height: var(--operator-mode-top-bar-item-height);

        height: var(--new-file-button-height);
        width: var(--new-file-button-width);
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        justify-content: flex-start;
        gap: var(--boxel-sp-xxs);
      }
      .new-file-dropdown-trigger:focus:not(:disabled) {
        outline-offset: 1px;
      }
      .new-file-dropdown-trigger svg {
        --icon-color: currentColor;
        flex-shrink: 0;
      }
      .new-file-button-icon > :deep(path) {
        stroke: none;
      }
      .dropdown-arrow {
        margin-left: auto;
      }
      .new-file-dropdown-trigger[aria-expanded='true'] .dropdown-arrow {
        transform: rotate(180deg);
      }
      .new-file-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs);
        width: 19.375rem; /* 310px */
      }
      :deep(.menu-item) {
        display: grid;
        grid-template-columns: auto 1fr;
        row-gap: var(--boxel-sp-6xs);
        column-gap: var(--boxel-sp-xs);
      }
      :deep(.menu-item .subtext) {
        grid-column: 2;
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp);
      }
      :deep(.menu-item .icon) {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
      }
      .new-file-menu :deep(.postscript) {
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .new-file-menu :deep(.check-icon) {
        display: none;
      }
    </style>
  </template>

  private get menuItems() {
    return flatMap(newFileTypes, ({ id, icon, description, extension }) => {
      if (id === 'duplicate-instance' || id === 'spec-instance') {
        return [];
      }
      let displayName = capitalize(startCase(id));
      return [
        new MenuItem(displayName, 'action', {
          action: () => this.args.onSelectNewFileType({ id, displayName }),
          subtext: description,
          icon,
          postscript: extension,
        }),
      ];
    });
  }
}
