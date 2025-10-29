import { TemplateOnlyComponent } from '@ember/component/template-only';

import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui/components';
import { type MenuDivider, MenuItem } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown, IconPlus } from '@cardstack/boxel-ui/icons';

export interface NewFileOptions {
  menuItems: (MenuItem | MenuDivider)[];
  isDisabled?: boolean;
  onClose?: () => void;
}

interface Signature {
  Args: {
    dropdownOptions: NewFileOptions;
    initiallyOpened: boolean;
  };
  Element: HTMLElement;
}

const NewFileButton: TemplateOnlyComponent<Signature> = <template>
  <BoxelDropdown
    @initiallyOpened={{@initiallyOpened}}
    @onClose={{@dropdownOptions.onClose}}
    @contentClass='gap-above'
  >
    <:trigger as |bindings|>
      <Button
        class='new-file-dropdown-trigger'
        @kind='primary'
        @size='tall'
        @disabled={{@dropdownOptions.isDisabled}}
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
        @items={{@dropdownOptions.menuItems}}
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
      flex-shrink: 0;
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
    :deep(.boxel-menu__separator) {
      border-color: var(--boxel-300);
    }
    :deep(.menu-item) {
      display: grid;
      grid-template-columns: auto 1fr;
      row-gap: var(--boxel-sp-6xs);
      column-gap: var(--boxel-sp-xs);
      line-height: calc(18 / 11);
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
</template>;

export default NewFileButton;
