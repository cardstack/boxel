import { cn } from '@cardstack/boxel-ui/helpers';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { SafeString } from '@ember/template';

import type { FittedFormatId } from '../../helpers.gts';
import FittedCardContainer from '../fitted-card-container/index.gts';
import type { KanbanPlacement } from './engine.ts';

interface Signature {
  Args: {
    isDragging: boolean;
    isRover: boolean;
    isSelected: boolean;
    isSource: boolean;
    placement: KanbanPlacement;
    shiftStyle: SafeString;
    size?: FittedFormatId;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

const KanbanCard: TemplateOnlyComponent<Signature> = <template>
  <FittedCardContainer
    class={{cn
      'card'
      selected=@isSelected
      dragging=@isSource
      board-dragging=@isDragging
    }}
    @size={{@size}}
    @style={{@shiftStyle}}
    role='listitem'
    tabindex={{if @isRover '0' '-1'}}
    data-card-index={{@placement.index}}
    ...attributes
  >
    {{yield}}
  </FittedCardContainer>

  <style scoped>
    .card {
      flex-shrink: 0;
      border-radius: var(--_kanban-radius);
      overflow: hidden;
      color: var(--_kanban-card-fg);
      background: var(--_kanban-card-bg);
      box-shadow:
        0 1px 2px color-mix(in oklab, var(--_kanban-card-fg) 6%, transparent),
        0 0 0 1px color-mix(in oklab, var(--_kanban-card-fg) 4%, transparent);
      cursor: grab;
      transition: box-shadow 120ms ease-out;
    }
    .card.board-dragging {
      transition:
        transform 240ms cubic-bezier(0.4, 0, 0.2, 1),
        height 200ms cubic-bezier(0.4, 0, 1, 1),
        margin 200ms cubic-bezier(0.4, 0, 1, 1),
        opacity 150ms ease-out,
        box-shadow 120ms ease-out;
    }
    .card:hover {
      box-shadow:
        0 2px 8px color-mix(in oklab, var(--_kanban-card-fg) 8%, transparent),
        0 0 0 1px color-mix(in oklab, var(--_kanban-card-fg) 6%, transparent);
    }
    .card.selected {
      box-shadow:
        0 0 0 2px var(--_kanban-ring),
        0 1px 2px color-mix(in oklab, var(--_kanban-card-fg) 6%, transparent);
    }
    .card.dragging {
      opacity: 0;
      height: 0 !important;
      min-height: 0 !important;
      overflow: hidden;
      margin: calc(-1 * var(--_kanban-col-gap) / 2) 0;
    }
    :deep(.boxel-card-container) {
      background: inherit;
      color: inherit;
      border-radius: inherit;
    }
  </style>
</template>;

export { KanbanCard };
