import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

import {
  type CardContext,
  getFields,
  type CardDef,
  Box,
} from 'https://cardstack.com/base/card-api';
import { isPrimitive } from '@cardstack/runtime-common';
import { LoadingIndicator, Pill } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import { Paginator } from './paginator';

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
    realm?: string; //we try to use a single realm, otherwise pagination is tricky
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

    // Create a Box for the instance
    const rootBox = Box.create(this.args.instance);

    return this.args.fieldColumns.map((fieldName) => {
      const field = fields[fieldName];
      const value = (this.args.instance as any)[fieldName];
      const isPrimitiveField = field ? isPrimitive(field.card) : false;

      // Create a Box for this specific field and get its component
      let boxComponent = null;
      if (field) {
        boxComponent = field.component(rootBox);
      }

      console.log(`Field ${fieldName}:`, {
        value,
        fieldType: field?.fieldType,
        field: field,
        hasComponent: !!field?.component,
        component: field?.component,
        isPrimitive: isPrimitiveField,
        boxComponent,
      });

      return {
        fieldName,
        value,
        fieldType: field?.fieldType,
        field,
        isPrimitive: isPrimitiveField,
        component: field?.component,
        boxComponent,
      };
    });
  }

  <template>
    <tr class='table-row'>
      {{#each this.fieldInfo as |fieldInfo|}}
        <td class='field-cell'>
          {{#if (eq fieldInfo.fieldType 'contains')}}
            {{#if fieldInfo.boxComponent}}
              <fieldInfo.boxComponent @format='edit' />
            {{else}}
              {{fieldInfo.value}}
            {{/if}}
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
        vertical-align: top;
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

  capitalizeFieldName(fieldName: string): string {
    return fieldName
      .split(/(?=[A-Z])|_/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

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

  get realms() {
    return this.args.realm ? [this.args.realm] : [];
  }

  cardsData = this.args.context?.getCards(
    this,
    () => this.paginatedQuery,
    () => this.realms,
  );

  get fieldColumns() {
    if (this.cardsData?.instances?.length) {
      const firstInstance = this.cardsData.instances[0];
      const instanceFields = getFields(firstInstance.constructor, {
        includeComputeds: this.args.showComputedFields ?? false,
        usedLinksToFieldsOnly: false,
      });

      console.log('instanceField', instanceFields);
      const excludedFields = ['id', 'cardInfo'];
      const filteredFields = Object.keys(instanceFields).filter(
        (key) => !excludedFields.includes(key),
      );

      // Prioritize 'name' or 'title' fields by putting them first
      const priorityFields = ['name', 'title'];
      const priorityFieldsFound = filteredFields.filter((field) =>
        priorityFields.includes(field),
      );
      const otherFields = filteredFields
        .filter((field) => !priorityFields.includes(field))
        .sort();

      return [...priorityFieldsFound, ...otherFields];
    }
    return [];
  }

  @action
  goToPage(page: number) {
    this.currentPage = page;
  }

  get total() {
    return this.cardsData?.meta.page.total;
  }

  get size() {
    return this.paginatedQuery?.page?.size;
  }

  <template>
    <div class='table-container'>
      {{#if this.total}}
        {{#if this.size}}
          <Paginator
            @currentPage={{this.currentPage}}
            @total={{this.total}}
            @size={{this.size}}
            @onPageSelect={{this.goToPage}}
          />
        {{/if}}
      {{/if}}

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
                  <th>{{this.capitalizeFieldName fieldName}}</th>
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
