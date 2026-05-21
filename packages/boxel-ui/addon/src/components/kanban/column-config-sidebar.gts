import XIcon from '@cardstack/boxel-icons/x';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import IconButton from '../icon-button/index.gts';
import ColumnConfigRow from './column-config-sidebar-row.gts';
import type { KanbanColumnConfig } from './engine.ts';

interface Signature {
  Args: {
    columns: KanbanColumnConfig[] | null;
    onClose?: () => void;
    onColorChange?: (column: KanbanColumnConfig | null, val: string) => void;
    onLabelChange?: (column: KanbanColumnConfig | null, val: string) => void;
    onToggleCollapsed?: (column: KanbanColumnConfig | null) => void;
    onWipLimitChange?: (column: KanbanColumnConfig | null, val: string) => void;
  };
  Element: HTMLElement;
}

export class KanbanColumnConfigSidebar extends Component<Signature> {
  private reorderColumns(fromIndex: number, toIndex: number): void {
    if (!this.args.columns) {
      return;
    }
    let [column] = this.args.columns.splice(fromIndex, 1);
    if (!column) {
      return;
    }
    this.args.columns.splice(toIndex, 0, column);
  }

  @action moveUp(index: number): void {
    if (index === 0) return;
    this.reorderColumns(index, index - 1);
  }

  @action moveDown(index: number): void {
    if (!this.args.columns || index >= this.args.columns.length - 1) {
      return;
    }
    this.reorderColumns(index, index + 1);
  }

  @action reorder(index: number, direction: 'up' | 'down'): void {
    if (direction === 'up') {
      this.moveUp(index);
    } else {
      this.moveDown(index);
    }
  }

  isFirst = (index: number): boolean => {
    return index === 0;
  };

  isLast = (index: number): boolean => {
    if (!this.args.columns) {
      return false;
    }
    return index >= this.args.columns.length - 1;
  };

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

      {{#if @columns.length}}
        <ul class='col-list'>
          {{#each @columns key='key' as |column i|}}
            <ColumnConfigRow
              @rowId={{if column.key column.key i}}
              @column={{column}}
              @isFirst={{this.isFirst i}}
              @isLast={{this.isLast i}}
              @onReorder={{fn this.reorder i}}
              @onToggleCollapsed={{if
                @onToggleCollapsed
                (fn @onToggleCollapsed column)
              }}
              @onLabelChange={{if @onLabelChange (fn @onLabelChange column)}}
              @onColorChange={{if @onColorChange (fn @onColorChange column)}}
              @onWipLimitChange={{if
                @onWipLimitChange
                (fn @onWipLimitChange column)
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
