import type { TemplateOnlyComponent } from '@ember/component/template-only';

import {
  BoxelDropdown,
  Button,
  Menu,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import type { MenuItem } from '@cardstack/boxel-ui/helpers';
import type { MenuDivider } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown, IconPlus } from '@cardstack/boxel-ui/icons';

import type { ModifierLike } from '@glint/template';

export interface NewFileOptions {
  menuItems: (MenuItem | MenuDivider)[];
  isDisabled?: boolean;
  onClose?: () => void;
}

interface TriggerButtonSignature {
  Args: {
    isCollapsed?: boolean;
    isDisabled?: boolean;
    bindings: ModifierLike<{ Args: { Positional: unknown[] } }>;
  };
  Element: HTMLButtonElement;
}

const NewFileTriggerButton: TemplateOnlyComponent<TriggerButtonSignature> =
  <template>
    <Button
      class={{cn
        'new-file-dropdown-trigger'
        new-file-dropdown-trigger--collapsed=@isCollapsed
      }}
      @kind='primary'
      @size='auto'
      @rectangular={{true}}
      @disabled={{@isDisabled}}
      {{@bindings}}
      aria-label='Create new file'
      data-test-new-file-button
      ...attributes
    >
      <IconPlus
        class='new-file-button-icon'
        width='14px'
        height='14px'
        role='presentation'
      />
      {{#unless @isCollapsed}}
        <span class='new-file-button-label'>New</span>
        <DropdownArrowDown
          class='dropdown-arrow'
          width='12px'
          height='12px'
          role='presentation'
        />
      {{/unless}}
    </Button>
    <style scoped>
      :global(:root) {
        --new-file-button-width: 6.25rem;
        --new-file-button-height: var(--container-button-size);
      }
      .new-file-dropdown-trigger {
        --icon-color: currentColor;
        height: var(--new-file-button-height);
        width: var(--new-file-button-width);
        padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
        justify-content: flex-start;
        gap: var(--boxel-sp-2xs);
        flex-shrink: 0;
      }
      .new-file-dropdown-trigger--collapsed {
        --new-file-button-width: var(--container-button-size);
        justify-content: center;
        padding-inline: var(--boxel-sp-2xs);
        gap: 0;
      }
      .new-file-dropdown-trigger:focus:not(:disabled) {
        outline-offset: 1px;
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
    </style>
  </template>;

interface Signature {
  Args: {
    dropdownOptions: NewFileOptions;
    initiallyOpened: boolean;
    isCollapsed?: boolean;
  };
  Element: HTMLDivElement;
}

const NewFileButton: TemplateOnlyComponent<Signature> = <template>
  <div ...attributes>
    <BoxelDropdown
      @initiallyOpened={{@initiallyOpened}}
      @onClose={{@dropdownOptions.onClose}}
      @contentClass='gap-above'
    >
      <:trigger as |bindings|>
        {{#if @isCollapsed}}
          <Tooltip @placement='right'>
            <:trigger>
              <NewFileTriggerButton
                @isCollapsed={{@isCollapsed}}
                @isDisabled={{@dropdownOptions.isDisabled}}
                @bindings={{bindings}}
              />
            </:trigger>
            <:content>New</:content>
          </Tooltip>
        {{else}}
          <NewFileTriggerButton
            @isDisabled={{@dropdownOptions.isDisabled}}
            @bindings={{bindings}}
          />
        {{/if}}
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
  </div>

  <style scoped>
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
    @media (max-width: 20rem) {
      .new-file-menu {
        min-width: 13.5rem;
        width: fit-content;
      }
    }
  </style>
</template>;

export default NewFileButton;
