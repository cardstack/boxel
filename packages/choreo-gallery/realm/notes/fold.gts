import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Fold demo.
 */
const FoldNotes: TOC<object> = <template>
  <section class='dive' aria-label='How it works'>
    <header class='dive-head'>
      <p class='dive-kicker'>How it works</p>
      <h2>A scrub is a re-derivation, not an undo</h2>
      <p class='dive-lede'>
        <code>&lt;c.Perform&gt;</code>
        puts commands in the score. A command is not an animation — it is a
        statement of state handed to the app, and the app is what changes. The
        law underneath it is one sentence:
        <b>the set of commands at or before the clock is the commanded state</b>
        — the library calls that summing-up the
        <em>fold</em>, which is what this demo is named for. Everything on this
        stage exists to make it visible, because it is a claim about scrubbing
        that a still frame cannot show.
      </p>
    </header>

    <section class='dd'>
      <h3>Why a firing schedule</h3>
      <div class='dd-col'>
        <p>
          A kiln is not a value you can interpolate backwards. It is the
          accumulation of the orders given to it, which is exactly what the fold
          is a model of. Six orders run over five seconds, and two of them
          <em>latch</em>:
          <code>soak.start</code>
          and
          <code>cone.drop</code>
          set something no later command clears.
        </p>
        <p>
          Those two are the whole test. The other four are absolute settings —
          <code>gas.set 2</code>,
          <code>gas.off</code>
          — and an absolute setting re-derives correctly even on a host that is
          doing the wrong thing, because replaying it simply overwrites whatever
          was there. A demo built only from those would look correct against a
          broken implementation.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>What a backward seek actually does</h3>
      <div class='dd-col'>
        <p>
          Choreo calls
          <code>@onPerformReset</code>, then replays the remaining prefix in
          order. It does not run anything in reverse and it does not ask the
          host to undo: it puts the host back to nothing and re-derives the
          state the clock now implies.
        </p>
        <p>
          So the difference between a correct host and a broken one is exactly
          one method. That is what the toggle switches, and nothing else: same
          score, same commands, same clock. Refuse the reset and the replay
          lands on stale state — the absolute settings overwrite themselves and
          look fine, while the soak and the cone stay latched from a future that
          no longer happened.
        </p>
        <p>
          The counter is the tell. A host that ignores the reset never counts
          one, and there is no arrangement of the score that will clear its
          latches.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>The state is not tracked, and that is load-bearing</h3>
      <div class='dd-col'>
        <p>
          <code>onPerform</code>
          fires
          <em>during</em>
          the region's pass. A tracked write there re-renders the region,
          replays the pass, and cancels the very run that was dispatching — the
          same trap the Build Order transport documents for its clock.
        </p>
        <p>
          So the kiln's four values are plain fields, and the stove is painted
          by hand each frame from custom properties. The demo's own animation
          frame is a reader and a painter; it never writes anything the template
          is watching.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Only opacity and transform</h3>
      <div class='dd-col'>
        <p>
          The heat is the one thing that changes continuously, so it is the one
          worth being strict about. Nothing here tweens
          <code>box-shadow</code>,
          <code>text-shadow</code>,
          <code>filter: blur()</code>
          or
          <code>drop-shadow()</code>: each is re-rasterised on every frame that
          touches it, and a shadow string is re-parsed and rebuilt besides.
        </p>
        <p>
          Every glow here is a static gradient drawn once at full strength, and
          heat is the opacity it is shown at. The flame does not grow by
          animating its height, which is layout — it is one path scaled on Y.
          The damper and the cone rotate, about pivots given in view-box units
          rather than percentages of a bounding box that moves with the
          geometry. That is the entire vocabulary, and all of it composites
          without a repaint.
        </p>
      </div>
    </section>
  </section>
</template>;

export default FoldNotes;
export { FoldNotes };
