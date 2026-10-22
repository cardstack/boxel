// Pretui — StackingCards: cards that stack as the page scrolls.
import Component from '@glimmer/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import { cssNumber } from '../pretui-css';
import { styleVar } from '../internal/structure-scenes';

// ── StackingCards — TRANSCRIBED from fancy StackingCards ─────────────────
// Cards pin and stack while the surrounding context scrolls. The original
// couples useScroll progress to per-card scale transforms (scaleMultiplier
// × totalCards bookkeeping through React context). This transcription is
// pure CSS: every card is position: sticky with an nth-child-stepped top
// (base --pretui-stack-top + index × @offset, indices capped at 8 steps —
// deeper stacks share the 8th ledge), so each card pins slightly below
// the previous one and the next card scrolls up over it. The subtle
// depth cue is a STATIC nth-last-child scale (buried cards 0.97–0.99,
// top card 1.0) — what the JS original adds that we skip is the
// scroll-progress-LINKED version of that scale (cards shrinking live as
// they are buried) plus arbitrary scroll-container options. No timers,
// no animation — sticky positioning is scroll-coupled layout, so there
// is no motion for prefers-reduced-motion to remove. Cards must be
// direct children of the group (nth-child math); scroll travel between
// pins comes from --pretui-stack-gap (default 24px) plus card height.

export interface StackingCardsSignature {
  Args: {
    /** px each card's pin ledge sits below the previous card's — default 12 */
    offset?: number;
  };
  Blocks: {
    /** yields { Card } — render each stacked card as a direct child */
    default: [{ Card: typeof StackingCard }];
  };
  Element: HTMLDivElement;
}

interface StackingCardSignature {
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

const StackingCard: TemplateOnlyComponent<StackingCardSignature> = <template>
  <article class='pretui-stacking-card' data-test-pretui-stacking-card ...attributes>
    {{yield}}
  </article>
  <style scoped>
    @layer PretComponent {
      .pretui-stacking-card {
        position: sticky;
        top: calc(
          var(--pretui-stack-top, 12px) +
            var(--pretui-stack-index, 0) * var(--pretui-stack-offset, 12px)
        );
        transform-origin: top center;
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        color: var(--card-foreground);
        box-shadow:
          0 0 0 1px var(--border),
          var(--pretui-shadow-card, 0 8px 24px rgba(20, 18, 26, 0.08));
      }
      .pretui-stacking-card + .pretui-stacking-card {
        margin-top: var(--pretui-stack-gap, 24px);
      }
      /* nth-child-stepped pin ledges — capped at 8 steps. */
      .pretui-stacking-card:nth-child(1) {
        --pretui-stack-index: 0;
      }
      .pretui-stacking-card:nth-child(2) {
        --pretui-stack-index: 1;
      }
      .pretui-stacking-card:nth-child(3) {
        --pretui-stack-index: 2;
      }
      .pretui-stacking-card:nth-child(4) {
        --pretui-stack-index: 3;
      }
      .pretui-stacking-card:nth-child(5) {
        --pretui-stack-index: 4;
      }
      .pretui-stacking-card:nth-child(6) {
        --pretui-stack-index: 5;
      }
      .pretui-stacking-card:nth-child(7) {
        --pretui-stack-index: 6;
      }
      .pretui-stacking-card:nth-child(8) {
        --pretui-stack-index: 7;
      }
      .pretui-stacking-card:nth-child(n + 9) {
        --pretui-stack-index: 8;
      }
      /* Static depth cue — the JS original animates this with scroll
         progress; here buried cards simply sit at a smaller resting scale. */
      .pretui-stacking-card:nth-last-child(2) {
        transform: scale(0.99);
      }
      .pretui-stacking-card:nth-last-child(3) {
        transform: scale(0.98);
      }
      .pretui-stacking-card:nth-last-child(n + 4) {
        transform: scale(0.97);
      }
    }
  </style>
</template>;

export class StackingCards extends Component<StackingCardsSignature> {
  get offsetStyle(): string {
    return styleVar(
      '--pretui-stack-offset',
      `${cssNumber(this.args.offset, 0, 512) ?? 12}px`,
    );
  }
  <template>
    <div
      class='pretui-stacking-cards'
      style={{this.offsetStyle}}
      data-test-pretui-stacking-cards
      ...attributes
    >
      {{yield (hash Card=StackingCard)}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-stacking-cards {
          display: block;
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
        }
      }
    </style>
  </template>
}
