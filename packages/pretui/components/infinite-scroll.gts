// Pretui — InfiniteScroll: append the next page when the reader nears the end of the list, with a real Load more button.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint cannot see
// it here (accepted parse baseline, same as toaster.gts / focus.gts)
import { modifier } from 'ember-modifier';
import { scrollParent } from '../internal/structure-scroll';
import { Button } from './button';
import { Spinner } from './spinner';

export interface InfiniteScrollSignature {
  Args: {
    /** Asked for the next page. The caller appends to the list it renders. */
    onLoadMore?: () => void;
    /** Whether there is another page (default true). */
    hasMore?: boolean;
    /** A page is loading: the sentinel and the button hold off. */
    busy?: boolean;
    /** How early to load, as a CSS margin around the scroll container (default '0px 0px 200px 0px'). */
    rootMargin?: string;
    /** Load automatically as the end comes into view (default true). False keeps only the button. */
    auto?: boolean;
    /** The button's label (default 'Load more'). */
    loadLabel?: string;
    /** Announced after a page lands, e.g. 'Loaded 20 more lots'. */
    loadedMessage?: string;
  };
  Blocks: {
    default: [];
    /** Shown instead of the button when there is nothing more. */
    end: [];
  };
  Element: HTMLDivElement;
}

/**
 * The behaviour, not the scene: Feed is a whole social stream; this appends
 * pages to whatever list it wraps. A zero-height sentinel after the content
 * is watched by an IntersectionObserver rooted at the nearest scroll
 * container — the pane, not the window — and asks for the next page as it
 * comes within `@rootMargin`.
 *
 * A real Load more button is always rendered: it is the path for keyboard
 * and switch users, for anyone whose pane never scrolls, and for when the
 * observer cannot run. The caller announces nothing itself; set
 * `@loadedMessage` after a page lands and one polite line says it.
 */
export class InfiniteScroll extends Component<InfiniteScrollSignature> {
  get hasMore(): boolean {
    return this.args.hasMore ?? true;
  }
  get auto(): boolean {
    return this.args.auto ?? true;
  }
  get loadLabel(): string {
    return this.args.loadLabel ?? 'Load more';
  }

  /** Whether the Load more button held focus, so its removal at the end
   * can hand focus to the end of the list instead of the page. */
  private buttonFocused = false;
  noteFocus = (rawEvent: Event) => {
    let event = rawEvent as FocusEvent;
    this.buttonFocused = (event.target as HTMLElement | null)?.closest?.('.pretui-infinite-foot button') != null;
  };
  /** Runs when the end of the list renders. */
  landEnd = modifier((el: HTMLElement) => {
    if (this.buttonFocused && (document.activeElement === document.body || !document.activeElement)) {
      this.buttonFocused = false;
      el.focus();
    }
  });

  load = () => {
    if (this.args.busy || !this.hasMore) {
      return;
    }
    this.args.onLoadMore?.();
  };

  watch = modifier((sentinel: HTMLElement, [enabled, rootMargin]: [boolean, string]) => {
    if (!enabled) {
      return;
    }
    let observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.load();
        }
      },
      { root: scrollParent(sentinel), rootMargin, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  get watching(): boolean {
    return this.auto && this.hasMore && !this.args.busy;
  }
  get rootMargin(): string {
    return this.args.rootMargin ?? '0px 0px 200px 0px';
  }

  <template>
    <div class='pretui-infinite' aria-busy={{if @busy 'true' 'false'}} data-test-pretui-infinite-scroll ...attributes>
      {{yield}}
      <div class='pretui-infinite-sentinel' aria-hidden='true' data-test-pretui-infinite-sentinel {{this.watch this.watching this.rootMargin}}></div>
      <div class='pretui-infinite-foot' {{on 'focusin' this.noteFocus}}>
        {{#if this.hasMore}}
          <Button
            @appearance='outlined'
            @size='s'
            aria-busy={{if @busy 'true'}}
            data-state={{if @busy 'busy'}}
            data-test-pretui-infinite-load
            {{on 'click' this.load}}
          >
            {{#if @busy}}<Spinner @size='s' aria-hidden='true' role='presentation' />{{/if}}
            {{this.loadLabel}}
          </Button>
        {{else}}
          <div class='pretui-infinite-end' tabindex='-1' data-test-pretui-infinite-end {{this.landEnd}}>{{#if (has-block 'end')}}{{yield to='end'}}{{/if}}</div>
        {{/if}}
      </div>
      <p class='pretui-infinite-status' role='status' data-test-pretui-infinite-status>{{@loadedMessage}}</p>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-infinite {
          display: grid;
          min-inline-size: 0;
        }
        .pretui-infinite-sentinel {
          block-size: 1px;
          margin-block-start: -1px;
          pointer-events: none;
        }
        .pretui-infinite-foot {
          display: flex;
          justify-content: center;
          padding-block: var(--space-4, 0.6875rem);
        }
        .pretui-infinite-end:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-infinite-end {
          color: var(--muted-foreground);
          font-size: var(--text-ui-sm, 0.72rem);
        }
        .pretui-infinite-status {
          position: absolute;
          inline-size: 1px;
          block-size: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
      }
    </style>
  </template>
}

