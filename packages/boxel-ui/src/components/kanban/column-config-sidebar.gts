import XIcon from '@cardstack/boxel-icons/x';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import FieldContainer from '../field-container/index.gts';
import IconButton from '../icon-button/index.gts';
import Switch from '../switch/index.gts';
import ColumnConfigRow from './column-config-sidebar-row.gts';
import type { KanbanColumnConfig } from './engine.ts';

interface Signature {
  Args: {
    cardCounts?: Record<string, number>;
    columns: KanbanColumnConfig[] | null;
    hideEmpty?: boolean;
    onClose?: () => void;
    onColorChange?: (column: KanbanColumnConfig | null, val: string) => void;
    onHideEmptyChange?: () => void;
    onLabelChange?: (column: KanbanColumnConfig | null, val: string) => void;
    onReorder?: (columns: KanbanColumnConfig[]) => void;
    onToggleCollapsed?: (column: KanbanColumnConfig | null) => void;
    onWipLimitChange?: (column: KanbanColumnConfig | null, val: string) => void;
  };
  Element: HTMLElement;
}

export class KanbanColumnConfigSidebar extends Component<Signature> {
  buildReordered = (
    fromIndex: number,
    toIndex: number,
  ): KanbanColumnConfig[] => {
    let cols = [...(this.args.columns ?? [])];
    let [column] = cols.splice(fromIndex, 1);
    if (!column) return cols;
    cols.splice(toIndex, 0, column);
    return cols.map((col, i) => ({ ...col, sortOrder: i + 1 }));
  };

  reorder = (index: number, direction: 'up' | 'down'): void => {
    let cols = this.args.columns;
    if (!cols) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index >= cols.length - 1) return;
    let toIndex = direction === 'up' ? index - 1 : index + 1;
    this.args.onReorder?.(this.buildReordered(index, toIndex));
  };

  isFirst = (index: number): boolean => {
    return index === 0;
  };

  isLast = (index: number): boolean => {
    if (!this.args.columns) {
      return false;
    }
    return index >= this.args.columns.length - 1;
  };

  get columnRows(): Array<{
    column: KanbanColumnConfig;
    disableToggle: boolean;
  }> {
    return (this.args.columns ?? []).map((column) => ({
      column,
      disableToggle:
        !!this.args.hideEmpty &&
        (this.args.cardCounts?.[column.key] ?? 1) === 0,
    }));
  }

  <template>
    <aside class='col-config-sidebar' ...attributes>
      <header class='sidebar-header'>
        <h2 class='sidebar-title'>Configure Columns</h2>
        {{#if @onClose}}
          <IconButton
            class='sidebar-close'
            @icon={{XIcon}}
            @size='extra-small'
            aria-label='Close column settings'
            {{on 'click' @onClose}}
          />
        {{/if}}
      </header>

      {{#if @onHideEmptyChange}}
        <FieldContainer
          @tag='label'
          @label='Hide empty columns'
          class='hide-empty-row'
        >
          <Switch
            @label='Hide empty columns'
            @isEnabled={{if @hideEmpty true false}}
            @onChange={{@onHideEmptyChange}}
            data-test-sidebar-hide-empty-switch
          />
        </FieldContainer>
      {{/if}}

      {{#if this.columnRows.length}}
        <ul class='col-list'>
          {{#each this.columnRows key='column.key' as |row i|}}
            <ColumnConfigRow
              @rowId={{if row.column.key row.column.key i}}
              @column={{row.column}}
              @isFirst={{this.isFirst i}}
              @isLast={{this.isLast i}}
              @disableToggle={{row.disableToggle}}
              @onReorder={{fn this.reorder i}}
              @onToggleCollapsed={{if
                @onToggleCollapsed
                (fn @onToggleCollapsed row.column)
              }}
              @onLabelChange={{if
                @onLabelChange
                (fn @onLabelChange row.column)
              }}
              @onColorChange={{if
                @onColorChange
                (fn @onColorChange row.column)
              }}
              @onWipLimitChange={{if
                @onWipLimitChange
                (fn @onWipLimitChange row.column)
              }}
            />
          {{/each}}
        </ul>
      {{else}}
        <p class='empty-sidebar'><em>No columns available.</em></p>
      {{/if}}
    </aside>

    <style scoped>
      .col-config-sidebar {
        --boxel-col-config-sidebar-border: var(
          --border,
          var(--boxel-border-color)
        );
        --boxel-col-config-sidebar-width: 19rem;
        --boxel-col-config-sidebar-height: 100%;
        display: flex;
        flex-direction: column;
        width: var(--boxel-col-config-sidebar-width);
        height: var(--boxel-col-config-sidebar-height);
        flex-shrink: 0;
        border: 1px solid var(--boxel-col-config-sidebar-border);
        background: var(--sidebar, var(--boxel-light));
        color: var(--sidebar-foreground, var(--boxel-dark));
        overflow-y: auto;
      }
      .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1rem 0.625rem;
        border-bottom: 1px solid var(--boxel-col-config-sidebar-border);
        flex-shrink: 0;
      }
      .sidebar-title {
        font-size: 0.875rem;
      }
      .hide-empty-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.625rem 1rem;
        border-bottom: 1px solid var(--boxel-col-config-sidebar-border);
        font-size: 0.875rem;
        cursor: pointer;
      }
      .hide-empty-row :deep(.label-container) {
        padding-top: unset;
      }
      .col-list {
        list-style: none;
        margin: 0;
        padding: 0.25rem 0;
      }
      .empty-sidebar {
        padding: 0.5rem 0.75rem;
        opacity: 0.7;
      }
    </style>
  </template>
}
