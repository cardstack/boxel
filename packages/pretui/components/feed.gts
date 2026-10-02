// Pretui — Feed: the WAI-ARIA APG feed pattern with one roving tab stop.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { focusWhen, listen, rovingTabindex } from '../focus';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

// ── Feed ─────────────────────────────────────────────────────────────────
// The ARIA feed pattern: a stream of independently-authored articles the
// reader pages through.
//
// One deliberate deviation from the APG example, and it is the whole point:
// APG puts tabindex='0' on EVERY article, so a 200-item feed is 200 tab stops
// and Tab stops being a way to leave the region. This feed uses a roving
// tabindex — exactly one article is in the tab sequence, Tab leaves the feed
// immediately, and Page Down / Page Up / Home / End move between articles.
// Because Tab already escapes, APG's Control+Home / Control+End escape hatches
// are unnecessary; plain Home/End jump to the first/last article instead, and
// are ignored when focus sits inside a control within an article (so typing
// Home in a reply box still moves the caret).
//
// Content is a SLOT, not a prop bag (Law 7): callers render their own article
// bodies. The kit's Skeleton covers loading and EmptyState covers empty, so a
// feed never has a blank frame.

/**
 * The MINIMUM a feed item must carry. It is a lower bound, not the item type:
 * <Feed> is generic over T extends FeedItem, so a caller passing
 * `Activity[]` gets `Activity` back in the <:item> block rather than an
 * open bag of `unknown`. The index signature stays only so an untyped
 * fixture is still legal — see `defaultRowKey` in data-component.gts for the
 * kit-wide row-key contract this `id` satisfies.
 */
export interface FeedItem {
  /** stable id — the {{#each}} key and the roving-focus key */
  id: string;
  /** accessible name for this article; role='feed' requires each article to
   * be labelled, so one is synthesised from its position when omitted */
  label?: string;
  [key: string]: unknown;
}

export interface FeedSignature<T extends FeedItem = FeedItem> {
  Args: {
    /** the stream, in the order it should read */
    items: T[];
    /** accessible name for the feed region (default 'Activity') */
    label?: string;
    /** true while more items are loading — sets aria-busy and shows the
     * skeleton tail */
    loading?: boolean;
    /** how many skeleton rows the loading tail shows (default 2) */
    skeletonCount?: number;
  };
  Blocks: {
    /** one article's content — receives the item (in the caller's own row
     * type) and its 0-based index */
    item: [item: T, index: number];
    /** replaces the default EmptyState when there is nothing to show */
    empty?: [];
  };
  Element: HTMLDivElement;
}

export class Feed<T extends FeedItem = FeedItem> extends Component<
  FeedSignature<T>
> {
  @tracked private focusIndex = 0;
  @tracked private navigating = false;

  get items(): T[] {
    return this.args.items ?? [];
  }
  get label(): string {
    return this.args.label ?? 'Activity';
  }
  get count(): number {
    return this.items.length;
  }
  get isEmpty(): boolean {
    return this.count === 0 && !this.args.loading;
  }
  get busy(): string {
    return this.args.loading ? 'true' : 'false';
  }
  get skeletonRows(): number[] {
    let n = Math.max(1, Math.floor(this.args.skeletonCount ?? 2));
    let out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push(i);
    }
    return out;
  }
  posinset = (index: number): number => index + 1;
  itemLabel = (item: T, index: number): string =>
    item.label ?? `Update ${index + 1} of ${this.count}`;
  isRoving = (index: number): boolean =>
    index === Math.min(this.focusIndex, Math.max(0, this.count - 1));
  isFocusTarget = (index: number): boolean =>
    this.navigating && this.isRoving(index);

  private moveTo(index: number) {
    if (index < 0 || index >= this.count) {
      return;
    }
    this.navigating = true;
    this.focusIndex = index;
  }
  private indexFromEvent(event: Event): number | undefined {
    let target = event.target as HTMLElement | null;
    let el = target?.closest('[data-feed-index]') as HTMLElement | null;
    let raw = el?.dataset.feedIndex;
    return raw === undefined ? undefined : Number(raw);
  }

  // Same early return as Tree.onFocusIn, for the same reason: focusWhen's
  // el.focus() re-enters this handler synchronously during render, and
  // writing tracked state there would be a backtracking re-render.
  onFocusIn = (event: Event) => {
    let index = this.indexFromEvent(event);
    if (index === undefined || this.isRoving(index)) {
      return;
    }
    this.navigating = false;
    this.focusIndex = index;
  };

  onKeydown = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (!this.count) {
      return;
    }
    let index = Math.min(this.focusIndex, this.count - 1);
    let target = ev.target as HTMLElement | null;
    let onArticle = !!target?.matches('[data-feed-index]');
    if (ev.key === 'PageDown') {
      ev.preventDefault();
      this.moveTo(Math.min(this.count - 1, index + 1));
    } else if (ev.key === 'PageUp') {
      ev.preventDefault();
      this.moveTo(Math.max(0, index - 1));
    } else if (ev.key === 'Home' && onArticle) {
      ev.preventDefault();
      this.moveTo(0);
    } else if (ev.key === 'End' && onArticle) {
      ev.preventDefault();
      this.moveTo(this.count - 1);
    }
  };

  <template>
    <div class='pretui-feed-host' data-test-pretui-feed ...attributes>
      {{#if this.isEmpty}}
        {{#if (has-block 'empty')}}
          {{yield to='empty'}}
        {{else}}
          <EmptyState
            @title='Nothing has happened yet'
            @message='Activity from your suppliers and lots will collect here.'
          />
        {{/if}}
      {{else}}
        <div
          class='pretui-feed'
          role='feed'
          aria-label={{this.label}}
          aria-busy={{this.busy}}
          {{listen 'keydown' this.onKeydown}}
          {{listen 'focusin' this.onFocusIn}}
        >
          {{#each this.items key='id' as |item index|}}
            <article
              class='pretui-feed-item'
              data-feed-index={{index}}
              aria-posinset={{this.posinset index}}
              aria-setsize={{this.count}}
              aria-label={{this.itemLabel item index}}
              {{rovingTabindex (this.isRoving index)}}
              {{focusWhen (this.isFocusTarget index)}}
            >
              {{yield item index to='item'}}
            </article>
          {{/each}}
        </div>
        {{#if @loading}}
          {{! the skeleton tail sits OUTSIDE role='feed' — a feed's children
              must be articles, and a placeholder is not an article }}
          <div class='pretui-feed-loading' aria-hidden='true'>
            {{#each this.skeletonRows key='@index' as |row|}}
              <div class='pretui-feed-skeleton' data-row={{row}}>
                <Skeleton @width='38%' @height='11px' />
                <Skeleton @height='11px' />
                <Skeleton @width='72%' @height='11px' />
              </div>
            {{/each}}
          </div>
        {{/if}}
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-feed-host {
          min-width: 0;
        }
        .pretui-feed {
          display: grid;
          gap: var(--pretui-feed-gap, 10px);
          min-width: 0;
        }
        .pretui-feed-item {
          position: relative;
          padding: var(--space-4, 11px) var(--space-5, 14px);
          border-radius: var(--radius-surface, 10px);
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
          min-width: 0;
        }
        .pretui-feed-item:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-feed-loading {
          display: grid;
          gap: var(--pretui-feed-gap, 10px);
          margin-top: var(--pretui-feed-gap, 10px);
        }
        .pretui-feed-skeleton {
          display: grid;
          gap: 7px;
          padding: var(--space-4, 11px) var(--space-5, 14px);
          border-radius: var(--radius-surface, 10px);
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
      }
    </style>
  </template>
}
