import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import DataTable, {
  type Columns,
  type Rows,
} from './index.gts';

export default class DataTableUsage extends Component {
  @tracked columns:Columns[] = [];
  @tracked rows:Rows[] = [];

  private datas = {
    "columns": [
      { "name": "First Name", "value": "firstName" },
      { "name": "Last Name", "value": "lastName" },
      { "name": "Email", "value": "email" }
    ],
    "rows": [
      { "firstName": "John", "lastName": "Doe", "email": "john.doe@example.com" },
      { "firstName": "Jane", "lastName": "Smith", "email": "jane.smith@example.com" },
      { "firstName": "Emily", "lastName": "Davis", "email": "emily.davis@example.com" }
    ]
  }

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.columns = this.datas.columns;
    this.rows = this.datas.rows;
  }

  <template>
    <FreestyleUsage @name='Data Table'>
      <:description>
        A table with array of data
      </:description>
      <:example>
        <DataTable
          @columns={{this.columns}}
          @rows={{this.rows}}/>
      </:example>
    </FreestyleUsage>
  </template>
}
