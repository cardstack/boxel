import Component from '@glimmer/component';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { Download } from '@cardstack/boxel-ui/icons';

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
    <button
      class={{cn
        'add-card-to-neighbor-stack'
        this.triggerSideClass
        add-card-to-neighbor-stack--active=(eq @activeTrigger @triggerSide)
      }}
      {{on 'click' (fn @onTrigger @triggerSide)}}
      ...attributes
    >
      <Download width='19' height='19' />
    </button>
    <style scoped>
      .add-card-to-neighbor-stack {
        --icon-color: var(--boxel-highlight-hover);
        width: var(--container-button-size);
        height: var(--container-button-size);
        padding: 0;
        border-radius: 50%;
        background-color: var(--boxel-700);
        border: var(--boxel-border-flexible);
        box-shadow: var(--boxel-deep-box-shadow);
        z-index: var(--boxel-layer-floating-button);
      }
      .add-card-to-neighbor-stack:hover,
      .add-card-to-neighbor-stack--active {
        --icon-color: var(--boxel-highlight);
      }
      .add-card-to-neighbor-stack--left {
        margin-left: var(--operator-mode-spacing);
      }
      .add-card-to-neighbor-stack--right {
        margin-right: var(--operator-mode-spacing);
      }
    </style>
  </template>
}
