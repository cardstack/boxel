import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { array } from '@ember/helper';

import {
  BoxelDropdown,
  IconButton,
  Menu,
} from '@cardstack/boxel-ui/components';
import { menuDivider, menuItem } from '@cardstack/boxel-ui/helpers';
import { Warning as WarningIcon } from '@cardstack/boxel-ui/icons';
import DotsVertical from '@cardstack/boxel-icons/dots-vertical';

interface Signature {
  Args: {
    toggleSettings: () => void;
    toggleRemoveModal: () => void;
  };
  Yields: {
    default: [];
  };
  Element: HTMLElement;
}

const ContextMenuButton: TemplateOnlyComponent<Signature> = <template>
  <BoxelDropdown @contentClass='context-menu'>
    <:trigger as |bindings|>
      <IconButton
        class='context-menu-trigger'
        @icon={{DotsVertical}}
        @size='extra-small'
        aria-label='field options'
        {{bindings}}
        ...attributes
      />
    </:trigger>
    <:content as |dd|>
      <div class='warning-box'>
        <p class='warning'>
          These actions will break compatibility with existing card instances.
        </p>
        <WarningIcon
          class='warning-icon'
          width='20px'
          height='20px'
          role='presentation'
        />
      </div>
      <Menu
        class='context-menu-list'
        @items={{array
          (menuItem 'Edit Field Settings' @toggleSettings)
          (menuDivider)
          (menuItem 'Remove Field' @toggleRemoveModal dangerous=true)
        }}
        @closeMenu={{dd.close}}
      />
    </:content>
  </BoxelDropdown>

  <style scoped>
    :global(.context-menu) {
      width: 13.5rem;
    }

    .context-menu-trigger {
      margin-left: 2px;
    }
    .context-menu-trigger:hover {
      background-color: var(--boxel-highlight);
    }
    .context-menu-trigger[aria-expanded='true'] {
      background-color: var(--boxel-highlight-hover);
    }

    .context-menu-list {
      --boxel-menu-item-content-padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      border-top-right-radius: 0;
      border-top-left-radius: 0;
    }

    .warning-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--boxel-sp-xxxs);
      padding: var(--boxel-sp-sm);
      background-color: var(--boxel-warning-100);
      border-top-right-radius: inherit;
      border-top-left-radius: inherit;
    }

    .warning {
      margin: 0;
    }

    .warning-icon {
      flex-shrink: 0;
    }
  </style>
</template>;

export default ContextMenuButton;
