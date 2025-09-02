import GlimmerComponent from '@glimmer/component';

import {
  getFields,
  type CardDef,
} from 'https://cardstack.com/base/card-api';
import { eq } from '@cardstack/boxel-ui/helpers';

interface TableRowSignature {
  Args: {
    instance: CardDef;
    fieldColumns: string[];
  };
  Element: HTMLTableRowElement;
}

export class TableRow extends GlimmerComponent<TableRowSignature> {
  get fieldInfo() {
    const fields = getFields(this.args.instance.constructor, {
      includeComputeds: false,
      usedLinksToFieldsOnly: false,
    });
    
    return this.args.fieldColumns.map((fieldName) => {
      const field = fields[fieldName];
      const value = (this.args.instance as any)[fieldName];
      
      console.log(`Field ${fieldName}:`, {
        value,
        fieldType: field?.fieldType,
        field: field,
        hasComponent: !!field?.component,
      });
      
      if (field?.component) {
        console.log(`Field ${fieldName} component:`, field.component);
      }
      
      return { 
        fieldName, 
        value, 
        fieldType: field?.fieldType,
        field,
      };
    });
  }

  <template>
    <tr class='table-row'>
      {{#each this.fieldInfo as |fieldInfo|}}
        <td class='field-cell'>
          {{#if (eq fieldInfo.fieldType 'contains')}}
            {{fieldInfo.value}}
          {{else if (eq fieldInfo.fieldType 'linksTo')}}
            {{#if fieldInfo.value.name}}
              {{fieldInfo.value.name}}
            {{else}}
              [linked card]
            {{/if}}
          {{else if (eq fieldInfo.fieldType 'containsMany')}}
            [{{fieldInfo.value.length}} items]
          {{else if (eq fieldInfo.fieldType 'linksToMany')}}
            [{{fieldInfo.value.length}} links]
          {{else}}
            {{fieldInfo.value}}
          {{/if}}
        </td>
      {{/each}}
    </tr>

    <style scoped>
      .table-row {
        border-bottom: 1px solid var(--boxel-300);
        height: 60px;
      }

      .table-row:hover {
        background-color: var(--boxel-100);
      }

      .field-cell {
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        vertical-align: middle;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}