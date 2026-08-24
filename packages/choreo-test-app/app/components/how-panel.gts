import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { Choreo, motion } from 'glimmer-motion';
import { highlightSample } from 'test-app/lib/highlight';
import { settings, toggleCode } from 'test-app/lib/tempo';

const TRANSITION_SAMPLE = `// Getting here was a shared-element transition — Magic Move, in Keynote's
// terms. Three kinds of thing, and telling them apart is the whole trick.
import { animateView } from 'glimmer-motion';

animateView(async () => {
  await transition.retry();      // the route swaps INSIDE the snapshot
  window.scrollTo(0, 0);         // and so does the scroll, so the second
})                               // capture is taken where the page will sit

  // MOVES — the same object in both scenes. .add(old, new) pairs two
  // DIFFERENT elements under one name, so they become one layer that travels.
  .add(cardStageSelector, '.stage-wrap')
  .class('gm-move gm-stage')
  .crop(false)                   // cover would clip whatever changes aspect
  .group(false)                  // and nesting would clip it to the card
  .layout({ duration: 0.42 })
  .new({ opacity: [0, 1] }, { duration: 0.14 })   // solid early…
  .old({ opacity: [1, 0] }, { duration: 0.26 })   // …so the pair never dips

  // LEAVES — only in the old scene. It goes first, to make room.
  .add('.grid').exit({ opacity: [1, 0] }, { duration: 0.14 })

  // ARRIVES — only in the new scene. It waits for the move to be nearly home.
  .add('.sample').enter({ opacity: [0, 1], y: [12, 0] }, { delay: 0.26 });

/* Both renderings are then stretched into the SAME box and crossed inside it,
   because glyphs cannot morph into other glyphs, and a small stage cannot
   morph into a bigger one — but one box can hold both while it grows: */
::view-transition-old(.gm-move),
::view-transition-new(.gm-move) { width: 100%; height: 100%; object-fit: fill; }

/* And the grain steps aside for the duration. A noise field is the one thing
   on the page a compositor cannot carry — it does not scale or blend, it just
   changes — so it leaves before the morph and returns after it. */
html.is-crossing::before { opacity: 0; }`;

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
          <p class="sample-label">routes/application.ts</p>
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
          @opacity={{1}}
          @from={{hash opacity=0}}
          @ms={{140}}
        />
        <c.Tween @of={{c.removed "how"}} @opacity={{0}} @ms={{200}} />
      </c.Parallel>
    </Choreo>
  </template>
}

export default HowPanel;
