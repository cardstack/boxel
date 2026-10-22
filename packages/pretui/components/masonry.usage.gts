// Pretui — Masonry usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Masonry } from './masonry';
import { StatusChip } from './status-chip';
import { Token } from './token';

// ── Masonry ← react-masonry-css and the JS masonry engines ───────────────
// Cupping notes of deliberately uneven length — the only content shape that
// makes a masonry worth having. The page's whole job is to be honest about
// reading order, so the description says it and the example proves it: the
// cards are numbered in DOM order, and you can watch 1-2-3 run DOWN the
// first column rather than across the top.
interface TastingNote {
  id: string;
  n: number;
  tea: string;
  place: string;
  score: string;
  body: string;
}

const NOTES: TastingNote[] = [
  {
    id: 'n1',
    n: 1,
    tea: 'Da Hong Pao',
    place: 'Wuyishan',
    score: '93',
    body: 'Charcoal and stone fruit, a long mineral finish that outlasts the cup. Third infusion is the one to sell on.',
  },
  {
    id: 'n2',
    n: 2,
    tea: 'Gyokuro',
    place: 'Uji',
    score: '95',
    body: 'Sweet, thick, almost broth-like at 50°C. Pushed past 60°C it turns green and bitter within a single steep, which is worth writing on the tin because half the returns last season were people brewing it like sencha.',
  },
  {
    id: 'n3',
    n: 3,
    tea: 'Silver Needle',
    place: 'Fuding',
    score: '88',
    body: 'Quiet. Melon and hay.',
  },
  {
    id: 'n4',
    n: 4,
    tea: 'Aged Shou Pu-erh',
    place: 'Yiwu',
    score: '91',
    body: 'Damp cellar on the nose, then dates and wet wood. Stored in the separate room since March; the humidity log shows one excursion in June that did not reach the leaf.',
  },
  {
    id: 'n5',
    n: 5,
    tea: 'Keemun Hao Ya',
    place: 'Anxi',
    score: '84',
    body: 'Cocoa and a little smoke. House-blend band, not ceremonial.',
  },
  {
    id: 'n6',
    n: 6,
    tea: 'Jasmine Dragon Pearls',
    place: 'Hangzhou',
    score: '89',
    body: 'Seven scentings, and it shows — the jasmine sits on top of the tea instead of in it. Best cold-brewed, which nobody expects from a scented green.',
  },
  {
    id: 'n7',
    n: 7,
    tea: 'Milk Oolong',
    place: 'Alishan',
    score: '86',
    body: 'Buttery, short. Reliable rather than interesting.',
  },
  {
    id: 'n8',
    n: 8,
    tea: 'Lapsang Souchong',
    place: 'Wuyishan',
    score: '90',
    body: 'Pine smoke over a sweet base, and the base survives it. The only lot this season that people either love or return.',
  },
];

class MasonryUsage extends Component {
  notes = NOTES;

  @tracked columns: number | null = 3;
  @tracked min = '14rem';
  @tracked gap: number | null = 14;

  setColumns = (v: number | null) => (this.columns = v);
  setMin = (v: string) => (this.min = v);
  setGap = (v: number | null) => (this.gap = v);

  get columnsVal() {
    return this.columns ?? undefined;
  }
  get gapVal() {
    return this.gap ?? undefined;
  }
  get usage() {
    let bits = ['@items={{this.notes}}'];
    if (this.columns !== null && this.columns !== 3) {
      bits.push(`@columns={{${this.columns}}}`);
    }
    if (this.min !== '16rem') bits.push(`@min='${this.min}'`);
    if (this.gap !== null && this.gap !== 14) bits.push(`@gap={{${this.gap}}}`);
    return `<Masonry ${bits.join(' ')}>\n  <:item as |item|>…</:item>\n</Masonry>`;
  }

  <template>
    <FreestyleUsage
      @name='Masonry'
      @description="A staggered wall of unequal-height cards — moodboards, galleries, cupping notes — with no measuring engine at all. It is native CSS multi-column, so it costs zero JavaScript, zero per-child measurement and zero re-layout on resize. READING ORDER IS THE TRAP, so read this before reaching for it: DOM order, keyboard order and screen-reader order are always the order you pass @items, and never move. The VISUAL order is COLUMN-MAJOR — card 1 is top-left, card 2 is BELOW it, and a column fills to the bottom before the next column starts. The example numbers each card so you can watch 1-2-3 run down the first column. That makes Masonry right for a wall of peers, where no card outranks another, and WRONG for ranked content where 'first' must read top-left then rightwards — use <Grid> for that, which is row-major. A JS masonry engine buys row-major fill at the price of measuring every child on every resize AND a DOM whose order no longer matches what anyone sees; this component refuses that trade and says so. Under a narrow container it collapses to one column, where the two orders coincide. Dropped from the JS originals: measured per-item placement, animated re-flow, and infinite-scroll integration (that is <Feed>'s job)."
      @source={{this.usage}}
    >
      <:example>
        <Masonry
          @items={{this.notes}}
          @columns={{this.columnsVal}}
          @min={{this.min}}
          @gap={{this.gapVal}}
        >
          <:item as |note|>
            <article class='note'>
              <div class='note-head'>
                <span class='note-n'>{{note.n}}</span>
                <h4 class='note-tea'>{{note.tea}}</h4>
              </div>
              <div class='note-meta'>
                <Token @value={{note.place}} />
                <StatusChip @value={{note.score}} />
              </div>
              <p class='note-body'>{{note.body}}</p>
            </article>
          </:item>
        </Masonry>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @required={{true}}
          @value={{this.notes}}
          @description='The items to lay out. <Masonry> is generic over the row type, so they arrive in the <:item> block as whatever you passed in — this page hands it TastingNote[] and reads note.tea directly, with no cast. The component itself never reads inside an item.'
        />
        <Args.Number
          @name='columns'
          @value={{this.columns}}
          @min={{1}}
          @max={{6}}
          @step={{1}}
          @defaultValue={{3}}
          @description='Maximum number of columns. The browser uses fewer whenever @min would not fit, so this is a ceiling, not a count.'
          @onInput={{this.setColumns}}
        />
        <Args.String
          @name='min'
          @value={{this.min}}
          @defaultValue='16rem'
          @description='Minimum column width as a CSS length. Together with @columns it is the whole responsive story — there is no breakpoint list to maintain. Values that are not simple CSS lengths are ignored rather than injected.'
          @onInput={{this.setMin}}
        />
        <Args.Number
          @name='gap'
          @value={{this.gap}}
          @min={{0}}
          @max={{40}}
          @step={{1}}
          @defaultValue={{14}}
          @description='Gutter in px, applied to both the column gap and each cell’s bottom margin (multi-column has no row-gap). Also settable as --pretui-masonry-gap.'
          @onInput={{this.setGap}}
        />
        <Args.Yield
          @name=':item'
          @description='Required. One cell — receives (item, index). The cell wrapper sets break-inside:avoid, so a card is never split across a column boundary.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .note {
        display: grid;
        gap: 6px;
        padding: var(--space-4, 11px) var(--space-5, 14px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        min-width: 0;
      }
      .note-head {
        display: flex;
        align-items: baseline;
        gap: 7px;
        min-width: 0;
      }
      .note-n {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        color: var(--muted-foreground);
        font-variant-numeric: tabular-nums;
      }
      .note-tea {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 600;
        color: var(--foreground);
        min-width: 0;
      }
      .note-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 5px;
      }
      .note-body {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.5;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_MASONRY: Record<string, unknown> = {
  Masonry: MasonryUsage,
};
