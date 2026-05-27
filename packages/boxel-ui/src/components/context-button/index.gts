import DotsVertical from '@cardstack/boxel-icons/dots-vertical';
import Plus from '@cardstack/boxel-icons/plus';
import Trash from '@cardstack/boxel-icons/trash-2';
import XIcon from '@cardstack/boxel-icons/x';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat } from '@ember/helper';

import cn from '../../helpers/cn.ts';
import { IconPencil, ThreeDotsHorizontal } from '../../icons.ts';
import type { Icon } from '../../icons/types.ts';
import type { BoxelButtonSize } from '../button/index.gts';
import IconButton from '../icon-button/index.gts';

export type ContextButtonVariant =
  | 'highlight'
  | 'ghost'
  | 'destructive'
  | 'highlight-icon'
  | 'destructive-icon'
  | 'primary-dark'; // 'highlight' is default

export const contextButtonVariants: ContextButtonVariant[] = [
  'highlight',
  'highlight-icon',
  'ghost',
  'destructive',
  'destructive-icon',
  'primary-dark',
];

export type ContextButtonIcon =
  | 'context-menu'
  | 'context-menu-vertical'
  | 'add'
  | 'edit'
  | 'delete'
  | 'close'
  | Icon; // 'context-menu' is default

export const contextButtonIconOptions: ContextButtonIcon[] = [
  'context-menu',
  'context-menu-vertical',
  'add',
  'edit',
  'delete',
  'close',
];

interface Signature {
  Args: {
    disabled?: boolean;
    height?: string; // iconHeight
    icon?: ContextButtonIcon; // defaults to horizontal 'content-menu'
    isActive?: boolean;
    isToggle?: boolean;
    label: string; // aria-label for icon button (required)
    loading?: boolean;
    size?: BoxelButtonSize;
    variant?: ContextButtonVariant;
    width?: string; // iconWidth
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

const getIcon = (icon: ContextButtonIcon = 'context-menu') => {
  if (icon === 'context-menu') {
    return ThreeDotsHorizontal;
  }
  if (icon === 'context-menu-vertical') {
    return DotsVertical;
  }
  if (icon === 'close') {
    return XIcon;
  }
  if (icon === 'add') {
    return Plus;
  }
  if (icon === 'edit') {
    return IconPencil;
  }
  if (icon === 'delete') {
    return Trash;
  }
  return icon;
};

function getVariant(variant: ContextButtonVariant = 'highlight') {
  if (contextButtonVariants.includes(variant)) {
    return variant;
  }
  return 'highlight';
}

const DropdownButton: TemplateOnlyComponent<Signature> = <template>
  {{#let (getVariant @variant) (getIcon @icon) as |variant icon|}}
    <IconButton
      class={{cn
        "boxel-context-button"
        (concat "boxel-context-button--" variant)
        boxel-context-button--active=@isActive
      }}
      @icon={{icon}}
      @size={{if @size @size "base"}}
      @loading={{@loading}}
      @disabled={{@disabled}}
      @width={{@width}}
      @height={{@height}}
      aria-label={{@label}}
      aria-pressed={{if @isToggle (if @isActive "true" "false")}}
      data-active={{if @isActive "true" "false"}}
      ...attributes
    />
  {{/let}}
  <style scoped>
    @layer boxelComponentL2 {
      .boxel-context-button {
        color: inherit;
        background-color: transparent;
        transition: none;
      }
      .boxel-context-button--highlight-icon {
        color: var(--primary, var(--boxel-highlight));
      }
      .boxel-context-button--highlight:hover,
      .boxel-context-button--highlight.boxel-context-button--active,
      .boxel-context-button--highlight-icon:hover {
        color: var(--primary-foreground, var(--boxel-dark));
        background-color: var(--primary, var(--boxel-highlight));
      }
      .boxel-context-button--highlight-icon.boxel-context-button--active {
        color: var(--primary-foreground, var(--boxel-dark));
        background-color: var(--primary, var(--boxel-highlight));
      }
      .boxel-context-button--highlight[aria-expanded="true"],
      .boxel-context-button--highlight-icon[aria-expanded="true"] {
        color: var(--primary-foreground, var(--boxel-dark));
        background-color: color-mix(
          in oklab,
          var(--primary, var(--boxel-highlight)),
          var(--primary-foreground, var(--boxel-dark)) 15%
        );
      }

      .boxel-context-button--ghost:hover {
        background-color: color-mix(in oklab, currentColor 10%, transparent);
      }
      .boxel-context-button--ghost.boxel-context-button--active {
        background-color: color-mix(in oklab, currentColor 10%, transparent);
      }
      .boxel-context-button--ghost[aria-expanded="true"] {
        background-color: color-mix(in oklab, currentColor 25%, transparent);
      }

      .boxel-context-button--destructive-icon {
        color: var(--destructive, var(--boxel-danger));
      }
      .boxel-context-button--destructive:hover,
      .boxel-context-button--destructive.boxel-context-button--active,
      .boxel-context-button--destructive-icon:hover {
        color: var(--destructive-foreground, var(--boxel-light-100));
        background-color: var(--destructive, var(--boxel-danger));
      }
      .boxel-context-button--destructive-icon.boxel-context-button--active {
        color: var(--destructive-foreground, var(--boxel-light-100));
        background-color: var(--destructive, var(--boxel-danger));
      }

      .boxel-context-button--primary-dark {
        color: var(--primary, var(--boxel-highlight));
        background-color: var(--primary-foreground, var(--boxel-700));
        border: 1px solid var(--boxel-light-hover-35);
      }

      .boxel-context-button:disabled,
      .boxel-context-button[disabled] {
        color: var(--boxel-400);
        pointer-events: none;
        cursor: initial;
      }
    }
  </style>
</template>;

export default DropdownButton;
