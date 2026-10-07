// Pretui — Pagination: page navigation with ellipsis windows.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ChevronLeft from '@cardstack/boxel-icons/chevron-left';
import ChevronRight from '@cardstack/boxel-icons/chevron-right';

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
  // A request for the page already showing reports nothing. That covers a
  // press on the current page and a press on an edge arrow, which is
  // aria-disabled rather than natively disabled so it stays in the tab order
  // and still receives clicks.
  go = (v: number) => {
    let n = Math.max(1, Math.min(this.args.pages, v));
    if (n === this.page) return;
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
      <button type='button' class='pretui-page' aria-disabled={{if this.atStart 'true'}} aria-label='Previous' {{on 'click' this.prev}}><ChevronLeft class='pretui-chevron' width='12' height='12' aria-hidden='true' /></button>
      {{#each this.list as |n|}}
        {{#if (this.isGap n)}}
          <span class='pretui-gap'>…</span>
        {{else}}
          <button
            type='button'
            class='pretui-page'
            aria-label='Page {{n}}'
            data-state={{if (this.isActive n) 'active'}}
            aria-current={{if (this.isActive n) 'page'}}
            {{on 'click' (fn this.go n)}}
          >{{n}}</button>
        {{/if}}
      {{/each}}
      <button type='button' class='pretui-page' aria-disabled={{if this.atEnd 'true'}} aria-label='Next' {{on 'click' this.next}}><ChevronRight class='pretui-chevron' width='12' height='12' aria-hidden='true' /></button>
    </nav>
    <style scoped>
      @layer PretComponent {
        .pretui-pagination {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-6xs);
          font-size: var(--boxel-font-size-xs);
        }
        .pretui-page {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 1.625rem;
          height: 1.625rem;
          padding: 0 var(--boxel-sp-2xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: transparent;
          color: var(--muted-foreground);
          cursor: pointer;
          font-family: inherit;
          font-size: inherit;
          font-weight: inherit;
          line-height: inherit;
          letter-spacing: inherit;
          font-variant-numeric: tabular-nums;
          transition-property: scale;
          transition-duration: 150ms;
          transition-timing-function: ease-out;
        }
        /* The current page keeps its selected fill and ink under the pointer:
           this rule's specificity would otherwise beat the data-state rule. */
        .pretui-page:hover:not([aria-disabled='true'], [data-state='active']) {
          background-color: var(--hover);
          color: var(--foreground);
        }
        /* Press feedback. Edge arrows that are aria-disabled still receive
           presses, and the current page ignores them, so neither reacts. */
        .pretui-page:active:not([aria-disabled='true'], [data-state='active']) {
          scale: 0.96;
        }
        .pretui-page[data-state='active'] {
          background-color: var(--selected);
          color: var(--primary-ink);
          font-weight: 600;
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        }
        /* The arrows are fixed SVGs, so they flip with the writing direction
           the way the bidi-mirrored glyphs they replace did. */
        .pretui-chevron:dir(rtl) {
          scale: -1 1;
        }
        .pretui-page:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-page[aria-disabled='true'] {
          color: var(--subtle-foreground);
          cursor: default;
        }
        /* SVG icons do not mirror with the writing direction the way the
           text glyphs did. */
        .pretui-gap {
          color: var(--subtle-foreground);
          padding: 0 var(--boxel-sp-3xs);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-page {
            transition-duration: 0s;
          }
        }
      }
    </style>
  </template>
}
