// Pretui — Feed usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Feed } from './feed';
import type { FeedItem } from './feed';
import { Avatar } from './avatar';
import { StatusChip } from './status-chip';
import { Token } from './token';
import { RelativeTime } from './relative-time';
import { NOW } from '../demo-structure-data';

// ── Feed ← WAI-ARIA APG feed pattern ─────────────────────────────────────
// The sourcing desk's activity stream. FeedItem is the LOWER BOUND
// ({ id, label?, … }) and <Feed> is generic over it, so this page passes
// Activity[] and the <:item> block hands Activity back — item.person reads
// straight through with neither a cast nor a per-key accessor.
interface Activity extends FeedItem {
  person: string;
  action: string;
  subject: string;
  at: string;
  status: string;
  token: string;
}

const ACTIVITY: Activity[] = [
  {
    id: 'a1',
    label: 'Ingrid Halvorsen approved the cupping notes for B-1181',
    person: 'Ingrid Halvorsen',
    action: 'approved the cupping notes for',
    subject: 'Da Hong Pao',
    at: '2026-08-12T08:40:00Z',
    status: 'approved',
    token: 'B-1181',
  },
  {
    id: 'a2',
    label: 'Yusuf Demirci cleared customs on the Fuzhou container',
    person: 'Yusuf Demirci',
    action: 'cleared customs on',
    subject: 'the Fuzhou container',
    at: '2026-08-11T17:05:00Z',
    status: 'complete',
    token: 'MSKU-4471290',
  },
  {
    id: 'a3',
    label: 'Mei-Lin Chua re-priced the ceremonial lots',
    person: 'Mei-Lin Chua',
    action: 're-priced',
    subject: 'the ceremonial lots',
    at: '2026-08-11T09:22:00Z',
    status: 'in review',
    token: '$102/kg',
  },
  {
    id: 'a4',
    label: 'Zanele Mokoena flagged the humidity log for the pu-erh room',
    person: 'Zanele Mokoena',
    action: 'flagged the humidity log for',
    subject: 'the pu-erh room',
    at: '2026-08-09T14:10:00Z',
    status: 'blocked',
    token: '64% RH',
  },
  {
    id: 'a5',
    label: 'Ryo Katagiri booked the autumn window with Uji Valley Growers',
    person: 'Ryo Katagiri',
    action: 'booked the autumn window with',
    subject: 'Uji Valley Growers',
    at: '2026-08-07T06:55:00Z',
    status: 'confirmed',
    token: 'B-1204',
  },
  {
    id: 'a6',
    label: 'Priya Raghunathan returned a lot to Nilgiri Leaf Cooperative',
    person: 'Priya Raghunathan',
    action: 'returned a lot to',
    subject: 'Nilgiri Leaf Cooperative',
    at: '2026-08-04T11:48:00Z',
    status: 'rejected',
    token: 'score 74',
  },
];

class FeedUsage extends Component {
  nowValue = NOW;

  @tracked label = 'Sourcing activity';
  @tracked loading = false;
  @tracked skeletonCount: number | null = 2;
  @tracked visible: number | null = 4;

  setLabel = (v: string) => (this.label = v);
  setLoading = (v: boolean) => (this.loading = v);
  setSkeletonCount = (v: number | null) => (this.skeletonCount = v);
  setVisible = (v: number | null) => (this.visible = v);

  get items(): Activity[] {
    let n = Math.max(0, Math.min(ACTIVITY.length, this.visible ?? 0));
    return ACTIVITY.slice(0, n);
  }
  get skeletonVal() {
    return this.skeletonCount ?? undefined;
  }
  get usage() {
    let bits = ['@items={{this.items}}', `@label='${this.label}'`];
    if (this.loading) bits.push('@loading={{true}}');
    if (this.skeletonCount !== null && this.skeletonCount !== 2) {
      bits.push(`@skeletonCount={{${this.skeletonCount}}}`);
    }
    return `<Feed ${bits.join(' ')}>\n  <:item as |item|>…</:item>\n</Feed>`;
  }

  <template>
    <FreestyleUsage
      @name='Feed'
      @description="A stream of independently-authored updates the reader pages through — activity, notifications, comments, anything that grows at one end. It implements the WAI-ARIA APG feed pattern: role='feed' with an accessible name, aria-busy flipped while more is loading, and every article carrying aria-posinset/aria-setsize so a screen reader can say 'article 3 of 6' in an infinite list. One deliberate deviation from the APG example, and it is the point: APG puts tabindex='0' on every article, so a 200-item feed is 200 tab stops and Tab stops being a way out. This feed uses a ROVING TABINDEX — exactly one article is in the tab sequence, Tab leaves immediately, and Page Down / Page Up move between articles, with Home/End jumping to the first/last (ignored when focus sits in a control inside an article, so typing Home in a reply box still moves the caret). Because Tab already escapes, APG's Control+Home/Control+End hatches are unnecessary. Content is a slot, not a prop bag: render your own article bodies in <:item>. The loading tail is Skeleton and sits OUTSIDE role='feed' — a feed's children must be articles, and a placeholder is not one — and the empty case is EmptyState, so the frame is never blank."
      @source={{this.usage}}
    >
      <:example>
        <Feed
          @items={{this.items}}
          @label={{this.label}}
          @loading={{this.loading}}
          @skeletonCount={{this.skeletonVal}}
        >
          <:item as |item|>
            <div class='feed-row'>
              <Avatar @name={{item.person}} @size={{26}} />
              <div class='feed-col'>
                <p class='feed-line'>
                  <span class='feed-who'>{{item.person}}</span>
                  {{item.action}}
                  <span class='feed-what'>{{item.subject}}</span>
                </p>
                <div class='feed-meta'>
                  <StatusChip @value={{item.status}} />
                  <Token @value={{item.token}} />
                  <RelativeTime
                    class='feed-when'
                    @date={{item.at}}
                    @now={{this.nowValue}}
                  />
                </div>
              </div>
            </div>
          </:item>
        </Feed>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @required={{true}}
          @value={{this.items}}
          @description='The stream, in the order it should read. Each item needs { id } and may carry { label }; <Feed> is generic over T extends FeedItem, so your own row type flows into the <:item> block untouched.'
        />
        <Args.Number
          @name='items (visible count)'
          @value={{this.visible}}
          @min={{0}}
          @max={{6}}
          @step={{1}}
          @defaultValue={{4}}
          @description='Demo-only knob that slices the fixture. Take it to 0 to see the EmptyState, and watch aria-setsize on every article follow the count.'
          @onInput={{this.setVisible}}
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='Activity'
          @description='Accessible name for the feed region. role="feed" requires one; this is it.'
          @onInput={{this.setLabel}}
        />
        <Args.Bool
          @name='loading'
          @value={{this.loading}}
          @defaultValue={{false}}
          @description='True while more items are on the way: sets aria-busy="true" on the feed and shows the skeleton tail beneath it.'
          @onInput={{this.setLoading}}
        />
        <Args.Number
          @name='skeletonCount'
          @value={{this.skeletonCount}}
          @min={{1}}
          @max={{5}}
          @step={{1}}
          @defaultValue={{2}}
          @description='How many placeholder rows the loading tail shows. Match it to your page size so the scroll position does not jump when the real items land.'
          @onInput={{this.setSkeletonCount}}
        />
        <Args.Yield
          @name=':item'
          @description='Required. One article’s content — receives (item, index). The <article> element, its roving tabindex, aria-posinset/setsize and aria-label are the component’s; everything inside is yours.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name=':empty'
          @description='Replaces the default EmptyState shown when there is nothing to read and nothing loading.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .feed-row {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3, 8px);
        min-width: 0;
      }
      .feed-col {
        display: grid;
        gap: 5px;
        min-width: 0;
      }
      .feed-line {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        line-height: 1.45;
        color: var(--muted-foreground);
      }
      .feed-who {
        font-weight: 600;
        color: var(--foreground);
      }
      .feed-what {
        color: var(--foreground);
      }
      .feed-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        min-width: 0;
      }
      .feed-when {
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_FEED: Record<string, unknown> = {
  Feed: FeedUsage,
};
