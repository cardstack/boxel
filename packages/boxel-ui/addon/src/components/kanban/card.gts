import { cn } from '@cardstack/boxel-ui/helpers';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { SafeString } from '@ember/template';

import type { FittedFormatId } from '../../helpers.ts';
import FittedCardContainer from '../fitted-card-container/index.gts';
import type { KanbanPlacement } from './engine.ts';

interface Signature {
  Args: {
    isDragging: boolean;
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
    data-card-index={{@placement.index}}
    ...attributes
  >
    {{yield}}
  </FittedCardContainer>

  <style scoped>
    .card {
      flex-shrink: 0;
      border-radius: var(--boxel-border-radius);
      overflow: hidden;
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
        0 0 0 2px var(--ring, var(--boxel-highlight)),
        0 1px 2px rgba(0, 0, 0, 0.06);
    }
    .card.dragging {
      opacity: 0;
      height: 0;
      min-height: 0;
      overflow: hidden;
      margin: -0.1875rem 0;
    }
  </style>
</template>;

export { KanbanCard };
