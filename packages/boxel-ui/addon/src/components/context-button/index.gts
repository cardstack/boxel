import DotsVertical from '@cardstack/boxel-icons/dots-vertical';
import Plus from '@cardstack/boxel-icons/plus';
import Trash from '@cardstack/boxel-icons/trash-2';
import XIcon from '@cardstack/boxel-icons/x';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { IconPencil, ThreeDotsHorizontal } from '../../icons.gts';
import type { Icon } from '../../icons/types.ts';
import type { BoxelButtonSize } from '../button/index.gts';
import IconButton from '../icon-button/index.gts';

export type ContextButtonVariant =
  | 'highlight'
  | 'ghost'
  | 'destructive'
  | 'highlight-icon'
  | 'destructive-icon'; // 'highlight' is default

export const contextButtonVariants: ContextButtonVariant[] = [
  'highlight',
  'highlight-icon',
  'ghost',
  'destructive',
  'destructive-icon',
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
      class='boxel-context-button boxel-context-button--{{variant}}'
      @icon={{icon}}
      @size={{if @size @size 'base'}}
      @loading={{@loading}}
      @disabled={{@disabled}}
      @width={{@width}}
      @height={{@height}}
      aria-label={{@label}}
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
      .boxel-context-button--highlight-icon:hover {
        color: var(--primary-foreground, var(--boxel-dark));
        background-color: var(--primary, var(--boxel-highlight));
      }
      .boxel-context-button--highlight[aria-expanded='true'],
      .boxel-context-button--highlight-icon[aria-expanded='true'] {
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
      .boxel-context-button--ghost[aria-expanded='true'] {
        background-color: color-mix(in oklab, currentColor 25%, transparent);
      }

      .boxel-context-button--destructive-icon {
        color: var(--destructive, var(--boxel-danger));
      }
      .boxel-context-button--destructive:hover,
      .boxel-context-button--destructive-icon:hover {
        color: var(--destructive-foreground, var(--boxel-light-100));
        background-color: var(--destructive, var(--boxel-danger));
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
