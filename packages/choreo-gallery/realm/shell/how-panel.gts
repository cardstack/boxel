import { Choreo } from '@cardstack/choreo';
import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { motion } from 'glimmer-motion';

import { highlightSample } from '../lib/highlight';
import { settings, toggleCode } from '../lib/tempo';
import { TRANSITION_CONTROL } from './pickers';

const TRANSITION_SAMPLE = `{{! Getting here was a crossing — Magic Move, in Keynote's terms, spoken by
    the timeline. The whole page is one <Choreo @route> region: the page
    swap is one render pass, and an id on both sides pairs the card's stage
    and type with the page's own. Nothing is snapshotted — real elements
    fly, so every demo keeps running through the move. }}
<Choreo @route={{true}} @scroll={{this.crossing.scrollIntent}} class='page' as |c|>
  <c.Parallel>
    {{! the canned crossing: LEAVES dissolve as the paired MOVES lift off,
        ARRIVES land near the settle — and only what a viewport can see
        animates, so twenty-five off-screen cards cost nothing. The
        crossfade carries COLOR, not transparency: the flying stage holds
        solid, tweening between its two effective colors, and the ground
        never leaks through mid-fade. }}
    <c.Crossing
      @duration={{0.9}} @ease={{EASE}}
      @leave={{0.38}} @arrive={{0.5}} @overlap={{0.18}} />

    {{! a special exit that is not a dissolve: the hero RISES out — and
        because a specific step names it, the generic leave yields it }}
    <c.Tween @of={{c.onstage (c.removed 'scene')}}
      @y={{array 0 -28}} @opacity={{array 1 0}} @duration={{0.38}} />

    {{! the code and the pager, which really can wait for the move to land }}
    <c.Tween @of={{c.onstage (c.inserted 'late')}}
      @opacity={{array 0 1}} @delay={{0.59}} @duration={{0.36}} />
  </c.Parallel>

  {{yield}}
</Choreo>`;

/** out of the control, unfolding as it comes */
const OPEN = { bounce: 0.14, visualDuration: 0.38 };
/** and back into it — no bounce on the way home, it is closing, not arriving */
const SHUT = { bounce: 0, visualDuration: 0.26 };

/**
 * The transition's own source, shown from the control that drives it.
 *
 * It lives in the chrome rather than on a page: the panel is about the page
 * transition, which is not any one demo's business, and a panel that is part
 * of a page is a panel the transition can take away.
 *
 * The flight is a <Choreo> and a beacon, not `layout=true`, because there is
 * no second element: the picker is a control, not the panel's former self.
 */
export class HowPanel extends Component {
  get open() {
    return settings.showCode;
  }

  get sample() {
    return highlightSample(TRANSITION_SAMPLE);
  }

  close = (event: Event) => {
    // it flies back into the control, so put the keyboard there too — the
    // panel is about to stop existing, and focus cannot be left on it
    let site = (event.currentTarget as Element).closest('[data-choreo-site]');
    toggleCode();
    site?.querySelector<HTMLElement>('[data-how-control] summary')?.focus();
  };

  <template>
    <div class='how-anchor'>
      <Choreo class='how-region' as |c|>
        {{#if this.open}}
          <section
            class='how'
            aria-label='How this works'
            {{motion id='how' role='how'}}
          >
            <header class='how-head'>
              <h2 class='how-title'>How this works</h2>
              <button
                type='button'
                class='how-close'
                {{on 'click' this.close}}
              >Close</button>
            </header>
            <p class='sample-label'>shell/site-frame.gts</p>
            <pre><code>{{this.sample}}</code></pre>
          </section>
        {{/if}}

        <c.Parallel>
          {{! out of the picker's box and down into its seat — and back into
            it on the way out, which is the same step with the ends swapped }}
          <c.Move
            @of={{c.inserted 'how'}}
            @from={{c.beacon TRANSITION_CONTROL}}
            @spring={{OPEN}}
          />
          <c.Move
            @of={{c.removed 'how'}}
            @to={{c.beacon TRANSITION_CONTROL}}
            @spring={{SHUT}}
          />
          {{! solid almost at once on the way in, so the growing box is never
            a ghost; gone before it lands on the way out }}
          <c.Tween
            @of={{c.inserted 'how'}}
            @opacity={{array 0 1}}
            @duration={{0.14}}
          />
          <c.Tween @of={{c.removed 'how'}} @opacity={{0}} @duration={{0.2}} />
        </c.Parallel>
      </Choreo>
    </div>
    <style scoped>
      /* Sticky under the top bar, with no height of its own: the panel stays
         beside its control while the card scrolls, without taking the host's
         viewport the way a fixed element would. */
      .how-anchor {
        position: sticky;
        top: 76px;
        z-index: 20;
        height: 0;
      }

      /* The REGION is the fixed frame, and it never moves or resizes: the
         panel is an ordinary block inside it, so when the flight animates
         width and height the box grows from a left edge that is standing
         still. */
      .how-region {
        position: absolute;
        top: 0;
        right: 24px;
        width: min(720px, calc(100% - 48px));
        /* a coordinate space, not a surface — only the panel takes clicks */
        pointer-events: none;
      }

      .how {
        display: flex;
        flex-direction: column;
        max-height: min(68vh, 620px);
        /* it arrives as a box the size of the picker and unfolds; whatever
           does not fit yet is simply not shown yet */
        overflow: hidden;
        border: 1px solid rgba(255, 59, 31, 0.28);
        border-radius: 18px;
        background: var(--bg-well);
        box-shadow:
          0 28px 70px rgba(0, 0, 0, 0.62),
          0 2px 0 rgba(255, 255, 255, 0.03) inset;
        pointer-events: auto;
      }

      .how-head,
      .sample-label {
        /* never squeezed by the growing box */
        flex: none;
      }

      .how-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 16px 12px;
        border-bottom: 1px solid var(--line);
      }

      .how-title {
        margin: 0;
        font-family: var(--font-display);
        font-size: 15px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--ink);
        white-space: nowrap;
      }

      .how-close {
        padding: 5px 12px;
        border: 1px solid var(--line-strong);
        border-radius: 999px;
        background: none;
        color: var(--ink-faint);
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        cursor: pointer;
        transition:
          color 140ms ease,
          border-color 140ms ease;
      }

      @media (hover: hover) {
        .how-close:hover {
          color: var(--copper-ink);
          border-color: var(--copper);
        }
      }

      .sample-label {
        margin: 0;
        padding: 10px 16px 0;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--copper-ink);
      }

      pre {
        flex: 1 1 auto;
        /* a flex child will not scroll while it is still allowed to be as
           tall as its content */
        min-height: 0;
        margin: 0;
        padding: 12px 16px 16px;
        overflow: auto;
        /* the panel is shorter than the sample: fade the cut line so the
           edge reads as "there is more" */
        mask-image: linear-gradient(
          to bottom,
          #000 calc(100% - 28px),
          transparent
        );
      }

      code {
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 1.55;
        color: var(--ink);
        white-space: pre;
        -webkit-user-select: text;
        user-select: text;
      }

      @media (max-width: 720px) {
        .how-anchor {
          top: 64px;
        }

        .how-region {
          right: 12px;
          left: 12px;
          width: auto;
        }

        .how {
          max-height: 74vh;
        }

        .how-head {
          padding: 12px 14px 10px;
        }
      }
    </style>
  </template>
}
