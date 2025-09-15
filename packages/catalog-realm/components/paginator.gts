import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';

import { fn } from '@ember/helper';

interface PaginatorSignature {
  Args: {
    currentPage: number;
    total: number;
    size: number;
    onPageSelect: (page: number) => void;
  };
  Element: HTMLElement;
}

export class Paginator extends GlimmerComponent<PaginatorSignature> {
  get totalPages(): number {
    return Math.ceil(this.args.total / this.args.size);
  }

  get visiblePages(): number[] {
    const current = this.args.currentPage;
    const total = this.totalPages;
    const delta = 2; // Show 2 pages on each side of current page

    if (total <= 7) {
      // Show all pages if total is small
      return Array.from({ length: total }, (_, i) => i);
    }

    let start = Math.max(0, current - delta);
    let end = Math.min(total - 1, current + delta);

    // Adjust if we're near the beginning or end
    if (current < delta + 1) {
      end = Math.min(total - 1, 4);
    }
    if (current > total - delta - 2) {
      start = Math.max(0, total - 5);
    }

    const pages = [];
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    return pages;
  }

  get firstVisiblePage() {
    return this.visiblePages[0];
  }

  get lastVisiblePage() {
    return this.visiblePages[this.visiblePages.length - 1];
  }

  get showStartEllipsis(): boolean {
    return this.visiblePages[0] > 1;
  }

  get showEndEllipsis(): boolean {
    return this.lastVisiblePage < this.totalPages - 2;
  }

  get isPrevDisabled(): boolean {
    return this.args.currentPage === 0;
  }

  get isNextDisabled(): boolean {
    return this.args.currentPage >= this.totalPages - 1;
  }

  get shouldShowFirstPage(): boolean {
    return this.firstVisiblePage !== 0;
  }

  get shouldShowLastPage(): boolean {
    return this.lastVisiblePage !== this.totalPages - 1;
  }

  get currentPageDisplay(): number {
    return this.args.currentPage + 1;
  }

  get lastPageIndex(): number {
    return this.totalPages - 1;
  }

  selectPage = (page: number) => {
    if (page !== this.args.currentPage && page >= 0 && page < this.totalPages) {
      this.args.onPageSelect(page);
    }
  };

  getPageDisplay = (page: number): number => {
    return page + 1;
  };

  isActivePage = (page: number): boolean => {
    return page === this.args.currentPage;
  };

  goToPrevPage = (): void => {
    if (!this.isPrevDisabled) {
      this.args.onPageSelect(this.args.currentPage - 1);
    }
  };

  goToNextPage = (): void => {
    if (!this.isNextDisabled) {
      this.args.onPageSelect(this.args.currentPage + 1);
    }
  };
  <template>
    <div class='table-controls'>
      <div class='pagination-controls'>
        <button
          type='button'
          class='nav-button {{if this.isPrevDisabled "disabled"}}'
          {{on 'click' this.goToPrevPage}}
          disabled={{this.isPrevDisabled}}
        >
          &lt;
        </button>

        {{! First page }}
        {{#if this.shouldShowFirstPage}}
          <button
            type='button'
            class='page-button'
            {{on 'click' (fn this.selectPage 0)}}
          >
            1
          </button>
        {{/if}}

        {{! Start ellipsis }}
        {{#if this.showStartEllipsis}}
          <span class='ellipsis'>...</span>
        {{/if}}

        {{! Visible page numbers }}
        {{#each this.visiblePages as |page|}}
          <button
            type='button'
            class='page-button {{if (this.isActivePage page) "active"}}'
            {{on 'click' (fn this.selectPage page)}}
          >
            {{this.getPageDisplay page}}
          </button>
        {{/each}}

        {{! End ellipsis }}
        {{#if this.showEndEllipsis}}
          <span class='ellipsis'>...</span>
        {{/if}}

        {{! Last page }}
        {{#if this.shouldShowLastPage}}
          <button
            type='button'
            class='page-button'
            {{on 'click' (fn this.selectPage this.lastPageIndex)}}
          >
            {{this.totalPages}}
          </button>
        {{/if}}

        <button
          type='button'
          class='nav-button {{if this.isNextDisabled "disabled"}}'
          {{on 'click' this.goToNextPage}}
          disabled={{this.isNextDisabled}}
        >
          &gt;
        </button>
      </div>

      <div class='page-info'>
        Showing
        {{this.currentPageDisplay}}
        of
        {{this.totalPages}}
        pages ({{@total}}
        total items)
      </div>
    </div>
    <style scoped>
      .table-controls {
        padding: var(--boxel-sp);
        background: var(--boxel-100);
        border-bottom: 1px solid var(--boxel-300);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .pagination-controls {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .page-button,
      .nav-button {
        background: transparent;
        border: none;
        color: rgba(0, 0, 0, 0.87);
        font: 500 var(--boxel-font-sm);
        min-width: 2rem;
        height: 2rem;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        border-radius: 0;
        transition: background-color 0.15s ease;
        margin: 0 1px;
      }

      .page-button:hover,
      .nav-button:hover:not(.disabled) {
        background-color: rgba(0, 0, 0, 0.04);
      }

      .page-button.active {
        background-color: rgba(25, 118, 210, 0.12);
        color: rgb(25, 118, 210);
        font-weight: 600;
      }

      .page-button.active:hover {
        background-color: rgba(25, 118, 210, 0.16);
      }

      .nav-button.disabled {
        color: rgba(0, 0, 0, 0.26);
        cursor: default;
      }

      .nav-button.disabled:hover {
        background-color: transparent;
      }

      .ellipsis {
        font: var(--boxel-font-sm);
        color: var(--boxel-600);
        padding: 0 var(--boxel-sp-xs);
        display: flex;
        align-items: center;
        min-width: 2.5rem;
        justify-content: center;
      }

      .page-info {
        font: var(--boxel-font-xs);
        color: var(--boxel-600);
        text-align: center;
      }
    </style>
  </template>
}
