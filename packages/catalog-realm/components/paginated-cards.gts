import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { type Query } from '@cardstack/runtime-common';
import { type CardContext } from 'https://cardstack.com/base/card-api';
import { Paginator } from './paginator';

interface Signature {
  Args: {
    query?: Query;
    realms: string[];
    context?: CardContext;
  };
  Blocks: {
    default: [];
  };
}

export default class PaginatedCards extends GlimmerComponent<Signature> {
  @tracked totalResults = 0;
  @tracked currentPage = 0;
  readonly pageSize = 12;
  private lastCriteriaSignature: string | null = null;

  get hasCards() {
    return this.totalResults > 0;
  }

  get maxPageIndex(): number {
    return this.totalResults > 0
      ? Math.ceil(this.totalResults / this.pageSize) - 1
      : 0;
  }

  get normalizedRealms(): string[] {
    if (!Array.isArray(this.args.realms)) {
      return [];
    }
    return this.args.realms.filter(
      (realm): realm is string => typeof realm === 'string' && realm.length > 0,
    );
  }

  get canSearch(): boolean {
    return Boolean(this.args.query && this.normalizedRealms.length);
  }

  private resetPagination(): void {
    if (this.currentPage !== 0) {
      this.currentPage = 0;
    }
    if (this.totalResults !== 0) {
      this.totalResults = 0;
    }
  }

  private buildCriteriaSignature(baseQuery: Query): string {
    try {
      return JSON.stringify({
        query: baseQuery,
        realms: this.normalizedRealms,
      });
    } catch {
      return `${Date.now()}`;
    }
  }

  get paginatedQuery(): Query | undefined {
    let baseQuery = this.args.query;
    if (!baseQuery) {
      if (this.lastCriteriaSignature !== null) {
        this.lastCriteriaSignature = null;
        this.resetPagination();
      }
      return undefined;
    }

    let signature = this.buildCriteriaSignature(baseQuery);
    if (signature !== this.lastCriteriaSignature) {
      this.lastCriteriaSignature = signature;
      this.resetPagination();
    }

    return {
      ...baseQuery,
      page: {
        ...(baseQuery.page ?? {}),
        number: this.currentPage,
        size: this.pageSize,
      },
    };
  }

  get placeholderMessage(): string {
    if (!this.args.query && !this.normalizedRealms.length) {
      return 'Provide a realm and card definition to search for cards.';
    }
    if (!this.args.query) {
      return 'Add search criteria to find matching cards.';
    }
    return 'Choose at least one realm to search.';
  }

  captureMeta = (meta: any): undefined => {
    let total = Number(meta?.page?.total ?? 0);
    if (!Number.isFinite(total) || total < 0) {
      total = 0;
    }
    this.totalResults = total;
    if (this.currentPage > this.maxPageIndex) {
      this.currentPage = Math.max(0, this.maxPageIndex);
    }
    return undefined;
  };

  selectPage = (page: number): void => {
    if (Number.isInteger(page) && page >= 0) {
      this.currentPage = Math.min(page, this.maxPageIndex);
    }
  };

  get searchComponent() {
    return this.args.context?.prerenderedCardSearchComponent;
  }

  get canRenderSearch(): boolean {
    return this.canSearch && Boolean(this.searchComponent);
  }

  get missingContextMessage(): string {
    return 'Card search context unavailable.';
  }

  <template>
    {{#if this.canRenderSearch}}
      {{#let this.paginatedQuery this.searchComponent as |paginatedQuery SearchComponent|}}
        {{#if paginatedQuery}}
          <SearchComponent
            @query={{paginatedQuery}}
            @format='embedded'
            @realms={{this.normalizedRealms}}
            @isLive={{true}}
          >
            <:loading>
              <p class='paginated-cards__loading'>Loading cards…</p>
            </:loading>
            <:response as |cards|>
              {{#if cards.length}}
                <div class='paginated-cards__grid'>
                  {{#each cards key='url' as |card|}}
                    <card.component class='paginated-cards__card' />
                  {{/each}}
                </div>
              {{else}}
                <p class='paginated-cards__empty'>No cards found.</p>
              {{/if}}
            </:response>
            <:meta as |meta|>
              {{this.captureMeta meta}}
              {{#if this.hasCards}}
                <Paginator
                  @currentPage={{this.currentPage}}
                  @total={{this.totalResults}}
                  @size={{this.pageSize}}
                  @onPageSelect={{this.selectPage}}
                />
              {{/if}}
            </:meta>
          </SearchComponent>
        {{else}}
          <p class='paginated-cards__empty'>
            Unable to build search query. Please adjust your inputs.
          </p>
        {{/if}}
      {{/let}}
    {{else if this.canSearch}}
      <p class='paginated-cards__empty'>{{this.missingContextMessage}}</p>
    {{else}}
      <p class='paginated-cards__empty'>{{this.placeholderMessage}}</p>
    {{/if}}

    <style scoped>
      .paginated-cards__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--boxel-sp-lg);
      }
      .paginated-cards__card {
        height: 100%;
      }
      .paginated-cards__loading,
      .paginated-cards__empty {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-600);
      }
    </style>
  </template>
}
