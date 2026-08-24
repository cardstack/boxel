import type { TOC } from '@ember/component/template-only';
import { CodeBox } from 'test-app/components/code-box';

const SCHEDULE = `builds.forEach((build, i) => {
  const base = i === 0 ? 0
    : build.start === 'with' ? prevAt : prevEnd;
  const at = Math.max(0, base + build.delay);
  cues.push({ ...build, at, end: at + build.ms, no: i + 1 });
  prevAt = at;
  prevEnd = at + build.ms;
});`;

const POSE_AT = `export function poseAt(t, cue, slot) {
  const effect = EFFECTS[cue.effect];
  const span = windowOf(cue, slot);
  const raw = span.ms <= 0 ? (t >= span.at ? 1 : 0)
    : (t - span.at) / span.ms;
  const p = raw <= 0 ? 0 : raw >= 1 ? 1 : effect.ease(raw);
  return { ...NEUTRAL, ...effect.at(p) };
}`;

const WINDOW_OF = `export function windowOf(cue, slot) {
  if (slot.n <= 1 || cue.ms <= 0) return { at: cue.at, ms: cue.ms };
  const ms = cue.ms * 0.55;
  return { at: cue.at + (slot.i * (cue.ms - ms)) / (slot.n - 1), ms };
}`;

const EFFECTS_SNIPPET = `draw: {
  at: (p) => ({ opacity: p > 0 ? 1 : 0, pathLength: p }),
  ease: easeInAndOut,
  on: ['stroke'],
},
pop: {
  at: (p) => ({ opacity: min(1, p * 3), scale: p }),
  ease: backOut,           // overshoots past 1, settles — a curve, not physics
  on: ['box', 'shape', 'text'],
},`;

const PAINT = `private paint = () => {
  const t = this.t;
  for (const cue of this.cues) {
    const list = this.tracks.get(cue.part);
    for (let i = 0; i < list.length; i += 1) {
      list[i].jump(poseAt(t, cue, slotOf(flat[i], cue.by, totals)));
    }
  }
};`;

const TRACK_JUMP = `jump(pose) {
  const was = this.was;
  if (!was || was.opacity !== pose.opacity) this.o.jump(pose.opacity);
  if (!was || was.scale !== pose.scale) this.sc.jump(pose.scale);
  // …one comparison per property, and most cells sit parked at either
  // end of their build for most of the run
  this.was = pose;
}`;

const EDIT = `private edit(patch) {
  this.builds = this.builds.map((build, i) =>
    i === this.pick ? { ...build, ...patch } : build
  );
  this.paint();   // repainted at the SAME t, against the new schedule
}`;

const PATH_SPACING = `// Motion renders a drawn path as stroke-dasharray: length spacing.
// The default spacing of 1 makes the pattern sum to ~1 near a drawn
// length of 0 — which wraps a zero-length dash onto the path's own
// terminus, and a round linecap paints that dash as a dot.
this.style['pathSpacing'] = motionValue(2);   // a whole path away, always`;

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
        literally — every start time you see is a consequence of two words and a
        number, resolved against the build above it. There is nowhere in the
        code that a time is typed by hand.
      </p>
    </header>

    <section class="dd">
      <p class="dd-fn">schedule()<span>lib/builds.ts</span></p>
      <h3>With and after are the whole scheduler</h3>
      <div class="dd-col">
        <p>
          A build names a part, an effect, a duration — and a relation to the
          build above it.
          <b>With</b>
          starts it the moment that build started;
          <b>after</b>
          waits for that build to finish. A delay, in either case, is added on
          top. Build 1 is the exception: with nothing above it, its Start is
          Keynote’s own “On Click” — the run’s own zero.
        </p>
      </div>
      <CodeBox @label="lib/builds.ts" @source={{SCHEDULE}} />
      <div class="dd-col">
        <p>
          Because the relation always points at the
          <em>previous</em>
          build, moving one build moves everything under it. Switch build 6 from
          After to With in the inspector and every start time downstream
          recomputes — nothing had to be re-typed, because nothing was ever a
          timecode to begin with.
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
          exactly this: a tick at the moment each build was timed against.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <p class="dd-fn">poseAt(t, cue, slot)<span>lib/builds.ts</span></p>
      <h3>A build is a window, not a spring</h3>
      <div class="dd-col">
        <p>
          Give it a time and a cue and it returns a pose — opacity, scale,
          position, blur, how much of a stroke is drawn — with no memory of the
          frame before. Progress through the build’s window is computed, clamped
          to 0–1, eased, and handed to the effect. Nothing is measured and
          nothing is read off the DOM.
        </p>
      </div>
      <CodeBox @label="lib/builds.ts" @source={{POSE_AT}} />
      <div class="dd-col">
        <p>
          That is also the whole reason there are no springs on this stage. A
          spring is defined by its physics — stiffness, damping, a settle — not
          by a duration; asking one “where will you be at 620ms” is not a
          question it can answer without you also telling it when to stop
          pretending to bounce. A build has to have an
          <em>end</em>, because the next build’s delay is measured from it, so
          every effect here is an easing across a stated window instead. Pop’s
          overshoot is a hand-drawn back-out curve doing a spring’s job.
        </p>
      </div>
      <CodeBox @label="lib/builds.ts" @source={{EFFECTS_SNIPPET}} />
    </section>

    <section class="dd">
      <p class="dd-fn">windowOf(cue, slot)<span>lib/builds.ts</span></p>
      <h3>Delivery is a second timeline, inside the first</h3>
      <div class="dd-col">
        <p>
          Set a text build’s Delivery to By Character and the wordmark does not
          simply fade in as one block — every glyph gets its own turn. That turn
          is a slice of the
          <em>same</em>
          window the build already owns: a build that runs 760ms still runs
          760ms end to end, whether it has one cell or seven.
        </p>
        <p>
          Each cell gets 55% of the build’s length, and the starts are spread
          across what is left so the
          <em>last</em>
          cell finishes exactly on the build’s own end — not starts there. Get
          that backwards and “duration” means something different for a
          staggered build than a plain one, and the bar drawn on the transport
          becomes a lie about when the build actually finishes.
        </p>
      </div>
      <CodeBox @label="lib/builds.ts" @source={{WINDOW_OF}} />
      <div class="dd-col">
        <p>
          It is the with/after arithmetic one level down, which is the honest
          reason this demo is about
          <em>choreography</em>
          rather than about eight animations that happen to be numbered — a
          build order that can schedule inside a build the same way it schedules
          between builds.
        </p>
      </div>
    </section>

    <section class="dd">
      <p class="dd-fn">paint()<span>build-order.gts</span></p>
      <h3>One pass, every frame, no re-render</h3>
      <div class="dd-col">
        <p>
          Every build is walked once a frame; every cell in it gets a pose from
          <code>poseAt</code>. Nothing here triggers a Glimmer re-render — the
          pose is written straight onto a set of Motion values, the same way the
          Playhead demo’s hand is, because thirty-odd cells doing that sixty
          times a second is not a re-render’s budget.
        </p>
      </div>
      <CodeBox @label="build-order.gts" @source={{PAINT}} />
      <div class="dd-col">
        <p>
          Each value only writes when it actually changed since the last frame —
          for most of a run, most cells are parked at either end of their own
          build, sitting still.
        </p>
      </div>
      <CodeBox @label="build-order.gts" @source={{TRACK_JUMP}} />
    </section>

    <section class="dd">
      <p class="dd-fn">the transport<span>build-order.gts</span></p>
      <h3>Scrubbing stops the clock it disagrees with</h3>
      <div class="dd-modes">
        <div class="dd-mode">
          <span class="dd-tag">playing</span>
          <b>The run loop drives</b>
          <p>Its own frame, a delta clamped to 50ms so a slow frame costs the
            score 50ms and not a teleport.</p>
        </div>
        <div class="dd-mode">
          <span class="dd-tag">scrubbing</span>
          <b>A hand drives</b>
          <p>Dragging the range input halts the loop outright and marks the run
            <em>held</em>, so scrolling the card away and back cannot quietly
            restart what a hand stopped.</p>
        </div>
        <div class="dd-mode">
          <span class="dd-tag">off-screen</span>
          <b>Nobody drives</b>
          <p>An IntersectionObserver halts playback below 35% visible and
            resumes it on return — unless a hand halted it first.</p>
        </div>
      </div>
      <div class="dd-col">
        <p>
          Every one of those still calls the same
          <code>paint()</code>. There is no special “resume from here” path,
          because there is nothing to resume — a build order is a pure function
          of t, and asking it about an earlier t is not a different operation
          from asking about a later one.
        </p>
      </div>
    </section>

    <section class="dd">
      <p class="dd-fn">edit()<span>build-order.gts</span></p>
      <h3>The score is editable while it runs</h3>
      <div class="dd-col">
        <p>
          The inspector on the right does not stage changes for the next play —
          it replaces the build, which invalidates the cached schedule, which
          repaints the current frame against the
          <em>new</em>
          timeline. Retiming build 2 while parked at 1.4s shows you what 1.4s
          now looks like, immediately.
        </p>
      </div>
      <CodeBox @label="build-order.gts" @source={{EDIT}} />
      <div class="dd-col">
        <p>
          That is only safe because nothing is cumulative. A pose is recomputed
          from the score every time it is asked for — equal input, equal output
          — so there is no accumulated state anywhere for an edit to leave
          stale.
        </p>
      </div>
    </section>

    <section class="dd">
      <p class="dd-fn">pathSpacing<span>build-order.gts</span></p>
      <h3>A stray dot, and what it was actually made of</h3>
      <div class="dd-col">
        <p>
          Line Draw looked right at rest and right mid-draw, and wrong at the
          exact instant a stroke started: a dot popped in at the far end of the
          path a frame before any of it had drawn. The far end — not the drawing
          end — which was the tell that nothing was misplaced. The dash pattern
          itself was lying about where the path stopped.
        </p>
      </div>
      <CodeBox @label="build-order.gts" @source={{PATH_SPACING}} />
      <div class="dd-col">
        <p>
          Motion turns
          <code>pathLength</code>
          into a
          <code>stroke-dasharray: length spacing</code>. With the default
          spacing of 1, that pattern sums to roughly a whole path near a drawn
          length of zero — close enough, inside the browser’s own length
          tolerance, for the second dash to wrap onto the path’s own terminus. A
          round linecap paints that phantom dash as a dot. Pinning the spacing
          at 2 keeps the second dash a full path-length away at any drawn
          length, so there is nothing left for a cap to sit on.
        </p>
      </div>
      <div class="dd-call">
        <p>
          <b>Why this belongs here.</b>
          It is not a one-off fix. It is the same lesson the Playhead demo’s
          frame loop teaches from a different angle: a system built to answer
          “what does this look like at t” will surface the bugs that live
          exactly at t’s edges — 0, 1, the instant something starts — because
          those are the values every other demo never has to sit still on.
        </p>
      </div>
    </section>
  </section>
</template>;

export default BuildOrderNotes;
export { BuildOrderNotes };
