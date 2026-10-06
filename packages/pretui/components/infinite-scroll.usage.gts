// Pretui — InfiniteScroll usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { InfiniteScroll } from './infinite-scroll';

const PAGE = 10;
const TOTAL = 40;

export class InfiniteScrollUsage extends Component {
  @tracked count = PAGE;
  @tracked message = '';
  get rows(): string[] {
    return Array.from({ length: this.count }, (_, i) => `Lot ${i + 1}`);
  }
  get hasMore(): boolean {
    return this.count < TOTAL;
  }
  more = () => {
    this.count = Math.min(TOTAL, this.count + PAGE);
    this.message = `Loaded ${PAGE} more lots`;
  };
  get usage() {
    return "<InfiniteScroll @onLoadMore={{this.more}} @hasMore={{this.hasMore}} @busy={{this.loading}} @loadedMessage={{this.message}}>\n  {{#each this.rows as |row|}}…{{/each}}\n  <:end>That is every lot.</:end>\n</InfiniteScroll>";
  }
  <template>
    <FreestyleUsage
      @name='InfiniteScroll'
      @description='Appends the next page as the reader nears the end of the list. A sentinel is watched inside the pane, not the window, and a real Load more button is always there for keyboard users and panes that never scroll. One polite line says what landed. Feed is the whole scene; this is the behaviour.'
      @source={{this.usage}}
    >
      <:example>
        <div class='is-demo'>
          <InfiniteScroll @onLoadMore={{this.more}} @hasMore={{this.hasMore}} @loadedMessage={{this.message}}>
            <:default>
              {{#each this.rows as |row|}}<div class='is-demo-row'>{{row}}</div>{{/each}}
            </:default>
            <:end>That is every lot.</:end>
          </InfiniteScroll>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Action @name='onLoadMore' @description='Asked for the next page; append to the list you render.' />
        <Args.Bool @name='hasMore' @defaultValue={{true}} />
        <Args.Bool @name='busy' @defaultValue={{false}} @description='A page is loading; nothing more is asked.' />
        <Args.Bool @name='auto' @defaultValue={{true}} @description='False keeps only the button.' />
        <Args.String @name='rootMargin' @defaultValue='0px 0px 200px 0px' />
        <Args.String @name='loadLabel' @defaultValue='Load more' />
        <Args.String @name='loadedMessage' @description='Announced after a page lands.' />
        <Args.Yield @name='default' @description='The list.' />
        <Args.Yield @name='end' @description='Shown when there is nothing more.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .is-demo {
        block-size: 14rem;
        overflow-y: auto;
        border-radius: var(--radius-surface, 10px);
        box-shadow: 0 0 0 1px var(--border);
        background: var(--card);
      }
      .is-demo-row {
        padding: var(--space-3, 0.5rem) var(--space-4, 0.6875rem);
        border-block-end: 1px solid var(--border);
        font-size: var(--text-ui-md, 0.78rem);
      }
    </style>
  </template>
}

export const DEMOS_INFINITE_SCROLL: Record<string, unknown> = {
  InfiniteScroll: InfiniteScrollUsage,
};
