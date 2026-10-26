// Pretui — PlanMark: a plan step's state as a mark: a soft tick, a thin turning ring, a dashed circle.
import Component from '@glimmer/component';
import Check from '@cardstack/boxel-icons/check';
import X from '@cardstack/boxel-icons/x';
import Minus from '@cardstack/boxel-icons/minus';

export type PlanMarkState = 'done' | 'current' | 'next' | 'failed' | 'skipped';

export interface PlanMarkSignature {
  Args: {
    state: PlanMarkState;
    /** px. Default 16 */
    size?: number;
  };
  Element: HTMLSpanElement;
}

/**
 * The marks a checklist reads by shape before words: done is a thin tick
 * in a soft tint of the success colour, the step under way a ring that turns (still under reduced
 * motion), what comes next a dashed circle, a failed step a soft tinted disc
 * with a cross, a skipped one a hollow disc with a dash. Decorative: the
 * list says each state in words.
 */
export class PlanMark extends Component<PlanMarkSignature> {
  get size(): string {
    return String(this.args.size ?? 16);
  }
  get inner(): string {
    return String(Math.round((this.args.size ?? 16) * 0.62));
  }
  <template>
    <span
      class='pretui-planmark'
      data-state={{@state}}
      aria-hidden='true'
      data-test-pretui-plan-mark={{@state}}
      ...attributes
    >
      <svg
        class='pretui-planmark-ring'
        viewBox='0 0 16 16'
        width={{this.size}}
        height={{this.size}}
      >
        <circle cx='8' cy='8' r='6.75' />
      </svg>
      {{#if (this.is @state 'done')}}
        <Check
          class='pretui-planmark-icon'
          width={{this.inner}}
          height={{this.inner}}
        />
      {{else if (this.is @state 'failed')}}
        <X
          class='pretui-planmark-icon'
          width={{this.inner}}
          height={{this.inner}}
        />
      {{else if (this.is @state 'skipped')}}
        <Minus
          class='pretui-planmark-icon'
          width={{this.inner}}
          height={{this.inner}}
        />
      {{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-planmark {
          position: relative;
          display: inline-grid;
          place-items: center;
          flex: none;
          color: var(--pretui-planmark-ink, var(--muted-foreground));
          vertical-align: -0.2em;
        }
        .pretui-planmark > * {
          grid-area: 1 / 1;
        }
        .pretui-planmark-ring {
          display: block;
          overflow: visible;
        }
        .pretui-planmark-ring circle {
          fill: none;
          stroke: currentColor;
          stroke-width: 1.25;
        }
        /* done and failed: a soft tint of the state behind a thin mark, the
           old glyph's weight in the new shape */
        .pretui-planmark[data-state='done'] {
          color: var(--success-ink);
        }
        .pretui-planmark[data-state='done'] .pretui-planmark-ring circle,
        .pretui-planmark[data-state='failed'] .pretui-planmark-ring circle {
          fill: color-mix(in oklch, currentColor 16%, transparent);
          stroke: color-mix(in oklch, currentColor 40%, transparent);
        }
        .pretui-planmark[data-state='done'] .pretui-planmark-icon,
        .pretui-planmark[data-state='failed'] .pretui-planmark-icon {
          stroke-width: 2.5;
        }
        .pretui-planmark[data-state='failed'] {
          color: var(--destructive-ink);
        }
        /* what comes next: a dashed circle, quieter */
        .pretui-planmark[data-state='next'] {
          color: var(--subtle-foreground);
        }
        .pretui-planmark[data-state='next'] .pretui-planmark-ring circle {
          stroke-dasharray: 2.2 2.3;
        }
        .pretui-planmark[data-state='skipped'] {
          color: var(--subtle-foreground);
        }
        .pretui-planmark[data-state='skipped'] .pretui-planmark-icon {
          stroke-width: 2.25;
        }
        .pretui-planmark[data-state='current'] {
          color: var(--success-ink);
        }
        /* under way: a ring with a gap that turns */
        .pretui-planmark[data-state='current'] .pretui-planmark-ring circle {
          stroke-width: 1.5;
          stroke-dasharray: 28 14.4;
          stroke-linecap: round;
        }
        .pretui-planmark[data-state='current'] .pretui-planmark-ring {
          animation: pretui-planmark-turn 1.4s linear infinite;
        }
        @keyframes pretui-planmark-turn {
          to {
            transform: rotate(1turn);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-planmark[data-state='current'] .pretui-planmark-ring {
            animation: none;
          }
        }
      }
    </style>
  </template>

  is = (a: string, b: string) => a === b;
}
