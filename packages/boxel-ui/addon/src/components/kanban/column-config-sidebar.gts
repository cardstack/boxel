// KanbanColumnConfigSidebar — Inline config panel for kanban column settings.
import ChevronDown from '@cardstack/boxel-icons/chevron-down';
import ChevronUp from '@cardstack/boxel-icons/chevron-up';
import XIcon from '@cardstack/boxel-icons/x';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import IconButton from '../icon-button/index.gts';
import Switch from '../switch/index.gts';
import type { KanbanColumnConfig } from './engine.ts';

interface Signature {
  Args: {
    columns: KanbanColumnConfig[];
    onClose?: () => void;
    onColumnsChange: (columns: KanbanColumnConfig[]) => void;
  };
  Element: HTMLElement;
}

export class KanbanColumnConfigSidebar extends Component<Signature> {
  @action update(index: number, patch: Partial<KanbanColumnConfig>): void {
    this.args.onColumnsChange(
      this.args.columns.map((col, i) =>
        i === index ? { ...col, ...patch } : col,
      ),
    );
  }

  @action moveUp(index: number): void {
    if (index === 0) return;
    let cols = [...this.args.columns];
    [cols[index - 1], cols[index]] = [cols[index]!, cols[index - 1]!];
    this.args.onColumnsChange(
      cols.map((col, i) => ({ ...col, sortOrder: i + 1 })),
    );
  }

  @action moveDown(index: number): void {
    if (index >= this.args.columns.length - 1) return;
    let cols = [...this.args.columns];
    [cols[index], cols[index + 1]] = [cols[index + 1]!, cols[index]!];
    this.args.onColumnsChange(
      cols.map((col, i) => ({ ...col, sortOrder: i + 1 })),
    );
  }

  @action onColorChange(index: number, event: Event): void {
    this.update(index, {
      color: (event.target as HTMLInputElement).value,
    });
  }

  @action onLabelInput(index: number, event: Event): void {
    this.update(index, {
      label: (event.target as HTMLInputElement).value,
    });
  }

  @action onWipInput(index: number, event: Event): void {
    let raw = parseInt((event.target as HTMLInputElement).value, 10);
    this.update(index, { wipLimit: isNaN(raw) || raw < 0 ? 0 : raw });
  }

  @action toggleVisible(index: number): void {
    let col = this.args.columns[index];
    if (!col) return;
    this.update(index, { collapsed: !col.collapsed });
  }

  isFirst = (index: number): boolean => index === 0;
  isLast = (index: number): boolean => index >= this.args.columns.length - 1;

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

      <ul class='col-list' role='list'>
        {{#each @columns as |column colIdx|}}
          <li class='col-row' data-test-col-config-row={{colIdx}}>
            <div class='col-row-order'>
              <IconButton
                @icon={{ChevronUp}}
                @size='extra-small'
                @disabled={{this.isFirst colIdx}}
                aria-label='Move column up'
                {{on 'click' (fn this.moveUp colIdx)}}
              />
              <IconButton
                @icon={{ChevronDown}}
                @size='extra-small'
                @disabled={{this.isLast colIdx}}
                aria-label='Move column down'
                {{on 'click' (fn this.moveDown colIdx)}}
              />
            </div>

            <label class='col-color-wrap'>
              <span class='boxel-sr-only'>Color for
                {{if column.label column.label 'column'}}</span>
              <input
                type='color'
                class='col-color-input'
                value={{if column.color column.color '#94a3b8'}}
                {{on 'change' (fn this.onColorChange colIdx)}}
                data-test-col-config-color={{colIdx}}
              />
            </label>

            <input
              type='text'
              class='col-label-input'
              value={{if column.label column.label ''}}
              placeholder='Label'
              aria-label='Column label'
              {{on 'input' (fn this.onLabelInput colIdx)}}
              data-test-col-config-label={{colIdx}}
            />

            <label class='col-wip-label'>
              <span class='col-wip-text'>Max</span>
              <input
                type='number'
                class='col-wip-input'
                value={{if column.wipLimit column.wipLimit 0}}
                min='0'
                {{on 'input' (fn this.onWipInput colIdx)}}
                data-test-col-config-wip={{colIdx}}
              />
            </label>

            <label class='col-visible-label'>
              <span class='col-visible-text'>Show</span>
              <Switch
                @label='Show column'
                @isEnabled={{if column.collapsed false true}}
                @onChange={{fn this.toggleVisible colIdx}}
                data-test-col-config-visible={{colIdx}}
              />
            </label>
          </li>
        {{/each}}
      </ul>
    </aside>

    <style scoped>
      .col-config-sidebar {
        --col-config-sidebar-border: var(--border, var(--boxel-border-color));
        display: flex;
        flex-direction: column;
        width: 22rem;
        flex-shrink: 0;
        border-left: 1px solid var(--col-config-sidebar-border);
        background: var(--sidebar, var(--boxel-light));
        color: var(--sidebar-foreground, var(--boxel-dark));
        overflow-y: auto;
      }

      .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1rem 0.625rem;
        border-bottom: 1px solid var(--col-config-sidebar-border);
        flex-shrink: 0;
      }

      .sidebar-title {
        font-size: 0.875rem;
        font-weight: 600;
        margin: 0;
        letter-spacing: -0.01em;
      }

      .col-list {
        list-style: none;
        margin: 0;
        padding: 0.25rem 0;
      }

      .col-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid
          color-mix(in oklch, var(--col-config-sidebar-border) 50%, transparent);
      }

      .col-row:last-child {
        border-bottom: none;
      }

      .col-row-order {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        flex-shrink: 0;
      }

      .col-color-wrap {
        flex-shrink: 0;
        display: flex;
        align-items: center;
      }

      .col-color-input {
        width: 1.5rem;
        height: 1.5rem;
        border: 1px solid var(--col-config-sidebar-border);
        border-radius: 0.25rem;
        padding: 0;
        cursor: pointer;
        background: none;
      }

      .col-color-input::-webkit-color-swatch-wrapper {
        padding: 0;
      }

      .col-color-input::-webkit-color-swatch {
        border: none;
        border-radius: 0.125rem;
      }

      .col-label-input {
        flex: 1;
        min-width: 0;
        padding: 0.3125rem 0.5rem;
        font-size: 0.8125rem;
        border: 1px solid var(--col-config-sidebar-border);
        border-radius: 0.25rem;
        background: var(--background, var(--boxel-100));
        color: inherit;
        outline: none;
        font-family: inherit;
      }

      .col-label-input:focus {
        border-color: var(--primary, var(--boxel-highlight));
        box-shadow: 0 0 0 2px
          color-mix(
            in oklch,
            var(--primary, var(--boxel-highlight)) 20%,
            transparent
          );
      }

      .col-wip-label {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex-shrink: 0;
      }

      .col-wip-text {
        font-size: 0.6875rem;
        font-weight: 500;
        color: var(--muted-foreground, var(--boxel-500));
        white-space: nowrap;
      }

      .col-wip-input {
        width: 3rem;
        padding: 0.3125rem 0.25rem;
        font-size: 0.8125rem;
        text-align: center;
        border: 1px solid var(--col-config-sidebar-border);
        border-radius: 0.25rem;
        background: var(--background, var(--boxel-100));
        color: inherit;
        outline: none;
        font-family: inherit;
      }

      .col-wip-input:focus {
        border-color: var(--primary, var(--boxel-highlight));
        box-shadow: 0 0 0 2px
          color-mix(
            in oklch,
            var(--primary, var(--boxel-highlight)) 20%,
            transparent
          );
      }

      .col-visible-label {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        flex-shrink: 0;
        cursor: pointer;
      }

      .col-visible-text {
        font-size: 0.6875rem;
        font-weight: 500;
        color: var(--muted-foreground, var(--boxel-500));
        white-space: nowrap;
      }
    </style>
  </template>
}
