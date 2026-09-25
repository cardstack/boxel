// Pretui — Pagination: page navigation with ellipsis windows.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

export interface PaginationSignature {
  Args: { page?: number; defaultPage?: number; pages: number; onPageChange?: (n: number) => void };
  Element: HTMLElement;
}

export class Pagination extends Component<PaginationSignature> {
  @tracked internal = this.args.defaultPage ?? 1;
  get page() {
    return this.args.page ?? this.internal;
  }
  get list(): (number | '…')[] {
    let out: (number | '…')[] = [];
    for (let i = 1; i <= this.args.pages; i++) {
      if (i === 1 || i === this.args.pages || Math.abs(i - this.page) <= 1) {
        out.push(i);
      } else if (out[out.length - 1] !== '…') {
        out.push('…');
      }
    }
    return out;
  }
  go = (v: number) => {
    let n = Math.max(1, Math.min(this.args.pages, v));
    if (this.args.page === undefined) {
      this.internal = n;
    }
    this.args.onPageChange?.(n);
  };
  isGap = (n: number | '…'): n is '…' => n === '…';
  prev = () => this.go(this.page - 1);
  next = () => this.go(this.page + 1);
  get atStart() {
    return this.page === 1;
  }
  get atEnd() {
    return this.page === this.args.pages;
  }
  isActive = (n: number | '…') => n === this.page;
  <template>
    <nav class='pretui-pagination' aria-label='Pagination' data-test-pretui-pagination ...attributes>
      <button type='button' class='pretui-page' disabled={{this.atStart}} aria-label='Previous' {{on 'click' this.prev}}>‹</button>
      {{#each this.list as |n|}}
        {{#if (this.isGap n)}}
          <span class='pretui-gap'>…</span>
        {{else}}
          <button
            type='button'
            class='pretui-page'
            data-state={{if (this.isActive n) 'active'}}
            aria-current={{if (this.isActive n) 'page'}}
            {{on 'click' (fn this.go n)}}
          >{{n}}</button>
        {{/if}}
      {{/each}}
      <button type='button' class='pretui-page' disabled={{this.atEnd}} aria-label='Next' {{on 'click' this.next}}>›</button>
    </nav>
    <style scoped>
      .pretui-pagination {
        display: flex;
        align-items: center;
        gap: 2px;
        font-size: var(--text-ui-md, 12.5px);
      }
      .pretui-page {
        min-width: 26px;
        height: 26px;
        padding: 0 6px;
        border: 0;
        border-radius: 6px;
        background: none;
        color: var(--muted-foreground);
        cursor: pointer;
        font: inherit;
        letter-spacing: inherit;
        font-variant-numeric: tabular-nums;
      }
      .pretui-page:hover:not(:disabled) {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      .pretui-page[data-state='active'] {
        background: var(--pretui-selected, var(--boxel-100));
        color: var(--pretui-primary-ink, var(--primary));
        font-weight: 600;
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
      }
      .pretui-page:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .pretui-gap {
        color: var(--ink-3, var(--boxel-400));
        padding: 0 4px;
      }
    </style>
  </template>
}
