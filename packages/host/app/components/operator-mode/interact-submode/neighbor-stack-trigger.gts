import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

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
    isDragActive?: boolean;
    onDrop?: (triggerSide: SearchSheetTrigger, cardId: string) => void;
  };
}

export default class NeighborStackTriggerButton extends Component<Signature> {
  @tracked isDragOver = false;

  private get tooltipPlacement() {
    return this.args.triggerSide ===
      SearchSheetTriggers.DropCardToRightNeighborStackButton
      ? SearchSheetTriggers.DropCardToLeftNeighborStackButton
      : SearchSheetTriggers.DropCardToRightNeighborStackButton;
  }

  @action handleDragOver(event: DragEvent) {
    if (event.dataTransfer?.types.includes('application/boxel-card-id')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      this.isDragOver = true;
    }
  }

  @action handleDragLeave(event: DragEvent) {
    let button = event.currentTarget as HTMLElement;
    let relatedTarget = event.relatedTarget as Node | null;
    if (!relatedTarget || !button.contains(relatedTarget)) {
      this.isDragOver = false;
    }
  }

  @action handleDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
    let cardId = event.dataTransfer?.getData('application/boxel-card-id');
    if (cardId) {
      this.args.onDrop?.(this.args.triggerSide, cardId);
    }
  }

  <template>
    <Tooltip @placement={{this.tooltipPlacement}} ...attributes>
      <:trigger>
        <Button
          class={{cn
            'add-card-to-neighbor-stack'
            add-card-to-neighbor-stack--active=(eq @activeTrigger @triggerSide)
            add-card-to-neighbor-stack--drag-active=@isDragActive
            add-card-to-neighbor-stack--drag-over=this.isDragOver
          }}
          {{on 'click' (fn @onTrigger @triggerSide)}}
          {{on 'dragover' this.handleDragOver}}
          {{on 'dragleave' this.handleDragLeave}}
          {{on 'drop' this.handleDrop}}
          aria-label='Add card to {{@triggerSide}} stack'
          data-test-add-card-right-stack={{eq
            @triggerSide
            SearchSheetTriggers.DropCardToRightNeighborStackButton
          }}
          data-test-add-card-left-stack={{eq
            @triggerSide
            SearchSheetTriggers.DropCardToLeftNeighborStackButton
          }}
          data-test-neighbor-stack-trigger
        >
          <span class='icon-container'>
            <IconPlus class='add-icon' width='10' height='10' />
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
        --expanded-width: 16px;
        --expanded-height: 66px;
        --drag-target-width: 48px;
        --drag-target-height: 200px;
        --boxel-transition: 100ms ease;
        --boxel-button-min-width: var(--expanded-width);
        --boxel-button-min-height: var(--minimized-height);
        height: calc(var(--expanded-height) / 2);
        width: var(--expanded-width);
        background: none;
        border: none;
        padding: 0;
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

      /* Drag target: bigger hit area for easy dropping */
      .add-card-to-neighbor-stack--drag-active {
        padding: 0;
        height: var(--drag-target-height);
        width: var(--drag-target-width);
        --boxel-button-min-width: var(--drag-target-width);
      }
      .add-card-to-neighbor-stack--drag-active .icon-container {
        width: var(--expanded-width);
        height: var(--expanded-height);
        pointer-events: none;
      }
      .add-card-to-neighbor-stack--drag-active .add-icon {
        visibility: visible;
        pointer-events: none;
      }

      /* Drag over: visual feedback when hovering over drop target */
      .add-card-to-neighbor-stack--drag-over .icon-container {
        background-color: var(--boxel-highlight);
        box-shadow: 0 0 20px 8px var(--boxel-highlight);
        border-color: var(--boxel-light);
        transform: scale(1.3);
        transition:
          transform var(--boxel-transition),
          box-shadow var(--boxel-transition);
      }
    </style>
  </template>
}
