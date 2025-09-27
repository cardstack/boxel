import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import {
  type CardContext,
  type CardDef,
  type CreateCardFn,
  type Field,
} from 'https://cardstack.com/base/card-api';
import { type CodeRef } from '@cardstack/runtime-common';
import { LoadingIndicator, Pill, Button } from '@cardstack/boxel-ui/components';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';

import { Paginator } from './paginator';
import { FieldRenderer } from './field-renderer';
import { getFieldsResource } from '../resources/get-fields-resource';

import { type Query, isPrimitive } from '@cardstack/runtime-common';

interface TableRowSignature {
  Args: {
    instance: CardDef;
    fieldColumns: string[];
    context?: CardContext;
    showComputedFields?: boolean;
    showClean?: boolean;
    fields?: { [fieldName: string]: Field };
  };
  Element: HTMLTableRowElement;
}

interface TableSignature {
  Args: {
    cardTypeRef?: CodeRef;
    query: Query;
    realm?: string; //we try to use a single realm, otherwise pagination is tricky
    showComputedFields?: boolean;
    showPrimitivesOnly?: boolean;
    showClean?: boolean;
    context?: CardContext;
    createCard?: CreateCardFn;
  };
  Element: HTMLElement;
}

class TableRow extends GlimmerComponent<TableRowSignature> {
  <template>
    <tr class='table-row'>
      {{#each @fieldColumns as |fieldName|}}
        <td class='field-cell'>
          <FieldRenderer
            @instance={{@instance}}
            @fieldName={{fieldName}}
            @showComputedFields={{@showComputedFields}}
            @fields={{@fields}}
            as |field|
          >
            {{#if field}}
              {{#if (not @showClean)}}
                {{#if (eq field.fieldType 'linksTo')}}
                  <field.component />
                {{else if (eq field.fieldType 'linksToMany')}}
                  <field.component @format='atom' />
                {{else}}
                  <field.component @format='edit' />
                {{/if}}
              {{else}}
                {{#if (eq field.fieldType 'contains')}}
                  {{#if field.component}}
                    <field.component @format='edit' />
                  {{else}}
                    {{field.value}}
                  {{/if}}
                {{else if (eq field.fieldType 'linksTo')}}
                  {{#if field.value}}
                    <Pill
                      {{@context.cardComponentModifier
                        cardId=field.value.id
                        format='data'
                        fieldType='linksTo'
                        fieldName=field.name
                      }}
                    >
                      {{#if field.value.title}}
                        {{field.value.title}}
                      {{else}}
                        [linked card]
                      {{/if}}
                    </Pill>
                  {{/if}}
                {{else if (eq field.fieldType 'containsMany')}}
                  [{{field.value.length}}
                  items]
                {{else if (eq field.fieldType 'linksToMany')}}
                  {{#each field.value as |linkedCard|}}
                    <Pill
                      {{@context.cardComponentModifier
                        cardId=linkedCard.id
                        format='data'
                        fieldType='linksToMany'
                        fieldName=field.name
                      }}
                    >
                      {{linkedCard.title}}
                    </Pill>
                  {{/each}}
                {{else}}
                  {{field.value}}
                {{/if}}
              {{/if}}
            {{/if}}
          </FieldRenderer>
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

  get typeFields(): { [fieldName: string]: Field } | undefined {
    return this.getFieldsResource.boxed?.fields;
  }

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

  getFieldsResource = getFieldsResource(
    this,
    () => this.args.cardTypeRef,
    () => this.args.realm,
    () => ({
      includeComputeds: this.args.showComputedFields ?? false,
      usedLinksToFieldsOnly: false,
    }),
  );

  get fieldColumns() {
    // Use precomputed fields from the fields resource
    const fields = this.typeFields;
    if (!fields) {
      return [];
    }

    const excludedFields = ['id', 'cardInfo'];
    const filteredFields = Object.keys(fields).filter((key) => {
      if (excludedFields.includes(key)) {
        return false;
      }
      // Only include primitive fields if showPrimitivesOnly is true
      if (this.args.showPrimitivesOnly) {
        const fieldDef = fields[key];
        return fieldDef ? isPrimitive(fieldDef.card) : false;
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

  goToPage = (page: number) => {
    this.currentPage = page;
  };

  get total() {
    return this.cardsData?.meta.page.total;
  }

  get size() {
    return this.paginatedQuery?.page?.size;
  }

  createNewCard = () => {
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
  };

  get isLoading() {
    return this.cardsData?.isLoading || this.getFieldsResource?.isLoading;
  }

  <template>
    <div class='table-container'>
      {{#if this.isLoading}}
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
                    @showClean={{@showClean}}
                    @fields={{this.typeFields}}
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
