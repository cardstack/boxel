// Pretui — SheetToolbar: the toolbar that drives a Sheet through its yielded API.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Button } from './button';
import { SearchInput } from './search-input';
import { Token } from './token';
import type { SheetApi } from './sheet';

export interface SheetToolbarSignature {
  Args: {
    /** the SheetApi yielded by `<Sheet>`'s `<:toolbar>` block */
    api: SheetApi;
    /** name of the table, rendered as the strip's title */
    title?: string;
    /** hide the quick-filter field */
    hideSearch?: boolean;
    /** placeholder for the quick-filter field */
    placeholder?: string;
  };
  Blocks: {
    /** extra controls, right-aligned after the search field */
    actions: [];
  };
  Element: HTMLDivElement;
}

/**
 * `SheetToolbar` — the chrome strip for `<Sheet>`: title, live row count
 * as a machine value (Law 3), quick filter, and a sort-reset that appears
 * only when there is a sort to reset. Composed from Pretui's own
 * SearchInput / Button / Token rather than boxel-grid's `<Toolbar>` suite,
 * which is grid-scoped chrome with a colliding name.
 */
export class SheetToolbar extends Component<SheetToolbarSignature> {
  get counts(): string {
    let api = this.args.api;
    if (!api) {
      return '';
    }
    return api.visibleCount === api.totalCount
      ? `${api.totalCount}`
      : `${api.visibleCount}/${api.totalCount}`;
  }
  get sorted(): boolean {
    return !!this.args.api?.sort;
  }
  get query(): string {
    return this.args.api?.query ?? '';
  }
  get placeholder(): string {
    return this.args.placeholder ?? 'Filter rows…';
  }
  setQuery = (next: string): void => {
    this.args.api?.setQuery(next);
  };
  clearSort = (_event: Event): void => {
    this.args.api?.clearSort();
  };

  <template>
    <div class='pretui-sheet-toolbar' data-test-pretui-sheet-toolbar ...attributes>
      <div class='pretui-sheet-toolbar-id'>
        {{#if @title}}
          <span class='pretui-sheet-toolbar-title'>{{@title}}</span>
        {{/if}}
        <Token @value={{this.counts}} />
        <span class='pretui-sheet-toolbar-unit'>rows</span>
      </div>
      <div class='pretui-sheet-toolbar-tools'>
        {{#if this.sorted}}
          <Button
            @tone='neutral'
            @appearance='plain'
            @size='xs'
            {{on 'click' this.clearSort}}
          >Clear sort</Button>
        {{/if}}
        {{#unless @hideSearch}}
          <SearchInput
            @value={{this.query}}
            @placeholder={{this.placeholder}}
            @onInput={{this.setQuery}}
          />
        {{/unless}}
        {{yield to='actions'}}
      </div>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-sheet-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3, 8px);
          min-width: 0;
        }
        .pretui-sheet-toolbar-id {
          display: flex;
          align-items: baseline;
          gap: 4px;
          min-width: 0;
        }
        .pretui-sheet-toolbar-title {
          font-size: var(--text-ui-lg, 13.5px);
          font-weight: 600;
          letter-spacing: var(--track-heading, -0.01em);
          margin-right: 3px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-sheet-toolbar-unit {
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-sheet-toolbar-tools {
          display: flex;
          align-items: center;
          gap: var(--space-2, 6px);
          min-width: 0;
        }
      }
    </style>
  </template>
}
