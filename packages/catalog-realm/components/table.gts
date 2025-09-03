import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

import {
  type CardContext,
  getFields,
  type CardDef,
} from 'https://cardstack.com/base/card-api';
import {
  BoxelButton,
  LoadingIndicator,
  Pill,
} from '@cardstack/boxel-ui/components';
import { eq, add } from '@cardstack/boxel-ui/helpers';

import { type Query } from '@cardstack/runtime-common';

interface TableRowSignature {
  Args: {
    instance: CardDef;
    fieldColumns: string[];
    context?: CardContext;
  };
  Element: HTMLTableRowElement;
}

interface TableSignature {
  Args: {
    query: Query;
    realms: string[];
    context?: CardContext;
    showComputedFields?: boolean;
  };
  Element: HTMLElement;
}

class TableRow extends GlimmerComponent<TableRowSignature> {
  get fieldInfo() {
    const fields = getFields(this.args.instance.constructor, {
      includeComputeds: false,
      usedLinksToFieldsOnly: false,
    });
    console.log('=== fieldInfo ===');

    return this.args.fieldColumns.map((fieldName) => {
      const field = fields[fieldName];
      const value = (this.args.instance as any)[fieldName];

      console.log(`Field ${fieldName}:`, {
        value,
        fieldType: field?.fieldType,
        field: field,
        hasComponent: !!field?.component,
        component: field?.component,
      });

      // if (field?.component) {
      //   console.log(`Field ${fieldName} component:`, field.component);
      // }

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
            {{#if fieldInfo.value}}
              <Pill
                {{this.args.context.cardComponentModifier
                  cardId=fieldInfo.value.id
                  format='data'
                  fieldType='linksTo'
                  fieldName=fieldInfo.fieldName
                }}
              >
                {{#if fieldInfo.value.title}}
                  {{fieldInfo.value.title}}
                {{else}}
                  [linked card]
                {{/if}}
              </Pill>
            {{/if}}
          {{else if (eq fieldInfo.fieldType 'containsMany')}}
            [{{fieldInfo.value.length}}
            items]
          {{else if (eq fieldInfo.fieldType 'linksToMany')}}
            {{#each fieldInfo.value as |linkedCard|}}
              <Pill
                {{this.args.context.cardComponentModifier
                  cardId=linkedCard.id
                  format='data'
                  fieldType='linksToMany'
                  fieldName=fieldInfo.fieldName
                }}
              >
                {{linkedCard.title}}
              </Pill>
            {{/each}}
          {{else}}
            {{fieldInfo.value}}
          {{/if}}
        </td>
      {{/each}}
    </tr>
    <style>
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
        height: 60px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: normal;
        word-wrap: break-word;
        max-width: 20%;
      }

      .field-cell:has(.pill) {
        white-space: normal;
        overflow: visible;
      }

      .field-cell .pill {
        margin-right: var(--boxel-sp-xxxs);
        margin-bottom: var(--boxel-sp-xxxs);
      }
    </style>
  </template>
}

export class Table extends GlimmerComponent<TableSignature> {
  @tracked currentPage = 0;
  @tracked pageSize = 10;

  get paginatedQuery(): Query {
    const query = {
      ...this.args.query,
      page: {
        number: this.currentPage,
        size: this.pageSize,
      },
    };
    console.log('Paginated query:', query);
    console.log('Current page:', this.currentPage);
    console.log('Page size:', this.pageSize);
    return query;
  }

  cardsData = this.args.context?.getCards(
    this,
    () => this.paginatedQuery,
    () => this.args.realms,
    { isLive: true },
  );

  get fieldColumns() {
    if (this.cardsData?.instances?.length) {
      const firstInstance = this.cardsData.instances[0];
      console.log('showcomputedFields', this.args.showComputedFields);
      const instanceFields = getFields(firstInstance.constructor, {
        includeComputeds: this.args.showComputedFields ?? false,
        usedLinksToFieldsOnly: false,
      });

      const excludedFields = ['id', 'cardInfo'];
      return Object.keys(instanceFields)
        .filter((key) => !excludedFields.includes(key))
        .sort();
    }
    return [];
  }

  @action
  nextPage() {
    this.currentPage++;
  }

  @action
  prevPage() {
    if (this.currentPage > 0) {
      this.currentPage--;
    }
  }

  <template>
    <div class='table-container'>
      <div class='table-controls'>
        <div class='pagination-controls'>
          <BoxelButton
            {{on 'click' this.prevPage}}
            disabled={{eq this.currentPage 0}}
          >
            Previous
          </BoxelButton>
          <span class='page-info'>Page {{add this.currentPage 1}}</span>
          <BoxelButton {{on 'click' this.nextPage}}>
            Next
          </BoxelButton>
        </div>
      </div>

      {{#if this.cardsData.isLoading}}
        <div class='loading-indicator'>
          <LoadingIndicator />
        </div>
      {{else}}
        <div class='table-scroll'>
          <table class='table'>
            <thead>
              <tr>
                {{#each this.fieldColumns as |fieldName|}}
                  <th>{{fieldName}}</th>
                {{/each}}
              </tr>
            </thead>
            <tbody>
              {{#if this.cardsData.instances}}
                {{#each this.cardsData.instances as |instance|}}
                  <TableRow
                    @instance={{instance}}
                    @fieldColumns={{this.fieldColumns}}
                    @context={{@context}}
                  />
                {{/each}}
              {{else}}
                <tr>
                  <td colspan={{this.fieldColumns.length}} class='empty-cell'>
                    No data found
                  </td>
                </tr>
              {{/if}}
            </tbody>
          </table>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .table-container {
        background: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        box-shadow: var(--boxel-box-shadow);
        height: 80vh;
        display: flex;
        flex-direction: column;
      }

      .table-controls {
        padding: var(--boxel-sp);
        background: var(--boxel-100);
        border-bottom: 1px solid var(--boxel-300);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .pagination-controls {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }

      .page-info {
        font: var(--boxel-font-sm);
        color: var(--boxel-dark);
        padding: 0 var(--boxel-sp-sm);
      }

      .table-scroll {
        overflow-x: auto;
        overflow-y: auto;
        flex: 1;
      }

      .table {
        width: 100%;
        border-collapse: collapse;
        border-spacing: 0;
        background: var(--boxel-light);
        min-width: 120vw;
        table-layout: fixed;
      }

      .table thead {
        background: var(--boxel-100);
        border-bottom: 2px solid var(--boxel-400);
        position: sticky;
        top: 0;
        z-index: 1;
      }

      .table th {
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        text-align: left;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        color: var(--boxel-dark);
        width: 20%;
      }

      .loading-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        height: 100%;
      }

      .empty-cell {
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        text-align: center;
        color: var(--boxel-500);
        font: var(--boxel-font-sm);
      }
    </style>
  </template>
}
