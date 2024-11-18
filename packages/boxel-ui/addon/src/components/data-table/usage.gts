import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import DataTable, { DataTableType } from './index.gts';

export default class DataTableUsage extends Component {
  @tracked tableDatas:DataTableType = {
    "dataTableHeader": [
      {
        "name": "First Name",
        "value": "firstName"
      },
      {
        "name": "Last Name",
        "value": "lastName"
      },
      {
        "name": "Email",
        "value": "email"
      }
    ],

    "dataTableCell": [
      {
        "firstName": "John",
        "lastName": "Doe",
        "email": "john.doe@example.com"
      },

      {
        "firstName": "Jane",
        "lastName": "Smith",
        "email": "jane.smith@example.com"
      },

      {
        "firstName": "Emily",
        "email": "emily.davis@example.com"
      }
    ]
  }

  constructor(owner: unknown, args: any) {
    super(owner, args);
  }

  <template>
    <FreestyleUsage @name='Data Table'>
      <:description>
        A table with array of data
      </:description>
      <:example>
        <DataTable
          @data={{this.tableDatas}}/>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='Data Table'
          @description='An object of array of data for the header and the cell'
          @value={{this.tableDatas}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
