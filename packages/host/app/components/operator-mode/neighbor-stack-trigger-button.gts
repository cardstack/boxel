import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { Tooltip } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { Download } from '@cardstack/boxel-ui/icons';

import OperatorModeIconButton from '@cardstack/host/components/operator-mode/icon-button';

export const SearchSheetTriggers = {
  DropCardToLeftNeighborStackButton: 'drop-card-to-left-neighbor-stack-button',
  DropCardToRightNeighborStackButton:
    'drop-card-to-right-neighbor-stack-button',
} as const;
type Values<T> = T[keyof T];
export type SearchSheetTrigger = Values<typeof SearchSheetTriggers>;

type TriggerSide = 'left' | 'right';

const neighborStackTooltipMessage = (side: TriggerSide) => {
  return `Open a card to the ${side} of the current card`;
};

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    triggerSide: SearchSheetTrigger;
    activeTrigger: SearchSheetTrigger | null;
    onTrigger: (triggerSide: SearchSheetTrigger) => void;
  };
}

export default class NeighborStackTriggerButton extends Component<Signature> {
  <template>
    <Tooltip @placement={{this.triggerSide.tooltipPlacement}}>
      <:trigger>
        <OperatorModeIconButton
          @icon={{Download}}
          @iconWidth='19'
          @iconHeight='19'
          class={{cn
            'add-card-to-neighbor-stack'
            this.triggerSideClass
            add-card-to-neighbor-stack--active=(eq @activeTrigger @triggerSide)
          }}
          {{on 'click' (fn @onTrigger @triggerSide)}}
          @variant='primary-dark round'
          ...attributes
        />
      </:trigger>
      <:content>
        {{neighborStackTooltipMessage this.triggerSide.side}}
      </:content>
    </Tooltip>
    <style scoped>
      .add-card-to-neighbor-stack {
        box-shadow: var(--boxel-deep-box-shadow);
        z-index: var(--boxel-layer-floating-button);
      }
      .add-card-to-neighbor-stack--active {
        --icon-color: var(--boxel-highlight);
        background-color: var(--boxel-dark);
      }
      .add-card-to-neighbor-stack--left {
        margin-left: var(--operator-mode-spacing);
      }
      .add-card-to-neighbor-stack--right {
        margin-right: var(--operator-mode-spacing);
      }
    </style>
  </template>

  private get triggerSideClass() {
    switch (this.args.triggerSide) {
      case SearchSheetTriggers.DropCardToLeftNeighborStackButton:
        return 'add-card-to-neighbor-stack--left';
      case SearchSheetTriggers.DropCardToRightNeighborStackButton:
        return 'add-card-to-neighbor-stack--right';
      default:
        return undefined;
    }
  }

  private get triggerSide(): {
    side: TriggerSide;
    tooltipPlacement: TriggerSide;
  } {
    if (
      this.args.triggerSide ===
      SearchSheetTriggers.DropCardToLeftNeighborStackButton
    ) {
      return {
        side: 'left',
        tooltipPlacement: 'right',
      };
    } else {
      return {
        side: 'right',
        tooltipPlacement: 'left',
      };
    }
  }
}
