// Pretui — ScrollArea usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { ScrollArea } from './scroll-area';
import type { ScrollAreaType } from './scroll-area';
import { FreestyleUsage } from './freestyle-usage';
import type { ScrollerEdge, ScrollerOrientation } from './scroller';
import { LIBRARY, ORIGINS } from '../internal/structure-shell-fixtures';

// ── ScrollArea ───────────────────────────────────────────────────────────

export class ScrollAreaUsage extends Component {
  @tracked type = 'auto';
  @tracked orientation = 'vertical';
  @tracked edge = 'fade';

  typeOptions = ['auto', 'always', 'hover', 'scroll'];
  orientationOptions = ['vertical', 'horizontal', 'both'];
  edgeOptions = ['fade', 'shadow', 'none'];
  rows = LIBRARY;
  origins = ORIGINS;

  setType = (v: string) => {
    this.type = v;
  };
  setOrientation = (v: string) => {
    this.orientation = v;
  };
  setEdge = (v: string) => {
    this.edge = v;
  };

  get orientationValue(): ScrollerOrientation {
    return this.orientation as ScrollerOrientation;
  }
  get typeValue(): ScrollAreaType {
    return this.type as ScrollAreaType;
  }
  get edgeValue(): ScrollerEdge {
    return this.edge as ScrollerEdge;
  }

  get usage(): string {
    return [
      '<ScrollArea',
      "  @label='Activity'",
      "  @orientation='" + this.orientation + "'",
      "  @type='" + this.type + "'",
      '>',
      '  …',
      '</ScrollArea>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='ScrollArea'
      @description='The Radix and shadcn name for Scroller — an alias, not a second scroll container. Radix exists to draw its own scrollbars, and across all 1189 lines of it there is not one aria attribute, role or tabindex, so a scrollable region with no focusable children cannot be scrolled by keyboard at all. Scroller adds the tab stop when the content overflows and removes it again when it stops, and native scrollbar styling is baseline, so there is nothing left to re-implement.'
      @source={{this.usage}}
    >
      <:example>
        <div class='sa-stage'>
          <ScrollArea
            @label='Recent activity'
            @orientation={{this.orientationValue}}
            @type={{this.typeValue}}
            @edge={{this.edgeValue}}
          >
            <div class='sa-list' data-axis={{this.orientation}}>
              {{#each this.rows key='id' as |row|}}
                <div class='sa-row'>{{row.label}}
                  <span class='sa-badge'>{{row.badge}}</span></div>
              {{/each}}
              {{#each this.origins key='id' as |row|}}
                <div class='sa-row'>{{row.label}}</div>
              {{/each}}
              {{#each this.rows key='id' as |row|}}
                <div class='sa-row'>{{row.label}} · second pass</div>
              {{/each}}
            </div>
          </ScrollArea>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='type'
          @description='auto and always keep the native scrollbar; hover and scroll hide it and let the edge affordance carry the fact. auto is the default here rather than Radix hover, because a hidden scrollbar is a removed affordance and that should be a decision you made.'
          @options={{this.typeOptions}}
          @value={{this.type}}
          @onInput={{this.setType}}
          @defaultValue='auto'
        />
        <Args.String
          @name='orientation'
          @description='Which axes may scroll. Maps the Mantine scrollbars x, y and xy vocabulary.'
          @options={{this.orientationOptions}}
          @value={{this.orientation}}
          @onInput={{this.setOrientation}}
          @defaultValue='vertical'
        />
        <Args.String
          @name='label'
          @description='Accessible name. Supplying one promotes the viewport to a landmark region; the role is deliberately not applied without a name, because an unnamed region is noise in a rotor.'
        />
        <Args.String
          @name='edge'
          @description='Edge treatment: fade, shadow or none. This is the affordance that makes hiding a scrollbar defensible at all, and it is the thing Radix has no equivalent for.'
          @options={{this.edgeOptions}}
          @value={{this.edge}}
          @onInput={{this.setEdge}}
          @defaultValue='fade'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-scroller-fade'
          @type='dimension'
          @description='Width or height of the edge affordance.'
          @defaultValue='28px'
        />
        <Css.Basic
          @name='pretui-scroller-ground'
          @type='color'
          @description='The colour the fade blends into. Set it to whatever this actually sits on.'
          @defaultValue='var(--card)'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .sa-stage {
        block-size: 190px;
        padding: var(--space-4, 11px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        --pretui-scroller-ground: var(--card);
      }
      .sa-list {
        display: grid;
        gap: 2px;
      }
      .sa-list[data-axis='horizontal'] {
        display: flex;
        gap: var(--space-3, 8px);
      }
      .sa-list[data-axis='horizontal'] .sa-row {
        flex: 0 0 auto;
        inline-size: 160px;
      }
      .sa-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3, 8px);
        min-block-size: var(--control-h, 28px);
        padding: 0 var(--space-3, 8px);
        border-radius: var(--radius-chip, 6px);
        background: var(--inset, var(--boxel-100));
        font-size: var(--text-ui-sm, 11.5px);
      }
      .sa-badge {
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_SCROLL_AREA: Record<string, unknown> = {
  ScrollArea: ScrollAreaUsage,
};
