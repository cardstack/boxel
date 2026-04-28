import { cn, cssVar } from '@cardstack/boxel-ui/helpers';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';

import ContextButton from '../context-button/index.gts';
import type { KanbanColumnConfig } from './engine.ts';

interface Signature {
  Args: {
    cardCount: number;
    column: KanbanColumnConfig;
    isOverWip: boolean;
    isTarget: boolean;
    onAddCard?: () => void;
  };
  Element: HTMLDivElement;
}

const KanbanColumnHeader: TemplateOnlyComponent<Signature> = <template>
  <div class={{cn 'col-header' is-target=@isTarget}} ...attributes>
    <div class='col-header-left'>
      <span class='col-dot' style={{cssVar col-dot-bg=@column.color}}></span>
      <span class='col-name'>{{if
          @column.label
          @column.label
          'Untitled'
        }}</span>
      <span class='col-count'>{{@cardCount}}</span>
    </div>
    <div class='col-header-right'>
      {{#if @column.wipLimit}}
        <span class={{cn 'col-wip' over=@isOverWip}}>
          Max
          {{@column.wipLimit}}
        </span>
      {{/if}}
      {{#if @onAddCard}}
        <ContextButton
          class='col-add-btn'
          @label={{if
            @column.label
            (concat 'Add card to ' @column.label)
            'Add card to column'
          }}
          @icon='add'
          @variant='ghost'
          {{on 'click' @onAddCard}}
        />
      {{/if}}
    </div>
  </div>

  <style scoped>
    .col-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 0.875rem 0.5rem;
      flex-shrink: 0;
    }
    .col-header.is-target {
      background-color: var(--_kanban-primary);
      color: var(--_kanban-primary-foreground);
      border-radius: var(--_kanban-radius) var(--_kanban-radius) 0 0;
    }
    .col-header-left {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .col-dot {
      width: 0.625rem;
      height: 0.625rem;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--col-dot-bg, var(--muted-foreground, var(--boxel-450)));
      box-shadow: 0 0 0 1.5px
        color-mix(in oklch, var(--col-dot-bg) 30%, transparent);
    }
    .col-name {
      font-size: 0.8125rem;
      font-weight: 600;
    }
    .col-count {
      font-size: 0.75rem;
      font-weight: 500;
      opacity: var(--_kanban-muted-opacity);
    }
    .col-header-right {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .col-wip {
      font-size: 0.625rem;
      font-family: var(--font-mono, var(--boxel-monospace-font-family));
      opacity: var(--_kanban-muted-opacity);
    }
    .col-wip.over {
      color: var(--destructive, var(--boxel-danger));
      font-weight: 700;
      opacity: 1;
    }
    .col-add-btn {
      opacity: var(--_kanban-muted-opacity);
    }
    .col-add-btn:hover {
      opacity: 1;
    }
  </style>
</template>;

export { KanbanColumnHeader };
