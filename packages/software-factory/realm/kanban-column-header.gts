import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { ContextButton } from '@cardstack/boxel-ui/components';
import type { KanbanColumnField } from './kanban-column';

interface Signature {
  Args: {
    column: KanbanColumnField;
    cardCount: number;
    isOverWip: boolean;
    isTarget: boolean;
    onAddCard?: () => void;
  };
  Element: HTMLDivElement;
}

const KanbanColumnHeader: TemplateOnlyComponent<Signature> = <template>
  <div class='col-header {{if @isTarget "is-target"}}' ...attributes>
    <div class='col-header-left'>
      <span
        class='col-dot'
        style='background: {{if @column.color @column.color "#94a3b8"}}'
      ></span>
      <span class='col-name'>{{if
          @column.label
          @column.label
          'Untitled'
        }}</span>
      <span class='col-count'>{{@cardCount}}</span>
    </div>
    <div class='col-header-right'>
      {{#if @column.wipLimit}}
        <span class='col-wip {{if @isOverWip "over"}}'>
          max
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
      padding: 12px 14px 8px;
      flex-shrink: 0;
    }
    .col-header.is-target {
      background: rgba(16, 185, 129, 0.06);
      border-radius: 8px 8px 0 0;
    }
    .col-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .col-dot {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .col-name {
      font-size: 13px;
      font-weight: 600;
      color: #1e293b;
      letter-spacing: -0.01em;
    }
    .col-count {
      font-size: 12px;
      font-weight: 500;
      color: #94a3b8;
    }
    .col-header-right {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .col-wip {
      font-size: 10px;
      color: #94a3b8;
      font-family: var(--font-mono, monospace);
    }
    .col-wip.over {
      color: #d97706;
      font-weight: 600;
    }
    .col-add-btn {
      color: #94a3b8;
      opacity: 0.6;
    }
    .col-add-btn:hover {
      opacity: 1;
      color: #1e293b;
    }
  </style>
</template>;

export { KanbanColumnHeader };
