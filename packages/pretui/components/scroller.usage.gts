// Pretui — Scroller usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Scroller } from './scroller';
import { LOTS } from '../demo-structure-scroll';

// ── Scroller ─────────────────────────────────────────────────────────────
export class ScrollerUsage extends Component {
  @tracked orientation: 'horizontal' | 'vertical' | 'both' = 'horizontal';
  @tracked edge: 'fade' | 'shadow' | 'none' = 'fade';
  @tracked hideScrollbar = false;

  orientationOptions = ['horizontal', 'vertical', 'both'];
  edgeOptions = ['fade', 'shadow', 'none'];
  lots = LOTS;

  setOrientation = (v: string) => {
    this.orientation = v as 'horizontal' | 'vertical' | 'both';
  };
  setEdge = (v: string) => {
    this.edge = v as 'fade' | 'shadow' | 'none';
  };
  setHideScrollbar = (v: boolean) => {
    this.hideScrollbar = v;
  };

  get isVertical(): boolean {
    return this.orientation === 'vertical';
  }

  get usage(): string {
    return [
      '<Scroller',
      "  @label='Recent lots'",
      "  @orientation='" + this.orientation + "'",
      "  @edge='" + this.edge + "'",
      '>',
      '  <div class="row">…</div>',
      '</Scroller>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Scroller'
      @description='A scroll container that tells you it is clipped. The edge affordance appears on whichever side has content past it and disappears at a hard stop, and the region becomes a tab stop exactly when it actually scrolls — and stops being one when the content shrinks. Scroll the strip below and watch both edges: the state is carried on data attributes, so a flick costs zero renders.'
      @source={{this.usage}}
    >
      <:example>
        <div class='scroller-stage'>
          <Scroller
            @label='Recent lots'
            @orientation={{this.orientation}}
            @edge={{this.edge}}
            @hideScrollbar={{this.hideScrollbar}}
          >
            <div class='scroller-strip' data-vertical={{if this.isVertical 'true'}}>
              {{#each this.lots key='id' as |lot|}}
                <article class='scroller-card'>
                  <p class='scroller-id'>{{lot.id}}</p>
                  <h4 class='scroller-tea'>{{lot.tea}}</h4>
                  <p class='scroller-meta'>{{lot.place}}
                    ·
                    {{lot.chests}}
                    chests</p>
                </article>
              {{/each}}
            </div>
          </Scroller>
          <p class='scroller-note'>Tab into the strip and use the arrow keys —
            the tab stop is added and removed with the overflow.</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='orientation'
          @description='Which axes may scroll: horizontal (default), vertical, or both. Explicit rather than always-on, so a horizontal strip cannot be nudged vertically by a trackpad.'
          @options={{this.orientationOptions}}
          @value={{this.orientation}}
          @onInput={{this.setOrientation}}
          @defaultValue='horizontal'
        />
        <Args.String
          @name='edge'
          @description='Edge treatment. fade blends into the surface behind it; shadow reads as a physical lip; none keeps the behaviour and drops the affordance.'
          @options={{this.edgeOptions}}
          @value={{this.edge}}
          @onInput={{this.setEdge}}
          @defaultValue='fade'
        />
        <Args.String
          @name='label'
          @description='Accessible name. Supplying one promotes the viewport to a landmark region — the role is deliberately NOT applied without a name, because an unnamed region is noise in a rotor.'
        />
        <Args.Bool
          @name='hideScrollbar'
          @description='Hide the native scrollbar. Defensible only because the edge affordance stays: without it, a hidden scrollbar hides the fact that there is more.'
          @defaultValue={{false}}
          @value={{this.hideScrollbar}}
          @onInput={{this.setHideScrollbar}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-scroller-fade'
          @type='dimension'
          @description='Width (or height) of the edge affordance.'
          @defaultValue='28px'
        />
        <Css.Basic
          @name='pretui-scroller-ground'
          @type='color'
          @description='The colour the fade blends into. Set it to whatever the Scroller actually sits on.'
          @defaultValue='var(--card)'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .scroller-stage {
        display: grid;
        gap: var(--space-3, 8px);
        padding: var(--space-5, 14px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        /* Custom properties INHERIT, so the Scroller's fade blends into the
           surface it actually sits on without a selector that has to reach
           into another component's scope. */
        --pretui-scroller-ground: var(--card);
      }
      .scroller-strip {
        display: flex;
        gap: var(--space-3, 8px);
        padding-block-end: var(--space-2, 6px);
      }
      .scroller-strip[data-vertical='true'] {
        flex-direction: column;
        max-block-size: none;
      }
      .scroller-card {
        flex: 0 0 auto;
        inline-size: 178px;
        padding: var(--space-4, 11px);
        border-radius: var(--radius-surface, 10px);
        background: var(--muted);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .scroller-id {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        letter-spacing: var(--track-eyebrow, 0.08em);
        color: var(--muted-foreground);
      }
      .scroller-tea {
        margin: 2px 0 0;
        font-size: var(--text-ui-lg, 14px);
        font-weight: var(--weight-strong, 600);
      }
      .scroller-meta {
        margin: 2px 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .scroller-note {
        margin: 0;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_SCROLLER: Record<string, unknown> = {
  Scroller: ScrollerUsage,
};
