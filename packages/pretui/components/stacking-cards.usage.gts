// Pretui — StackingCards usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { StackingCards } from './stacking-cards';

// ── StackingCards ← fancy StackingCards ──────────────────────────────────
// Live knob: offset (per-card pin ledge — replaces the original's
// topPosition strings). Dropped surface: scaleMultiplier + totalCards
// (the scroll-progress scale engine is not transcribed — the CSS version
// uses a static nth-last-child resting scale), scrollOptions, and
// per-item index wiring (nth-child does the counting). Scroll the host
// to watch cards pin and stack.
const STACK_CARDS = [
  {
    eyebrow: 'scene 01',
    title: 'Pin the header',
    copy: 'The first card reaches --pretui-stack-top and holds while the page keeps moving.',
  },
  {
    eyebrow: 'scene 02',
    title: 'Stack the second',
    copy: 'Each successive card pins one @offset ledge lower, covering the one before.',
  },
  {
    eyebrow: 'scene 03',
    title: 'Bury the early ones',
    copy: 'Buried cards rest at a slightly smaller scale — the static cut of the depth cue.',
  },
  {
    eyebrow: 'scene 04',
    title: 'Land the last',
    copy: 'The final card rides at full scale; the stack releases when the group scrolls past.',
  },
];

class StackingCardsUsage extends Component {
  cards = STACK_CARDS;
  @tracked offset = 12;
  setOffset = (v: number | null) => (this.offset = v ?? 12);
  get usage() {
    return `<StackingCards @offset={{${this.offset}}} as |s|>\n  <s.Card>…</s.Card>\n  <s.Card>…</s.Card>\n</StackingCards>`;
  }
  <template>
    <FreestyleUsage
      @name='StackingCards'
      @description='Cards pin and stack while scrolling — each card is position: sticky with an nth-child-stepped top, so it holds its ledge while the next card scrolls up over it. Pure CSS: no scroll listeners, no timers, and nothing animates on a clock (sticky is scroll-coupled layout, so reduced-motion needs nothing removed). Transcribed from fancy StackingCards; the JS original additionally shrinks buried cards live with scroll progress — here that depth cue is a static resting scale.'
      @source={{this.usage}}
    >
      <:example>
        <div class='stack-scroller'>
          <StackingCards @offset={{this.offset}} as |s|>
            {{#each this.cards as |card|}}
              <s.Card>
                <div class='stack-card-body'>
                  <span class='stack-eyebrow'>{{card.eyebrow}}</span>
                  <h4 class='stack-title'>{{card.title}}</h4>
                  <p class='stack-copy'>{{card.copy}}</p>
                </div>
              </s.Card>
            {{/each}}
          </StackingCards>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='offset'
          @defaultValue={{12}}
          @value={{this.offset}}
          @min={{0}}
          @max={{48}}
          @step={{4}}
          @description="px each card's pin ledge sits below the previous card's — 0 stacks them flush; larger values fan the pinned edges out."
          @onInput={{this.setOffset}}
        />
        <Args.Yield
          @description='Yields { Card } — render each card as a DIRECT child of the group (the nth-child ledge math depends on it; ledges cap at 8 steps). Scroll travel between pins comes from --pretui-stack-gap (24px) plus card height.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .stack-scroller {
        height: 340px;
        overflow-y: auto;
        padding: var(--space-4, 11px);
        border-radius: var(--radius-surface, 10px);
        box-shadow: inset 0 0 0 1px var(--border);
        background: var(--inset, var(--boxel-100));
      }
      .stack-card-body {
        min-height: 170px;
        display: grid;
        align-content: start;
        gap: 4px;
        padding: var(--space-5, 16px);
      }
      .stack-eyebrow {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .stack-title {
        margin: 0;
        font-size: var(--text-ui-lg, 14px);
        font-weight: 600;
        color: var(--card-foreground);
      }
      .stack-copy {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
        max-width: 46ch;
      }
    </style>
  </template>
}

export const DEMOS_STACKING_CARDS: Record<string, unknown> = {
  StackingCards: StackingCardsUsage,
};
