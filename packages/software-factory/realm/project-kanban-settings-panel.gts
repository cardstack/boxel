import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

type Column = {
  key?: string | null;
  label?: string | null;
  color?: string | null;
  wipLimit?: number | null;
  collapsed?: boolean | null;
};
type ColumnEventHandler = (
  key: string | null | undefined,
  event: Event,
) => void;

interface Signature {
  Args: {
    columns: Column[];
    onColorChange: ColumnEventHandler;
    onWipChange: ColumnEventHandler;
    onCollapseChange: ColumnEventHandler;
    onMoveColUp: ColumnEventHandler;
    onMoveColDown: ColumnEventHandler;
  };
}

const ProjectKanbanSettingsPanel: TemplateOnlyComponent<Signature> = <template>
  <aside class='settings-panel'>
    <div class='settings-header'>Column Settings</div>
    {{#each @columns as |col|}}
      <div class='settings-row'>
        <div class='settings-top'>
          <span class='settings-name'>{{col.label}}</span>
          <div class='settings-order'>
            <button
              type='button'
              class='order-btn'
              {{on 'click' (fn @onMoveColUp col.key)}}
            >↑</button>
            <button
              type='button'
              class='order-btn'
              {{on 'click' (fn @onMoveColDown col.key)}}
            >↓</button>
          </div>
        </div>
        <div class='settings-controls'>
          <label class='settings-field'>
            <span class='field-label'>Color</span>
            <input
              type='color'
              class='color-input'
              value={{col.color}}
              {{on 'change' (fn @onColorChange col.key)}}
            />
          </label>
          <label class='settings-field'>
            <span class='field-label'>WIP</span>
            <input
              type='number'
              class='wip-input'
              value={{col.wipLimit}}
              min='0'
              placeholder='∞'
              {{on 'change' (fn @onWipChange col.key)}}
            />
          </label>
          <label class='settings-field'>
            <input
              type='checkbox'
              checked={{col.collapsed}}
              {{on 'change' (fn @onCollapseChange col.key)}}
            />
            <span class='field-label'>Collapse</span>
          </label>
        </div>
      </div>
    {{/each}}
  </aside>

  <style scoped>
    .settings-panel {
      width: 15rem;
      flex-shrink: 0;
      background: var(--kanban-card-bg);
      border-left: 1px solid var(--kanban-border-color);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    .settings-header {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--kanban-border-color);
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--kanban-muted-foreground);
      flex-shrink: 0;
    }
    .settings-row {
      padding: 0.625rem 0.75rem;
      border-bottom: 1px solid var(--kanban-border-color);
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }
    .settings-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .settings-name {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--kanban-foreground);
    }
    .settings-order {
      display: flex;
      gap: 0.125rem;
    }
    .order-btn {
      padding: 0.0625rem 0.3125rem;
      font-size: 0.6875rem;
      line-height: 1.4;
      background: var(--kanban-muted-bg);
      border: 1px solid var(--kanban-border-color);
      border-radius: 0.1875rem;
      cursor: pointer;
      color: var(--kanban-foreground);
    }
    .order-btn:hover {
      background: var(--kanban-border-color);
    }
    .settings-controls {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      flex-wrap: wrap;
    }
    .settings-field {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      cursor: pointer;
    }
    .field-label {
      font-size: 0.6875rem;
      color: var(--kanban-muted-foreground);
    }
    .color-input {
      width: 1.5rem;
      height: 1.125rem;
      padding: 0;
      border: 1px solid var(--kanban-border-color);
      border-radius: 0.1875rem;
      cursor: pointer;
    }
    .wip-input {
      width: 2.75rem;
      padding: 0.125rem 0.25rem;
      font-size: 0.6875rem;
      border: 1px solid var(--kanban-border-color);
      border-radius: 0.1875rem;
      background: var(--kanban-muted-bg);
      color: var(--kanban-foreground);
    }
  </style>
</template>;

export { ProjectKanbanSettingsPanel };
