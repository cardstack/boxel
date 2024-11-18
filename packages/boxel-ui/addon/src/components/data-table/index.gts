import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn, concat, hash } from '@ember/helper';
import { get, set } from '@ember/object';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { next } from '@ember/runloop';
import { and, eq } from '@cardstack/boxel-ui/helpers';

export interface DataTableHeader {
  name: string
  value: string
};
export interface DataTableCell {
  [key: string]: string
};

export interface DataTableType {
  dataTableHeader: DataTableHeader[],
  dataTableCell: DataTableCell[]
}

interface Signature {
  Args: {
    data: DataTableType
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
  @tracked dataTableHeader = [...this.args.data.dataTableHeader];
  @tracked dataTableCell = [...this.args.data.dataTableCell];
  @tracked editedCell: { cellIndex: number; headerIndex: number } | null = null;
  @tracked editedValue: string = '';
  @tracked errorMessage: string | null = null;

  @action
  validateData(): boolean {
    if (!Array.isArray(this.dataTableCell)) {
      this.errorMessage = 'Data should be an array.';
      return false;
    }

    // make sure that the header and cell is matching and show any missing value
    const expectedKeys = this.dataTableHeader.map(header => header.value);
    for (const row of this.dataTableCell) {
      const rowKeys = Object.keys(row);
      if (!expectedKeys.every(key => rowKeys.includes(key))) {
        this.errorMessage = `Table Header is missing some expected Table Cell. Expected Table Cell: ${expectedKeys.join(', ')}.`;
        return false;
      }
    }
    this.errorMessage = null;
    return true;
  }

  constructor(owner: unknown, args: any) {
    super(owner, args);
    if (!this.validateData()) {
      console.error(this.errorMessage);
    }
  }

  // validate again after any data has been updated
  @action
  updateData(newData: DataTableCell[]): void {
    this.dataTableCell = newData;
    if (!this.validateData()) {
      console.error(this.errorMessage);
    }
  }

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

        // even if there's no new set value, just update the new value accordingly
        this.dataTableHeader = [...this.dataTableHeader];
        this.dataTableCell = [...this.dataTableCell];
        this.editedCell = null;
        this.editedValue = '';
        this.updateData()
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
      {{#if this.errorMessage}}
        <div class="error-message">
          <p>{{this.errorMessage}}</p>
        </div>
      {{/if}}
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
      .error-message {
        color: var(--boxel-error-100);
        font-weight: bold;
        margin-bottom: var(--boxel-sp-sm);
      }
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
        transition: var(--boxel-transition);
      }
      td:hover {
        box-shadow: var(--boxel-box-shadow-hover);
        background-color: var(--boxel-light-100);
        border-color: var(--boxel-dark);
      }
      input {
        width: 100%;
        padding: var(--boxel-sp-sm);
      }
    </style>
  </template>
}
