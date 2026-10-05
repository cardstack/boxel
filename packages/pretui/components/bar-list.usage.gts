// Pretui — BarList usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { seedFrom } from '../examples';
import { FreestyleUsage } from './freestyle-usage';
import { BarList } from './bar-list';
import type { BarListItem } from './bar-list';

// ── BarList ──────────────────────────────────────────────────────────────
const REFERRERS: BarListItem[] = [
  'Direct',
  'Catalog search',
  'Assistant suggestion',
  'Shared link',
  'Embedded card',
  'Realm index',
  'External referral',
].map((name) => ({
  name,
  value: 40 + (seedFrom('referrer#' + name) % 940),
}));

export class BarListUsage extends Component {
  @tracked limit = 5;
  @tracked ranked = true;

  setLimit = (v: number | null) => {
    this.limit = v ?? 5;
  };
  setRanked = (v: boolean) => {
    this.ranked = v;
  };

  rows = REFERRERS;

  get usage(): string {
    return [
      '<BarList',
      '  @rows={{this.referrers}}',
      '  @limit={{' + this.limit + '}}',
      "  @label='Traffic by source'",
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='BarList'
      @description='The ranked distribution: a label, a proportional bar, and the value as text on every row. It answers "which five things are biggest", which neither Meter (one level) nor Chart (a series) does. No plotting engine — a card that shows a top-five list never loads Plot.'
      @source={{this.usage}}
    >
      <:example>
        <div class='barlist-stage'>
          <BarList
            @rows={{this.rows}}
            @limit={{this.limit}}
            @ranked={{this.ranked}}
            @label='Card opens by traffic source, last 30 days'
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='rows'
          @description='BarListItem[] — name, value, and optional href and hue. Accepts @load / @loadKey instead, with the same DataComponent state machine.'
        />
        <Args.Bool
          @name='ranked'
          @description='Sort descending by value before rendering. Turn it off to keep the caller order — a time-ordered list stays time-ordered.'
          @defaultValue={{true}}
          @value={{this.ranked}}
          @onInput={{this.setRanked}}
        />
        <Args.Number
          @name='limit'
          @description='Cap the rows rendered. The remainder is reported as a count rather than silently dropped.'
          @defaultValue={{0}}
          @min={{1}}
          @max={{7}}
          @step={{1}}
          @value={{this.limit}}
          @onInput={{this.setLimit}}
        />
        <Args.Number
          @name='max'
          @description='Scale bars against this instead of the largest value — the way to keep two BarLists comparable side by side.'
        />
        <Args.Object
          @name='format'
          @description='Formats the printed value. Defaults to a locale number.'
        />
        <Args.String
          @name='hue'
          @description='Bar hue for every row; a per-row hue wins. Caller strings are validated through the kit cssValue allowlist before they reach the style attribute.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-barlist-row-height'
          @type='dimension'
          @description='Minimum row height. Raise it for a touch-first surface.'
          @defaultValue='28px'
        />
        <Css.Basic
          @name='pretui-barlist-hue'
          @type='color'
          @description='Bar fill hue, mixed to 18% against the surface.'
          @defaultValue='var(--chart-2)'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .barlist-stage {
        padding: var(--space-5, 14px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
    </style>
  </template>
}

export const DEMOS_BAR_LIST: Record<string, unknown> = {
  BarList: BarListUsage,
};
