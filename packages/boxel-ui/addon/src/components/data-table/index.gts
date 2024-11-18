import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn, concat, hash } from '@ember/helper';
import { get, set } from '@ember/object';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { next } from '@ember/runloop';
import { and, eq } from '@cardstack/boxel-ui/helpers';

export type DataTableHeader = {
  name: string
  value: string
};
export type DataTableCell = {
  [key: string]: string
};
interface Signature {
  Args: {
    dataTableHeader: DataTableHeader[]
    dataTableCell: DataTableCell[]
  };
  Element: HTMLElement
}
type cellData = {
  id: string
  value: string
  parent: string
  cellIndex: number
  headerIndex: number
}
export default class DataTable extends Component<Signature> {
  // track the props so i can make it mutable
  @tracked dataTableHeader = [...this.args.dataTableHeader];
  @tracked dataTableCell = [...this.args.dataTableCell];
  @tracked editedCell: { cellIndex: number; headerIndex: number } | null = null;
  @tracked editedValue: string = '';

  @action
  onCellClick(cellData: cellData): void {
    this.editedCell = { cellIndex: cellData.cellIndex, headerIndex: cellData.headerIndex };
    this.editedValue = cellData.value;
  }

  @action
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      this.saveEditedValue();
    } else if (event.key === "Escape") {
      this.cancelEdit();
    }
  }

  @action
  saveEditedValue(): void {
    next(() => {
      if (this.editedCell) {
        const { cellIndex, headerIndex } = this.editedCell;
        const header = this.dataTableHeader[headerIndex];
        const cell = this.dataTableCell[cellIndex];

        // use set to modify the value via ember reactivity
        if(cell && header){
          set(cell, header.value, this.editedValue)
        }

        // even if there's no save, just update the new value accordingly
        this.dataTableHeader = [...this.dataTableHeader];
        this.dataTableCell = [...this.dataTableCell];
        this.editedCell = null;
        this.editedValue = '';
      }
    })
  }

  @action
  cancelEdit(): void {
    next(() => {
      this.editedCell = null;
      this.editedValue = '';
    })
  }

  @action
  updateEditedValue(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.editedValue = input.value;
  }
  <template>
    <div class="data-table" ...attributes>
      <table>
        <thead>
          <tr>
            {{#each this.dataTableHeader as |header headerIndex|}}
              <th id={{concat 'header-' headerIndex}}>{{header.name}}</th>
            {{/each}}
          </tr>
        </thead>
        <tbody>
          {{#each this.dataTableCell as |cell cellIndex|}}
            <tr>
              {{#each this.dataTableHeader as |header headerIndex|}}
                <td
                  id={{concat 'cell-' cellIndex '-header-' headerIndex}}
                  data-value={{get cell header.value}}
                  data-parent={{header.value}}
                  {{on "click" (fn this.onCellClick (hash
                    id=(concat 'cell-' cellIndex '-header-' headerIndex)
                    value=(get cell header.value)
                    parent=header.value
                    cellIndex=cellIndex
                    headerIndex=headerIndex
                  ))}}
                >
                  {{#if (and (eq cellIndex this.editedCell.cellIndex) (eq headerIndex this.editedCell.headerIndex))}}
                    <input
                      type="text"
                      value={{get cell header.value}}
                      {{on "input" this.updateEditedValue}}
                      {{on "keydown" this.handleKeyDown}}
                      {{on "blur" this.cancelEdit}}
                    />
                  {{else}}
                    <span>{{get cell header.value}}</span>
                  {{/if}}
                </td>
              {{/each}}
            </tr>
          {{/each}}
        </tbody>
      </table>
    </div>
    <style scoped>
      .data-table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        text-align: left;
        border: var(--boxel-border);
      }
      td {
        cursor: pointer;
        transition: all 0.3s ease;
      }
      td:hover {
        box-shadow: var(--boxel-box-shadow-hover);
        background-color: var(--boxel-light-100);
        border-color: var(--boxel-dark);
      }
      input {
        width: 100%;
        padding: 5px;
        border: 1px solid #ccc;
      }
    </style>
  </template>
}
