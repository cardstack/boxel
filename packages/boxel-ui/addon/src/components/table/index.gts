import { get } from '@ember/object';
import Component from '@glimmer/component';

export interface BoxelTableColumn {
  header: string;
  key: string;
}

export type BoxelTableRow = Record<string, any>;

export interface TableArgs {
  columns: Array<BoxelTableColumn>;
  rows: Array<BoxelTableRow>;
}
export default class Table extends Component<TableArgs> {
  <template>
    <table class='boxel-table'>
      <thead>
        <tr>
          {{#each @columns as |column|}}
            <th>{{column.header}}</th>
          {{/each}}
        </tr>
      </thead>
      <tbody>
        {{#each @rows as |row|}}
          <tr>
            {{#each @columns as |column|}}
              <td>{{get row column.key}}</td>
            {{/each}}
          </tr>
        {{/each}}
      </tbody>
    </table>

    <style>
      .boxel-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 1rem;
        --table-th-bg: var(--boxel-table-th-bg, #f7fafc);
        --table-th-font-weight: var(--boxel-table-th-font-weight, 500);
        --table-border-color: var(--boxel-table-border-color, #e2e8f0);
        --table-padding: var(--boxel-table-padding, 0.75rem);
      }

      .boxel-table th,
      .boxel-table td {
        padding: var(--table-padding);
        border-bottom: 1px solid var(--table-border-color);
        text-align: left;
      }

      .boxel-table thead th {
        background-color: var(--table-th-bg);
        font-weight: var(--table-th-font-weight);
      }

      .boxel-table tbody tr:hover {
        background-color: var(--table-th-bg);
        filter: brightness(0.95);
      }
    </style>
  </template>

  sampleColumns = [
    { header: 'Name', key: 'name' },
    { header: 'Age', key: 'age' },
    { header: 'Email', key: 'email' },
    { header: 'Occupation', key: 'occupation' },
    { header: 'City', key: 'city' },
  ];
}
