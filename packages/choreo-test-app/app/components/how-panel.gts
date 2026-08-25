import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { Choreo, motion } from 'glimmer-motion';
import { highlightSample } from 'test-app/lib/highlight';
import { settings, toggleCode } from 'test-app/lib/tempo';

const TRANSITION_SAMPLE = `{{! Getting here was a crossing — Magic Move, in Keynote's terms, spoken by
    the timeline. The whole page is one <Choreo @route> region: the route
    swap is one render pass, and an id on both sides pairs the card's stage
    and type with the page's own. Nothing is snapshotted — real elements
    fly, so every demo keeps running through the move. }}
<Choreo @route={{true}} @scroll={{scrollIntent}} class='page' as |c|>
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

  {{outlet}}
</Choreo>`;

/** out of the control, unfolding as it comes */
const OPEN = { bounce: 0.14, visualDuration: 0.38 };
/** and back into it — no bounce on the way home, it is closing, not arriving */
const SHUT = { bounce: 0, visualDuration: 0.26 };

/**
 * The transition's own source, shown from the control that drives it.
 *
 * It lives in the chrome rather than on a page for two reasons. The panel is
 * about the ROUTE transition, which is not any one demo's business — and a
 * panel that is part of a page is a panel the route can take away, which is
 * why the back button used to reveal it uninvited.
 *
 * The flight is a <Choreo> and a beacon, not `layout=true`, because there is
 * no second element: the select is a control, not the panel's former self.
 * A beacon is a point to borrow — the select never moves, never joins the
 * changeset, and never becomes half of a shared element that would stretch.
 */
export class HowPanel extends Component {
  get open() {
    return settings.showCode;
  }

  get sample() {
    return highlightSample(TRANSITION_SAMPLE);
  }

  close = () => {
    toggleCode();
    // it flies back into the control, so put the keyboard there too — the
    // panel is about to stop existing, and focus cannot be left on it
    document.querySelector<HTMLSelectElement>('.tempo-select')?.focus();
  };

  <template>
    <Choreo class="how-region" as |c|>
      {{#if this.open}}
        <section
          class="how"
          aria-label="How this works"
          {{motion id="how" role="how"}}
        >
          <header class="how-head">
            <h2 class="how-title">How this works</h2>
            <button
              type="button"
              class="how-close"
              {{on "click" this.close}}
            >Close</button>
          </header>
          <p class="sample-label">templates/application.gts</p>
          <pre><code>{{this.sample}}</code></pre>
        </section>
      {{/if}}

      <c.Parallel>
        {{! out of the select's box and down into its seat — and back into it
            on the way out, which is the same step with the ends swapped }}
        <c.Move
          @of={{c.inserted "how"}}
          @from={{c.beacon "transition-control"}}
          @spring={{OPEN}}
        />
        <c.Move
          @of={{c.removed "how"}}
          @to={{c.beacon "transition-control"}}
          @spring={{SHUT}}
        />
        {{! solid almost at once on the way in, so the growing box is never a
            ghost; gone before it lands on the way out, so it does not sit on
            the control it is returning to }}
        <c.Tween
          @of={{c.inserted "how"}}
          @opacity={{array 0 1}}
          @duration={{0.14}}
        />
        <c.Tween @of={{c.removed "how"}} @opacity={{0}} @duration={{0.2}} />
      </c.Parallel>
    </Choreo>
  </template>
}

export default HowPanel;
