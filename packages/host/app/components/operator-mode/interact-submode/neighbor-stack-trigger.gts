import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { Button, Tooltip } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';

export const SearchSheetTriggers = {
  DropCardToLeftNeighborStackButton: 'left',
  DropCardToRightNeighborStackButton: 'right',
} as const;
type Values<T> = T[keyof T];
export type SearchSheetTrigger = Values<typeof SearchSheetTriggers>;

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    triggerSide: SearchSheetTrigger;
    activeTrigger: SearchSheetTrigger | null;
    onTrigger: (triggerSide: SearchSheetTrigger) => void;
  };
}

export default class NeighborStackTriggerButton extends Component<Signature> {
  private get tooltipPlacement() {
    return this.args.triggerSide ===
      SearchSheetTriggers.DropCardToRightNeighborStackButton
      ? SearchSheetTriggers.DropCardToLeftNeighborStackButton
      : SearchSheetTriggers.DropCardToRightNeighborStackButton;
  }
  <template>
    <Tooltip @placement={{this.tooltipPlacement}} ...attributes>
      <:trigger>
        <Button
          class={{cn
            'add-card-to-neighbor-stack'
            add-card-to-neighbor-stack--active=(eq @activeTrigger @triggerSide)
          }}
          {{on 'click' (fn @onTrigger @triggerSide)}}
          aria-label='Add card to {{@triggerSide}} stack'
          data-test-add-card-right-stack={{eq
            @triggerSide
            SearchSheetTriggers.DropCardToRightNeighborStackButton
          }}
          data-test-add-card-left-stack={{eq
            @triggerSide
            SearchSheetTriggers.DropCardToLeftNeighborStackButton
          }}
        >
          <span class='icon-container'>
            <IconPlus class='add-icon' width='12' height='12' />
          </span>
        </Button>
      </:trigger>
      <:content>
        Open a card to the
        {{@triggerSide}}
        of the current card
      </:content>
    </Tooltip>
    <style scoped>
      .add-card-to-neighbor-stack {
        --minimized-width: 8px;
        --minimized-height: 20px;
        --expanded-width: 20px;
        --expanded-height: 66px;
        --boxel-transition: 100ms ease;
        --boxel-button-min-width: auto;
        --boxel-button-min-height: auto;
        height: calc(var(--expanded-height) / 2);
        width: var(--expanded-width);
        background: none;
        border: none;
        padding: 0;
        z-index: var(--boxel-layer-floating-button);
      }
      .add-card-to-neighbor-stack:hover,
      .add-card-to-neighbor-stack:focus:focus-visible,
      .add-card-to-neighbor-stack--active {
        padding: 0;
        height: var(--expanded-height);
        outline-offset: 2px;
      }
      .icon-container {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--minimized-width);
        height: var(--minimized-height);
        border-radius: inherit;
        background-color: var(--boxel-highlight);
        border: 2px solid rgba(0 0 0 / 50%);
        box-shadow: var(--boxel-deep-box-shadow);
        transition:
          height var(--boxel-transition),
          width var(--boxel-transition);
      }
      .add-card-to-neighbor-stack:hover .icon-container,
      .add-card-to-neighbor-stack:focus:focus-visible .icon-container,
      .add-card-to-neighbor-stack--active .icon-container {
        width: var(--expanded-width);
        height: var(--expanded-height);
      }
      .add-icon {
        visibility: collapse;
        transition: visibility var(--boxel-transition);
      }
      .add-card-to-neighbor-stack:hover .add-icon,
      .add-card-to-neighbor-stack:focus:focus-visible .add-icon,
      .add-card-to-neighbor-stack--active .add-icon {
        visibility: visible;
      }
    </style>
  </template>
}
