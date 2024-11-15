import Component from '@glimmer/component';
import { get } from 'lodash';
import { fn, concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

export type Columns = {
  name: string,
  value: string
}
export type Rows = {
  [key: string]: string;
};
interface Signature {
  Args: {
    columns: Columns[];
    rows: Rows[];
  };
  Element: HTMLElement;
}
export default class DataTable extends Component<Signature> {
  @action
  onRowClick(value: string, column: Columns, rowIndex: number): void {
    const rowId = `row-${rowIndex}-${column.value}`;
    console.log(`Row clicked - ID: ${rowId}, Column: ${column.name}, Value: ${value}`);
  }
  <template>
    <div class="data-table" ...attributes>
      <table>
        <thead>
          <tr>
            {{#each @columns as |column columnIndex|}}
              <th
                id={{concat 'col-' columnIndex}}
              >{{column.name}}</th>
            {{/each}}
          </tr>
        </thead>
      <tbody>
          {{#each @rows as |row rowIndex|}}
            <tr>
              {{#each @columns as |column columnIndex|}}
                <td
                  id={{concat 'row-' rowIndex '-col-' columnIndex '-' (get row column.value)}}
                  {{on "click" (fn this.onRowClick (get row column.value) column rowIndex)}}>
                  {{get row column.value}}
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
        padding: 8px 12px;
        text-align: left;
        border: 1px solid #ddd;
      }
    </style>
  </template>
}
