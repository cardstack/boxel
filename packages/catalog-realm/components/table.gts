import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

import {
  type CardContext,
  getFields,
} from 'https://cardstack.com/base/card-api';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import { eq, add } from '@cardstack/boxel-ui/helpers';

import { type Query } from '@cardstack/runtime-common';
import { TableRow } from './table-row';

interface TableSignature {
  Args: {
    query: Query;
    realms: string[];
    context?: CardContext;
    ignoreCardInfo?: boolean;
  };
  Element: HTMLElement;
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
      const instanceFields = getFields(firstInstance.constructor, {
        includeComputeds: false,
        usedLinksToFieldsOnly: false,
      });

      const excludedFields = ['id'];
      if (this.args.ignoreCardInfo !== false) {
        excludedFields.push('cardInfo');
      }

      return Object.keys(instanceFields).filter(
        (key) => !excludedFields.includes(key),
      );
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

      <table class='table'>
        <thead>
          <tr>
            {{#each this.fieldColumns as |fieldName|}}
              <th>{{fieldName}}</th>
            {{/each}}
          </tr>
        </thead>
        <tbody>
          {{#if this.cardsData.isLoading}}
            <tr>
              <td colspan={{this.fieldColumns.length}} class='loading-cell'>
                Loading...
              </td>
            </tr>
          {{else if this.cardsData.instances}}
            {{#each this.cardsData.instances as |instance|}}
              <TableRow
                @instance={{instance}}
                @fieldColumns={{this.fieldColumns}}
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
    <style scoped>
      .table-container {
        background: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        box-shadow: var(--boxel-box-shadow);
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

      .table {
        width: 100%;
        border-collapse: collapse;
        border-spacing: 0;
        background: var(--boxel-light);
      }

      .table thead {
        background: var(--boxel-100);
        border-bottom: 2px solid var(--boxel-400);
      }

      .table th {
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        text-align: left;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        color: var(--boxel-dark);
      }

      .loading-cell,
      .empty-cell {
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        text-align: center;
        color: var(--boxel-500);
        font: var(--boxel-font-sm);
      }
    </style>
  </template>
}
