import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

import {
  type CardContext,
  getFields,
  type CardDef,
  type CreateCardFn,
} from 'https://cardstack.com/base/card-api';
import { type CodeRef } from '@cardstack/runtime-common';
import { LoadingIndicator, Pill, Button } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';

import { Paginator } from './paginator';
import { SingleFieldRenderer } from './field-renderer';

import { type Query, isPrimitive } from '@cardstack/runtime-common';

interface TableRowSignature {
  Args: {
    instance: CardDef;
    fieldColumns: string[];
    context?: CardContext;
    showComputedFields?: boolean;
  };
  Element: HTMLTableRowElement;
}

interface TableSignature {
  Args: {
    query: Query;
    realm?: string; //we try to use a single realm, otherwise pagination is tricky
    context?: CardContext;
    showComputedFields?: boolean;
    showPrimitivesOnly?: boolean;
    createCard?: CreateCardFn;
    cardTypeRef?: CodeRef;
  };
  Element: HTMLElement;
}

class TableRow extends GlimmerComponent<TableRowSignature> {
  <template>
    <tr class='table-row'>
      {{#each @fieldColumns as |fieldName|}}
        <td class='field-cell'>
          <SingleFieldRenderer
            @instance={{@instance}}
            @fieldName={{fieldName}}
            @showComputedFields={{@showComputedFields}}
            as |fieldInfo|
          >
            {{#if (eq fieldInfo.fieldType 'contains')}}
              {{#if fieldInfo.component}}
                <fieldInfo.component @format='edit' />
              {{else}}
                {{fieldInfo.value}}
              {{/if}}
            {{else if (eq fieldInfo.fieldType 'linksTo')}}
              {{#if fieldInfo.value}}
                <Pill
                  {{@context.cardComponentModifier
                    cardId=fieldInfo.value.id
                    format='data'
                    fieldType='linksTo'
                    fieldName=fieldInfo.name
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
                  {{@context.cardComponentModifier
                    cardId=linkedCard.id
                    format='data'
                    fieldType='linksToMany'
                    fieldName=fieldInfo.name
                  }}
                >
                  {{linkedCard.title}}
                </Pill>
              {{/each}}
            {{else}}
              {{fieldInfo.value}}
            {{/if}}
          </SingleFieldRenderer>
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
    { isLive: true }, //for new cards to appear
  );

  get fieldColumns() {
    // Only compute field columns after data has loaded and instances are available
    if (this.cardsData?.instances?.length) {
      const firstInstance = this.cardsData?.instances[0];
      const instanceFields = getFields(firstInstance.constructor, {
        includeComputeds: this.args.showComputedFields ?? false,
        usedLinksToFieldsOnly: false,
      });

      console.log('instanceField', instanceFields);
      const excludedFields = ['id', 'cardInfo'];
      const filteredFields = Object.keys(instanceFields).filter((key) => {
        if (excludedFields.includes(key)) {
          return false;
        }
        // Only include primitive fields if showPrimitivesOnly is true
        if (this.args.showPrimitivesOnly) {
          const fieldDef = instanceFields[key];
          return isPrimitive(fieldDef.card);
        }
        return true;
      });

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

  @action
  createNewCard() {
    if (!this.args.createCard) {
      throw new Error('No createCard crud function');
    }
    if (!this.args.cardTypeRef) {
      throw new Error('No cardTypeRef');
    }
    const realmURL = this.args.realm ? new URL(this.args.realm) : undefined;
    this.args.createCard(this.args.cardTypeRef, realmURL, {
      realmURL,
    });
  }

  <template>
    <div class='table-container'>
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
                    @showComputedFields={{@showComputedFields}}
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

      <div class='table-footer'>
        <div class='footer-left'></div>
        <div class='footer-center'>
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
        </div>
        <div class='footer-right'>
          {{#if @cardTypeRef}}
            <Button @kind='primary' {{on 'click' this.createNewCard}}>
              Create
            </Button>
          {{/if}}
        </div>
      </div>
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

      .table-footer {
        padding: var(--boxel-sp);
        background: var(--boxel-100);
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: var(--boxel-sp);
      }

      .footer-left {
        /* Empty spacer for left side */
      }

      .footer-center {
        display: flex;
        justify-content: center;
      }

      .footer-right {
        display: flex;
        justify-content: flex-end;
      }
    </style>
  </template>
}
