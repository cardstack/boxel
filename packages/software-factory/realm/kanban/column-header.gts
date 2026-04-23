import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { ContextButton } from '@cardstack/boxel-ui/components';
import { cn, cssVar } from '@cardstack/boxel-ui/helpers';
import type { KanbanColumnField } from './column';

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
  <div class={{cn 'col-header' is-target=@isTarget}} ...attributes>
    <div class='col-header-left'>
      <span
        class='col-dot'
        style={{cssVar
          col-dot-bg=(if
            @column.color @column.color 'var(--muted, var(--boxel-100))'
          )
        }}
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
        <span class={{cn 'col-wip' over=@isOverWip}}>
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
      background: color-mix(
        in oklch,
        var(--accent, var(--boxel-highlight)) 8%,
        transparent
      );
      color: var(--accent-foreground, var(--boxel-dark));
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
      background: var(--col-dot-bg);
    }
    .col-name {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .col-count {
      font-size: 12px;
      font-weight: 500;
      color: var(--muted-foreground, var(--boxel-450));
    }
    .col-header-right {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .col-wip {
      font-size: 10px;
      color: var(--muted-foreground);
      font-family: var(--font-mono, var(--boxel-monospace-font-family));
    }
    .col-wip.over {
      color: var(--destructive, var(--boxel-red));
      font-weight: 600;
    }
    .col-add-btn {
      color: var(--muted-foreground, var(--boxel-450));
      opacity: 0.6;
    }
    .col-add-btn:hover {
      opacity: 1;
      color: var(--foreground, var(--boxel-dark));
    }
  </style>
</template>;

export { KanbanColumnHeader };
