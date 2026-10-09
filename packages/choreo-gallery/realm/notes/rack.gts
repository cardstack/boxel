import type { TOC } from '@ember/component/template-only';

import { CodeBox } from '../shell/code-box';

const SEATS = `// One entry per stop, in order. A property function is handed the sprite,
// so every participant answers with its own journey through the same stops.
const seats = new Map([
  ['e', [{x: 189, y: 62}, {x: 44, y: 44}, /* …one per stop… */]],
  // …
]);

xs = (sprite) => seats.get(sprite.id).map((s) => s.x);
ys = (sprite) => seats.get(sprite.id).map((s) => s.y);`;

const SCORE = `<Choreo class='rk-stage' as |c|>
  <span data-take={{this.take}} {{this.wire c}}></span>

  {{#each this.letters as |l|}}
    <span class='rk-l' {{motion id=l.key role='tile'}}>{{l.ch}}</span>
  {{/each}}
  <span class='rk-grid' {{motion id='grid' role='game'}}></span>

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

const SCHEDULE = `//            A–Z  Vowels  Bag  Points  Plot  Game
fadeVowels = [ 0,    1,     0,    0,     0,    0 ];
fadeBag    = [ 0,    0,     1,    0,     0,    0 ];
fadePoints = [ 0,    0,     0,    1,     1,    0 ];
fadePlot   = [ 0,    0,     0,    0,     1,    0 ];
fadeGame   = [ 0,    0,     0,    0,     0,    1 ];
fadeBlank  = [ 1,    1,     1,    1,     0,    0 ];`;

const DRIVE = `private draw() {
  const run = this.run;
  if (!run) return;
  if (run.parked) run.advance();   // open the head gate, once
  run.pause();
  // parked a hair short: a run that reaches its own duration is FINISHED,
  // and a finished run replays itself on any later render
  run.time = (this.p / LAST) * Math.max(0, run.duration - 0.001);
}`;

const OPEN = `// A region compiles a score from a PASS, and a pass is a render that
// changes something inside it. If your DOM never changes, nothing ever
// compiles — so bump a counter once, after mount.
@tracked private take = 0;

mount = modifier(() => {
  const id = requestAnimationFrame(() => (this.take = 1));
  return () => cancelAnimationFrame(id);
});`;

/**
 * Deep dive for the Rack demo: keyframes as a multi-pose, scrubbable score.
 */
const RackNotes: TOC<object> = <template>
  <section class='dive' aria-label='How it works'>
    <header class='dive-head'>
      <p class='dive-kicker'>How it works</p>
      <h2>Keyframes for animation too complex to be a transition</h2>
      <p class='dive-lede'>
        Most layout animation is a transition: two poses, and something to move
        between them. When there are six poses and a hand owns the progress,
        that model runs out. This is the one that replaces it — a single score
        whose keyframes carry every pose, and a clock you can scrub.
      </p>
    </header>

    <section class='dd'>
      <h3>A keyframe array is a path, not a from-and-to</h3>
      <div class='dd-col'>
        <p>
          The rule that makes everything else possible:
          <strong>a keyframe array is the from-and-to and any waypoints, in one
            value</strong>. Only springs are limited to two.
          <code>@opacity=\{{array 0 1}}</code>
          is the degenerate case of
          <code>@opacity=\{{array 0 0 1 1 0}}</code>.
        </p>
        <p>
          So N poses is not N−1 animations. It is one animation with N stops,
          and the stops are distributed evenly along the step's duration — stop
          <em>i</em>
          lands exactly at
          <code>i / (N-1)</code>
          of the way through. That is what makes a playhead meaningful: a whole
          number on your own scale maps to a stop on the score's.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>One array per property, one entry per stop</h3>
      <div class='dd-col'>
        <p>
          Give every property its own array and keep them all the same length. A
          property function is handed the sprite, so a shared score can still
          give each participant a different journey — look the sprite up by id
          and return its own list of seats.
        </p>
      </div>
      <CodeBox @label='rack.gts' @source={{SEATS}} />
      <div class='dd-col'>
        <p>
          Do the same for anything that should only exist during part of the
          journey. Written as one number per stop, the opacity schedules line up
          into a table you can read down a column — which is the whole argument
          of the piece, in a form you can check.
        </p>
      </div>
      <CodeBox @label='rack.gts' @source={{SCHEDULE}} />
      <div class='dd-col'>
        <p>
          Nothing is added or removed on the way. A changeset that gains a
          participant mid-gesture is a different kind of pass; everything that
          will ever appear is in the markup from the start and rides an opacity
          schedule instead.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>The score, and the gate at its head</h3>
      <div class='dd-col'>
        <p>
          A run starts playing inside its own constructor — everything at
          <em>t=0</em>
          begins synchronously — and every hook you might catch it with runs too
          late. Modifiers on a region's children fire before the region's own
          update; even
          <code>afterSettle</code>
          lands after the score has played through.
        </p>
        <p>
          <code>&lt;c.Gate /&gt;</code>
          at the head is the score's own way of saying
          <em>do not start yet</em>. It parks the clock at zero before there is
          a frame to miss. Open it once, on the first draw; everything after
          that is an ordinary seek.
        </p>
      </div>
      <CodeBox @label='rack.gts' @source={{SCORE}} />
    </section>

    <section class='dd'>
      <h3>Driving it: the gesture writes the clock</h3>
      <div class='dd-col'>
        <p>
          A run is a value with a clock on it:
          <code>pause()</code>, a settable
          <code>time</code>, and a seek that genuinely re-evaluates every cue
          rather than replaying. A scrubbed frame is a computed still, so
          dragging backwards costs exactly what dragging forwards costs.
        </p>
        <p>
          Map your control's range onto the run's duration and write it every
          frame. The one trap: never let the clock reach the duration. A
          finished run replays itself on any later render, so park a millisecond
          short and it never retires.
        </p>
      </div>
      <CodeBox @label='rack.gts' @source={{DRIVE}} />
    </section>

    <section class='dd'>
      <h3>Give the region a pass to compile from</h3>
      <div class='dd-col'>
        <p>
          The catch of a DOM that never changes: a region compiles from a
          <strong>pass</strong>, and a pass is a render that changes something
          inside it. Left alone there is nothing to react to and no run is ever
          built. One bump of a counter after mount is enough — it changes
          nothing anyone can see, and the gate holds the score still the moment
          it exists.
        </p>
      </div>
      <CodeBox @label='rack.gts' @source={{OPEN}} />
    </section>

    <section class='dd'>
      <h3>Nothing else may be tracked</h3>
      <div class='dd-col'>
        <p>
          A render inside a region is a
          <strong>pass</strong>. Assign a
          <code>@tracked</code>
          property from a
          <code>pointermove</code>
          and the region re-renders, discards its score and compiles a new one —
          sixty times a second. The engine ships a circuit breaker that warns
          about exactly this, naming
          <code>onDrag</code>
          as the usual culprit.
        </p>
        <p>
          So hold the run in a plain field and drive it imperatively. Anything
          the control needs to show — a knob's position, a filled groove, which
          label is active — is written straight from the playhead each frame
          rather than rendered from state. Write classes and custom properties,
          not tracked values.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Linear under the hand; the curve arrives on release</h3>
      <div class='dd-col'>
        <p>
          Make every step
          <code>@ease="linear"</code>
          and the same length. An ease says how something should feel over time,
          and under a finger there is no time to have an opinion about — the
          hand is already the curve. Bake one in and it composes on top of the
          hand, so things lag and rush against a thumb moving at a constant
          speed.
        </p>
        <p>
          The curves belong to the release, and which curve you use says what
          happened. A throw has momentum: spend it with a spring, and choose the
          destination from where the throw was
          <em>going</em>
          rather than where the thumb stopped. A tap or an arrow key has no
          momentum, so it gets an ease instead — here
          <code>easeInOutQuint</code>, which reads as deliberate. Drive the same
          playhead in both cases and every driven value inherits the right feel
          for free.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>When to reach for this, and when not to</h3>
      <div class='dd-col'>
        <p>
          The price is that poses must be
          <strong>arithmetic rather than stylesheet</strong>. Nothing can be
          measured out of a layout that is never rendered, so every position is
          computed. The stylesheet stops owning the poses, and a designer cannot
          move something by editing CSS.
        </p>
        <p>
          What you get back is proportional. Because the geometry is stated
          rather than measured, the whole family of layout-animation traps
          cannot arise: no box positioned against its own animated size, no flow
          position that is the sum of animated siblings, no
          <code>fr</code>
          track floored by an item's inline width. There is no layout being
          measured out from under anything.
        </p>
        <p>
          So: reach for
          <strong>a changeset</strong>
          when the poses are layouts you want the browser to compute — a list
          becoming a grid, a card becoming a form, anything where the stylesheet
          is the source of truth and there are two of them. Reach for
          <strong>keyframes</strong>
          when there are more than two poses, when a gesture owns the progress,
          or when the geometry is already data. Scrubbing more than two
          stylesheet-owned layouts is the case that has no good answer yet —
          worth knowing before you design around it.
        </p>
      </div>
    </section>
  </section>
</template>;

export default RackNotes;
