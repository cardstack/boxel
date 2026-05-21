import ChevronDown from '@cardstack/boxel-icons/chevron-down';
import ChevronUp from '@cardstack/boxel-icons/chevron-up';
import Eye from '@cardstack/boxel-icons/eye';
import EyeOff from '@cardstack/boxel-icons/eye-off';
import XIcon from '@cardstack/boxel-icons/x';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { TrackedArray } from 'tracked-built-ins';

import FieldContainer from '../field-container/index.gts';
import IconButton from '../icon-button/index.gts';
import BoxelInput from '../input/index.gts';
import type { KanbanColumnConfig } from './engine.ts';

interface Signature {
  Args: {
    columns: TrackedArray<KanbanColumnConfig>;
    onClose?: () => void;
    onColumnsChange?: (columns: KanbanColumnConfig[]) => void;
  };
  Element: HTMLElement;
}

export class KanbanColumnConfigSidebar extends Component<Signature> {
  private normalizeSortOrders(): void {
    this.args.columns.forEach((column, index) => {
      column.sortOrder = index;
    });
  }

  private reorderColumns(fromIndex: number, toIndex: number): void {
    let [column] = this.args.columns.splice(fromIndex, 1);
    if (!column) {
      return;
    }
    this.args.columns.splice(toIndex, 0, column);
    this.normalizeSortOrders();
    this.args.onColumnsChange?.([...this.args.columns]);
  }

  @action moveUp(index: number): void {
    if (index === 0) return;
    this.reorderColumns(index, index - 1);
  }

  @action moveDown(index: number): void {
    if (index >= this.args.columns.length - 1) return;
    this.reorderColumns(index, index + 1);
  }

  @action onColorChange(column: KanbanColumnConfig, event: Event): void {
    column.color = (event.target as HTMLInputElement).value;
    this.args.onColumnsChange?.([...this.args.columns]);
  }

  @action onLabelInput(column: KanbanColumnConfig, val: string): void {
    column.label = val;
    this.args.onColumnsChange?.([...this.args.columns]);
  }

  @action onWipInput(column: KanbanColumnConfig, val: string): void {
    let raw = parseInt(val, 10);
    column.wipLimit = isNaN(raw) || raw < 0 ? 0 : raw;
    this.args.onColumnsChange?.([...this.args.columns]);
  }

  @action toggleVisible(column: KanbanColumnConfig): void {
    column.collapsed = this.isVisible(column);
    this.args.onColumnsChange?.([...this.args.columns]);
  }

  isFirst = (
    colOrder: KanbanColumnConfig['sortOrder'],
    index: number,
  ): boolean => {
    let order = colOrder ?? index;
    return order === 0;
  };
  isLast = (
    colOrder: KanbanColumnConfig['sortOrder'],
    index: number,
  ): boolean => {
    let order = colOrder ?? index;
    return order >= this.args.columns.length - 1;
  };
  isVisible = (column: KanbanColumnConfig): boolean => !column?.collapsed;

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
            <li class='col-row' data-test-col-config-row={{column.key}}>
              <div class='col-row-order'>
                <IconButton
                  @icon={{ChevronUp}}
                  @size='extra-small'
                  @disabled={{this.isFirst column.sortOrder i}}
                  aria-label='Move column up'
                  {{on 'click' (fn this.moveUp i)}}
                />
                <IconButton
                  @icon={{ChevronDown}}
                  @size='extra-small'
                  @disabled={{this.isLast column.sortOrder i}}
                  aria-label='Move column down'
                  {{on 'click' (fn this.moveDown i)}}
                />
              </div>

              <label class='col-color-wrap'>
                <span class='boxel-sr-only'>Color for
                  {{if column.label column.label 'column'}}</span>
                <BoxelInput
                  @type='color'
                  @value={{if column.color column.color '#94a3b8'}}
                  @onChange={{fn this.onColorChange column}}
                  data-test-col-config-color={{column.key}}
                />
              </label>

              <BoxelInput
                class='col-label-input'
                @value={{if column.label column.label ''}}
                @placeholder='Label'
                @onInput={{fn this.onLabelInput column}}
                aria-label='Column label'
                data-test-col-config-label={{column.key}}
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
                  @onInput={{fn this.onWipInput column}}
                  data-test-col-config-wip={{column.key}}
                />
              </FieldContainer>

              <IconButton
                class='col-visible-btn'
                @icon={{if (this.isVisible column) Eye EyeOff}}
                @size='extra-small'
                aria-label={{if
                  (this.isVisible column)
                  'Hide column'
                  'Show column'
                }}
                data-test-col-config-toggle-visible={{column.key}}
                {{on 'click' (fn this.toggleVisible column)}}
              />
            </li>
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

      .empty-sidebar {
        padding: 0.5rem 0.75rem;
        opacity: 0.7;
      }
    </style>
  </template>
}
