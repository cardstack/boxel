import type { TOC } from '@ember/component/template-only';
import { CodeBox } from 'test-app/components/code-box';

const SCORE = `<c.Sequence>
  <c.Tween @name='b1' @of={{c.id 'plate'}} … />
  <c.Tween @name='b2' @at={{at 'b1'}} @delay={{0.14}} … />
  <c.Tween @name='b3' @at={{after 'b2'}} … />
</c.Sequence>`;

const EFFECT = `{{! Pop: a scale through backOut, opacity leading early }}
<c.Tween
  @opacity={{array 0 1 1 1}}
  @scale={{array 0 1}}
  @ease='backOut'
  @duration={{secondsOf build.ms}}
/>`;

const DELIVERY = `<c.Tween
  @of={{c.id 'word'}}
  @by='character'
  @opacity={{array 0 1 1}} @scale={{array 0.78 1}} @y={{array 18 0}}
  @duration={{0.76}}
/>`;

const TRANSPORT = `scrub = (event) => {
  this.held = true;          // a hand has claimed the clock
  run.pause();
  run.time = Number(event.target.value);
};`;

const ADOPT = `// any pass replaces the run; the new one resumes where the old stood
const target = this.reseek ?? this.t;
if (target > 0 && target < run.duration) {
  run.time = target;
}`;

const READER = `// NOT tracked, and that is load-bearing: the region's render
// detector re-runs on EVERY render, so a tracked value written at
// 60fps would replay the pass at 60fps — cancelling the run it is
// trying to watch. The clock and the range are written by hand.
private t = 0;
private paint() {
  this.clockEl.textContent = \`\${this.t.toFixed(2)} …\`;
  this.rangeEl.value = String(this.t);
}`;

const COSTUME = `// deliver.ts — the split is a costume, and a costume must not
// change the body's shape: whitespace the container was COLLAPSING
// (a template's newline and indentation are real text nodes) would
// take width as \`pre\` spans, and a newline would become a hard break.
const ws = getComputedStyle(el).whiteSpace;
const collapsing = ws === 'normal' || ws === 'nowrap' || ws === 'pre-line';`;

/**
 * Deep dive for the Build Order demo.
 */
const BuildOrderNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>A score, not a timeline</h2>
      <p class="dive-lede">
        Nobody sketching a logo animation writes “the ring finishes at 880ms.”
        They write
        <em>the ring draws</em>,
        <em>the mark pops with it</em>,
        <em>the wordmark comes after</em>. This stage takes that sentence
        literally — the score is written in the template, every start time you
        see is resolved by the compiler from two words and a number, and there
        is nowhere in the demo that a time is typed by hand.
      </p>
    </header>

    <section class="dd">
      <p class="dd-fn">@name · at() · after()<span>the score</span></p>
      <h3>With and after are anchors</h3>
      <div class="dd-col">
        <p>
          A build names a part, an effect, a duration — and a relation to the
          build above it.
          <b>With</b>
          is
          <code>@at={{"{{at 'b3'}}"}}</code>
          — start where build 3 started;
          <b>after</b>
          is
          <code>@at={{"{{after 'b3'}}"}}</code>
          — start where it ended. A delay, in either case, is added on top.
          Build 1 is the exception: with nothing above it, its Start is
          Keynote’s own “On Click” — the sequence’s natural flow, the run’s own
          zero.
        </p>
      </div>
      <CodeBox @label="build-order.gts" @source={{SCORE}} />
      <div class="dd-col">
        <p>
          Because the relation always points at the
          <em>previous</em>
          build, moving one build moves everything under it. Switch build 6
          from After to With in the inspector and every start time downstream
          recomputes — nothing had to be re-typed, because nothing was ever a
          timecode to begin with. An anchored step is lifted out of the
          sequence’s flow, and its end still counts toward the run’s length:
          the compiler’s runtime is a
          <code>max</code>, not a last.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 260"
          role="img"
          aria-label="Three lanes on a timeline. Build 2 hangs from build 1's
            start, marked with. Build 3 hangs from build 2's end, marked
            after, offset by a delay."
        >
          <text class="dg-eb" x="20" y="24">THE RESOLVED TIMELINE</text>

          <line class="dg-rule" x1="20" y1="230" x2="880" y2="230" />

          <rect class="dg-box" x="20" y="50" width="220" height="30" rx="6" />
          <text class="dg-t" x="34" y="70">1 · Plate — Move In</text>

          <rect class="dg-hot" x="20" y="100" width="330" height="30" rx="6" />
          <text class="dg-t is-hot" x="34" y="120">2 · Tail — Line Draw</text>
          <text class="dg-t is-faint" x="20" y="94">with build 1</text>

          <rect class="dg-box" x="350" y="150" width="280" height="30" rx="6" />
          <text class="dg-t" x="364" y="170">3 · Head — Line Draw</text>
          <text class="dg-t is-faint" x="350" y="144">after build 2, +0ms</text>

          <g class="dg-hair dg-dash">
            <line x1="20" y1="50" x2="20" y2="230" />
            <line x1="350" y1="100" x2="350" y2="230" />
          </g>
          <circle class="dg-dot" cx="20" cy="230" r="4.5" />
          <circle class="dg-dot" cx="350" cy="230" r="4.5" />

          <text class="dg-t is-faint" x="20" y="250" text-anchor="middle">0 ms</text>
          <text class="dg-t is-faint" x="350" y="250" text-anchor="middle">build
            2 ends</text>

          <text class="dg-t is-dim" x="360" y="200">with hangs from a START ·
            after hangs from an END</text>
        </svg>
        <figcaption>
          The faint vertical lines in the demo’s own transport are drawn from
          exactly this: a tick at the moment each build was timed against. The
          bars themselves are read back from
          <code>run.cues</code>
          — the compiler’s resolved answer, never a second copy.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <p class="dd-fn">keyframe values<span>the effects</span></p>
      <h3>An effect is keyframes and an easing</h3>
      <div class="dd-col">
        <p>
          There is no effects engine. Pop is a scale through
          <code>backOut</code>; Line Draw is
          <code>@pathLength</code>
          from 0 to 1; Wipe is two
          <code>inset()</code>
          clip frames. The leading opacity frames are Keynote’s “builds in”
          made of arithmetic: a keyframe array’s
          <em>first</em>
          value is pinned onto the part from the run’s very start, so a build
          that begins at 2.1s sits hidden — at its own first frame — until its
          window opens.
        </p>
      </div>
      <CodeBox @label="build-order.gts" @source={{EFFECT}} />
      <div class="dd-col">
        <p>
          That pin is also why every effect here states both ends of its
          journey. An effect that only named its destination would inherit
          whatever the part was doing before — and a build order is a
          statement about the whole journey, not a nudge toward a target.
        </p>
      </div>
    </section>

    <section class="dd">
      <p class="dd-fn">@by='character'<span>delivery</span></p>
      <h3>Delivery is a second timeline, inside the first</h3>
      <div class="dd-col">
        <p>
          Set a text build’s Delivery to By Character and the wordmark does not
          simply fade in as one block — every glyph gets its own turn, and the
          library does the splitting: the sprite’s own text nodes are lifted
          out whole, stand-in spans deliver the animation, and the restore puts
          Glimmer’s own nodes back exactly where they were. The build still
          owns its stated window; each cell gets 55% of it, starts spread so
          the
          <em>last</em>
          cell finishes exactly on the build’s own end.
        </p>
      </div>
      <CodeBox @label="build-order.gts" @source={{DELIVERY}} />
      <div class="dd-col">
        <p>
          The split taught this page a lesson worth keeping: a costume must not
          change the body’s shape. A template’s newline and indentation are
          real text nodes, and stand-in spans wear
          <code>white-space: pre</code>
          — so whitespace the container had been collapsing suddenly took
          width, and the whole line jumped aside for its own delivery. The
          split now collapses the way the element’s computed style does.
        </p>
      </div>
      <CodeBox @label="glimmer-motion" @source={{COSTUME}} />
    </section>

    <section class="dd">
      <p class="dd-fn">c.run<span>the transport</span></p>
      <h3>The transport holds the run</h3>
      <div class="dd-col">
        <p>
          Play, pause and the scrubber are not three code paths — they are
          <code>run.play()</code>,
          <code>run.pause()</code>
          and
          <code>run.time = t</code>
          on the library’s own clock.
          <code>time</code>
          is settable in either direction, and a scrubbed frame is a
          <em>computed still</em>: the run retires its animations and stands
          every value exactly where the score says t looks like, no memory of
          the frame before.
        </p>
      </div>
      <CodeBox @label="build-order.gts" @source={{TRANSPORT}} />
      <div class="dd-modes">
        <div class="dd-mode">
          <span class="dd-tag">playing</span>
          <b>The run drives</b>
          <p>Its master clock crosses cues and the platform plays them —
            plain tweens accelerate onto WAAPI, off the main thread.</p>
        </div>
        <div class="dd-mode">
          <span class="dd-tag">scrubbing</span>
          <b>A hand drives</b>
          <p>Dragging the range pauses the run and marks it
            <em>held</em>, so scrolling the card away and back cannot quietly
            restart what a hand stopped.</p>
        </div>
        <div class="dd-mode">
          <span class="dd-tag">off-screen</span>
          <b>Nobody drives</b>
          <p>An IntersectionObserver pauses playback below 35% visible and
            resumes it on return — unless a hand paused it first.</p>
        </div>
      </div>
    </section>

    <section class="dd">
      <p class="dd-fn">edit()<span>build-order.gts</span></p>
      <h3>The score is editable while it runs</h3>
      <div class="dd-col">
        <p>
          The inspector does not stage changes for the next play — it replaces
          the build, the steps re-render, and the region replays its pass
          against the new schedule. The transport then adopts the new run and
          puts it back at the
          <em>same</em>
          t: retiming build 2 while parked at 1.4s shows you what 1.4s now
          looks like, immediately.
        </p>
      </div>
      <CodeBox @label="build-order.gts" @source={{ADOPT}} />
      <div class="dd-col">
        <p>
          Continuity is the rule, not the exception. Any pass replaces the run
          — an edit, the loop’s next take, an unrelated render — and the new
          run resumes where the old one stood. Only a run that had actually
          finished starts its successor from zero, which is the loop coming
          round.
        </p>
      </div>
    </section>

    <section class="dd">
      <p class="dd-fn">the reader<span>build-order.gts</span></p>
      <h3>A transport is a reader, not a clock</h3>
      <div class="dd-col">
        <p>
          The one real discipline in this file: the playhead readouts are
          <em>not</em>
          tracked state. A region re-snapshots on every render — that is what
          makes it a region — so a tracked value written sixty times a second
          would replay the pass sixty times a second, each pass cancelling the
          run the transport was trying to watch. The first draft of this page
          did exactly that, and the symptom was spectacular: a timeline whose
          clock crawled at a fiftieth of real time while the canvas stayed
          empty, every run dying in infancy.
        </p>
      </div>
      <CodeBox @label="build-order.gts" @source={{READER}} />
      <div class="dd-col">
        <p>
          So the clock text, the range’s value and the playhead’s position are
          written imperatively on the transport’s own frame, and the only
          tracked writes left are the rare ones — an edit, a loop take, a
          press of play. It is the same lesson every demo with a per-frame
          value has to learn once: Glimmer’s render loop and an animation’s
          frame loop are different clocks, and state that belongs to the
          second must not be phrased in the first.
        </p>
      </div>
    </section>
  </section>
</template>;

export default BuildOrderNotes;
export { BuildOrderNotes };
