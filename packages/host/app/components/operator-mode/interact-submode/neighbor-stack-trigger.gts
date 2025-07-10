import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';

const SearchSheetTriggers = {
  DropCardToLeftNeighborStackButton: 'drop-card-to-left-neighbor-stack-button',
  DropCardToRightNeighborStackButton:
    'drop-card-to-right-neighbor-stack-button',
} as const;
type Values<T> = T[keyof T];
type SearchSheetTrigger = Values<typeof SearchSheetTriggers>;

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    triggerSide: SearchSheetTrigger;
    activeTrigger: SearchSheetTrigger | null;
    onTrigger: (triggerSide: SearchSheetTrigger) => void;
  };
}

export default class NeighborStackTriggerButton extends Component<Signature> {
  get triggerSideClass() {
    switch (this.args.triggerSide) {
      case SearchSheetTriggers.DropCardToLeftNeighborStackButton:
        return 'add-card-to-neighbor-stack--left';
      case SearchSheetTriggers.DropCardToRightNeighborStackButton:
        return 'add-card-to-neighbor-stack--right';
      default:
        return undefined;
    }
  }

  <template>
    <Button
      class={{cn
        'add-card-to-neighbor-stack'
        this.triggerSideClass
        add-card-to-neighbor-stack--active=(eq @activeTrigger @triggerSide)
      }}
      {{on 'click' (fn @onTrigger @triggerSide)}}
      ...attributes
    >
      <span class='icon-container'>
        <IconPlus class='add-icon' width='12' height='12' />
      </span>
    </Button>
    <style scoped>
      .add-card-to-neighbor-stack {
        --boxel-transition: 100ms ease;
        --boxel-button-min-width: auto;
        --boxel-button-min-height: auto;
        height: 35px;
        width: 20px;
        background: none;
        border: none;
        padding: 0;
        z-index: var(--boxel-layer-floating-button);
      }
      .icon-container {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 8px;
        height: 20px;
        border-radius: inherit;
        background-color: var(--boxel-highlight);
        border: 2px solid rgba(0 0 0 / 50%);
        box-shadow: var(--boxel-deep-box-shadow);
        transition:
          height var(--boxel-transition),
          width var(--boxel-transition);
      }
      .add-card-to-neighbor-stack:hover,
      .add-card-to-neighbor-stack:focus:focus-visible,
      .add-card-to-neighbor-stack--active {
        padding: 0;
        height: 66px;
        outline-offset: 2px;
      }
      .add-icon {
        visibility: collapse;
        transition: visibility var(--boxel-transition);
      }
      .add-card-to-neighbor-stack:hover .icon-container,
      .add-card-to-neighbor-stack:focus:focus-visible .icon-container,
      .add-card-to-neighbor-stack--active .icon-container {
        width: 20px;
        height: 66px;
      }
      .add-card-to-neighbor-stack:hover .add-icon,
      .add-card-to-neighbor-stack:focus:focus-visible .add-icon,
      .add-card-to-neighbor-stack--active .add-icon {
        visibility: visible;
      }
      .add-card-to-neighbor-stack--left {
        margin-left: calc(var(--operator-mode-spacing) / 2);
      }
      .add-card-to-neighbor-stack--right {
        margin-right: calc(var(--operator-mode-spacing) / 2);
      }
    </style>
  </template>
}
