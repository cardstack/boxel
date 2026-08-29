import type { TOC } from '@ember/component/template-only';
import { CodeBox } from 'test-app/components/code-box';

const SCORE = `<Choreo class='dn-stage' as |c|>
  <span data-take={{this.take}} {{this.wire c}}></span>

  {{#each this.letters as |l|}}
    <span class='dn-l' {{motion id=l.key role='tile'}}>{{l.ch}}</span>
  {{/each}}

  <c.Sequence>
    <c.Gate />
    <c.Parallel>
      <c.Tween @of={{c.role 'tile'}} @x={{this.xs}} @y={{this.ys}}
               @duration={{SPAN}} @ease='linear' />
      <c.Tween @of={{c.role 'game'}} @opacity={{this.fadeGame}}
               @duration={{SPAN}} @ease='linear' />
    </c.Parallel>
  </c.Sequence>
</Choreo>`;

const KEYS = `// one array per property, one entry per stop. A property function is
// handed the sprite, so every tile answers with its own journey.
xs = (sprite) => seats.get(sprite.id).map((s) => s.x);
ys = (sprite) => seats.get(sprite.id).map((s) => s.y);

//            A–Z  Vowels  Bag  Points  Plot  Game
fadeVowels = [ 0,    1,     0,    0,     0,    0 ];
fadeBag    = [ 0,    0,     1,    0,     0,    0 ];
fadePoints = [ 0,    0,     0,    1,     1,    0 ];
fadeGame   = [ 0,    0,     0,    0,     0,    1 ];`;

const DRAW = `private draw() {
  const run = this.run;
  if (!run) return;
  if (run.parked) run.advance();   // open the head gate, once
  run.pause();
  // parked a hair short: a run that reaches its own duration is FINISHED,
  // and a finished run replays itself on any later render
  run.time = (this.p / LAST) * Math.max(0, run.duration - 0.001);
}`;

const SWAP = `// what this demo used to do, and why it is gone
private bracket() {
  if (this.pending) return;              // one swap in flight at a time
  if (this.p > hi) { this.stage += 1; this.pending = true; }
  else if (this.p < lo) { this.stage -= 1; this.pending = true; }
}`;

/**
 * Deep dive for the Density demo.
 */
const DensityNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>A gesture with a playhead in it</h2>
      <p class="dive-lede">
        Twenty-eight Scrabble tiles walk through six arrangements under your
        thumb. Not on release — during. The knob is not moving the tiles; it is
        moving a clock, and everything on screen is a consequence of where that
        clock is.
      </p>
    </header>

    <section class="dd">
      <h3>Why a layout animation cannot do this</h3>
      <div class="dd-col">
        <p>
          <code>layout={{true}}</code>
          is measure-and-fire. It snapshots the element's box, lets the class
          change, measures the new box, and animates the difference. It is an
          excellent way to animate a layout change, and it has exactly one
          input: the change itself.
        </p>
        <p>
          There is nowhere to hand it a progress. Measure the
          <a href="/sheet">Sheet</a>
          demo mid-drag and its tile is the same width for the whole pull, then
          its final width a frame after you let go. That is not a bug — it is
          the honest behaviour of a trigger. If you want a value
          <em>between</em>
          the two ends, something else has to hold it.
        </p>
        <p>
          A Choreo run holds one, because a run is a value with a clock on it:
          <code>pause()</code>, a settable
          <code>time</code>, and a seek that is a genuine random-access
          evaluation of every cue rather than a replay. A scrubbed frame is a
          computed still, so dragging backwards costs exactly what dragging
          forwards costs.
        </p>
      </div>
      <CodeBox @label="density.gts" @source={{DRAW}} />
    </section>

    <section class="dd">
      <h3>The wrong turn: one score per leg</h3>
      <div class="dd-col">
        <p>
          A score is compiled from a
          <strong>changeset</strong>, and a changeset has exactly two ends — the
          DOM as it was and the DOM as it is. Six arrangements therefore looks
          like five scores, with the host swapping to the neighbouring one each
          time the playhead crosses a stop. Two versions of this demo worked
          that way. Both were wrong, and the reasons are worth having in
          advance.
        </p>
        <p>
          Swapping needs a
          <em>render</em>, and a render is not instant. A thumb crosses a stop
          faster than the new score can compile, so the playhead and the loaded
          segment desynchronise; sweeping back and forth walked tiles to
          negative coordinates. Guarding it — one swap in flight at a time, the
          pointer proposing while the playhead advances only as fast as the
          score can follow — made it correct and still left a control that could
          not keep up with a fast hand.
        </p>
        <p>
          Worse, the swap happens
          <em>at a stop</em>, which is the pose the outgoing run is parked at by
          definition. A paused run is still holding — it keeps inline width and
          height on every sprite it owns — so the pass that compiled the next
          segment measured a held pose as its starting point. That one is a
          genuine gap in the library, and it is fixed (<code>Run.paused</code>,
          and the region's fast path declining while a run is held), but the
          demo no longer needs the fix.
        </p>
      </div>
      <CodeBox @label="what this used to be" @source={{SWAP}} />
    </section>

    <section class="dd">
      <h3>The turn that worked: one score, many waypoints</h3>
      <div class="dd-col">
        <p>
          None of it was necessary. A keyframe array is the from-and-to
          <em>and any waypoints</em>
          in one value — only springs are limited to two. Six stops per property
          is one score for the whole journey.
        </p>
        <p>
          What that buys is out of proportion to the size of the change. The DOM
          never changes: no pose classes, no re-render, no changeset to depend
          on. The region compiles exactly once and the knob scrubs its clock
          from end to end. Every geometry trap this repo has documented twice —
          a box positioned against its own animated size, a flow position that
          is the sum of animated siblings, an
          <code>fr</code>
          track floored by an item's inline width — is
          <em>structurally absent</em>, because there is no layout being
          measured out from under anything.
        </p>
      </div>
      <CodeBox @label="density.gts" @source={{SCORE}} />
      <div class="dd-col">
        <p>
          The property functions are where the arrangements live. Each is handed
          the sprite, so a tile answers with its own six seats; the furniture
          answers with one number per stop, which makes the whole schedule of
          what is being asserted readable as a table.
        </p>
      </div>
      <CodeBox @label="density.gts" @source={{KEYS}} />
    </section>

    <section class="dd">
      <h3>What you give up, and when to pay it</h3>
      <div class="dd-col">
        <p>
          The poses have to be
          <strong>arithmetic rather than stylesheet</strong>. Nothing can be
          measured out of a layout that is never rendered, so every seat is
          computed — from an index, a group, a rank, a frequency. That is a real
          cost: the stylesheet no longer owns the poses, and a designer cannot
          move a thing by editing CSS.
        </p>
        <p>
          So the rule is about which problem you have. Reach for
          <strong>a changeset</strong>
          when the poses are layouts you want the browser to compute — a list
          becoming a grid, a card becoming a form, anything where the stylesheet
          is the source of truth and there are two of them. Reach for
          <strong>keyframes</strong>
          when there are more than two poses, when a gesture owns the progress,
          or when the geometry is already data. Scrubbing more than two
          stylesheet-owned layouts is the case that has no good answer yet, and
          knowing that in advance is most of the value here.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Nothing is tracked, and that is the whole discipline</h3>
      <div class="dd-col">
        <p>
          A render inside a region is a
          <strong>pass</strong>. Assign a
          <code>@tracked</code>
          property from a
          <code>pointermove</code>
          and the region re-renders, throws away its score and compiles a new
          one — sixty times a second. The engine ships a circuit breaker that
          warns about exactly this, naming
          <code>onDrag</code>
          as the usual culprit.
        </p>
        <p>
          So the run lives in a plain field and is driven imperatively. The
          knob's position, the filled groove and the active stop's label are all
          written straight from the playhead every frame. The one tracked write
          in the component fires once after mount, changes nothing anyone can
          see, and exists only so the region has a pass to compile from —
          without it there is no changeset and no run at all.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Linear under the hand, curved when you let go</h3>
      <div class="dd-col">
        <p>
          Every step in the score is
          <code>@ease="linear"</code>, and every step is the same length. An
          ease is a statement about how something should feel over time, and
          under a finger there is no time to have an opinion about — the hand is
          already the curve. Bake one in and it composes on top of the hand, so
          the tiles lag and rush against a thumb moving at a constant speed.
        </p>
        <p>
          The curves arrive when the hand leaves, and which curve says what
          happened. A throw has momentum, so a spring spends it and the stop is
          chosen from where the throw was
          <em>going</em>
          rather than where the thumb stopped. A tap or an arrow key has no
          momentum to spend, so it gets
          <code>easeInOutQuint</code>
          instead — still, then quick, then a long settle. The knob is never
          animated separately; it is drawn from the playhead, so it rides
          whichever curve is in force by construction.
        </p>
        <p>
          And the rack has a detent: near a stop the playhead is pulled gently
          toward it, hardest when it is nearly there. Not a snap — every value
          in between is still reachable — but letting go near a stop lands dead
          centre. A rack with notches in it should feel like it has notches.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>The gate, and why the score does not simply play</h3>
      <div class="dd-col">
        <p>
          A run begins playing inside its constructor: everything at
          <em>t=0</em>
          starts now, synchronously. Every hook available to catch it afterwards
          runs too late — modifiers on a region's children fire before the
          region's own update, and even
          <code>afterSettle</code>
          landed after the score had played itself out and the last arrangement
          was on screen.
        </p>
        <p>
          <code>&lt;c.Gate /&gt;</code>
          at the head is a score's way of saying
          <em>do not start yet</em>. It parks the clock at zero before there is
          a frame to miss, and no code of ours has to win a race to do it. The
          first draw opens it once; everything after is an ordinary seek.
        </p>
      </div>
    </section>
  </section>
</template>;

export default DensityNotes;
export { DensityNotes };
