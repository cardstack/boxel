// KanbanColumnConfigSidebar — Inline config panel for kanban column settings.
import ChevronDown from '@cardstack/boxel-icons/chevron-down';
import ChevronUp from '@cardstack/boxel-icons/chevron-up';
import Eye from '@cardstack/boxel-icons/eye';
import EyeOff from '@cardstack/boxel-icons/eye-off';
import XIcon from '@cardstack/boxel-icons/x';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import FieldContainer from '../field-container/index.gts';
import IconButton from '../icon-button/index.gts';
import BoxelInput from '../input/index.gts';
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

  @action onLabelInput(index: number, val: string): void {
    this.update(index, { label: val });
  }

  @action onWipInput(index: number, val: string): void {
    let raw = parseInt(val, 10);
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

      <ul class='col-list'>
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
              <BoxelInput
                @type='color'
                @value={{if column.color column.color '#94a3b8'}}
                @onChange={{fn this.onColorChange colIdx}}
                data-test-col-config-color={{colIdx}}
              />
            </label>

            <BoxelInput
              class='col-label-input'
              @value={{if column.label column.label ''}}
              @placeholder='Label'
              @onInput={{fn this.onLabelInput colIdx}}
              aria-label='Column label'
              data-test-col-config-label={{colIdx}}
            />

            <FieldContainer
              class='col-wip-field'
              @tag='label'
              @label='Max'
              @inline={{true}}
            >
              <BoxelInput
                @value={{if column.wipLimit column.wipLimit 0}}
                @type='number'
                @min={{0}}
                @onInput={{fn this.onWipInput colIdx}}
                data-test-col-config-wip={{colIdx}}
              />
            </FieldContainer>

            <IconButton
              class='col-visible-btn'
              @icon={{if column.collapsed EyeOff Eye}}
              @size='extra-small'
              aria-label={{if column.collapsed 'Show column' 'Hide column'}}
              data-test-col-config-visible={{colIdx}}
              {{on 'click' (fn this.toggleVisible colIdx)}}
            />
          </li>
        {{/each}}
      </ul>
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
        border-left: 1px solid var(--boxel-col-config-sidebar-border);
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

      .col-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid
          color-mix(
            in oklch,
            var(--boxel-col-config-sidebar-border) 50%,
            transparent
          );
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

      .col-label-input {
        flex: 1;
        min-width: 0;
      }

      .col-wip-field {
        --boxel-field-content-size: 3rem;
        --boxel-input-icon-size: 0;
        flex-shrink: 0;
      }

      .col-visible-btn[aria-label='Show column'] {
        opacity: 0.4;
      }
    </style>
  </template>
}
