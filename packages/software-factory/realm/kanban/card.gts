import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { SafeString } from '@ember/template';
import { cn } from '@cardstack/boxel-ui/helpers';
import type { KanbanPlacement } from './engine';

interface Signature {
  Args: {
    placement: KanbanPlacement;
    isSelected: boolean;
    isSource: boolean;
    shiftStyle: SafeString;
    isDragging: boolean;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

const KanbanCard: TemplateOnlyComponent<Signature> = <template>
  <div
    class={{cn
      'card'
      selected=@isSelected
      dragging=@isSource
      board-dragging=@isDragging
    }}
    style={{@shiftStyle}}
    data-card-index={{@placement.index}}
    ...attributes
  >
    {{yield}}
  </div>

  <style scoped>
    .card {
      flex-shrink: 0;
      height: 170px;
      border-radius: 8px;
      overflow: hidden;
      background: #fff;
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.06),
        0 0 0 1px rgba(0, 0, 0, 0.04);
      cursor: grab;
      transition: box-shadow 120ms ease-out;
    }
    .card.board-dragging {
      transition:
        transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1),
        box-shadow 120ms ease-out;
    }
    .card:hover {
      box-shadow:
        0 2px 8px rgba(0, 0, 0, 0.08),
        0 0 0 1px rgba(0, 0, 0, 0.06);
    }
    .card.selected {
      box-shadow:
        0 0 0 2px var(--primary, #3b82f6),
        0 1px 2px rgba(0, 0, 0, 0.06);
    }
    .card.dragging {
      opacity: 0;
      height: 0;
      min-height: 0;
      overflow: hidden;
      margin: -3px 0;
    }
  </style>
</template>;

export { KanbanCard };
