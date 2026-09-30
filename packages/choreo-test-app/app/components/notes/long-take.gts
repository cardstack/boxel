import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Long Take demo.
 */
const LongTakeNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>A camera inside a camera</h2>
      <p class="dive-lede">
        Nothing on the screen changes. There is no
        <code>c.Move</code>
        in the board's region, no changeset, no
        <code>c.Perform</code>, not one
        <code>@animate</code>. Every frame of this film is two cameras — one
        moving the frame over the drawing, one moving the laptop in the room —
        and they read a single list of shots.
      </p>
    </header>

    <section class="dd">
      <h3>One list, so they cannot drift</h3>
      <div class="dd-col">
        <p>
          A shot's length is
          <code>move + hold</code>. Both regions are handed that number and
          neither of them owns it. Two scores that each kept their own timings
          would need those timings kept equal by hand, and the first edit that
          forgot would be a film whose two cameras had quietly drifted a second
          apart — with nothing in either score to point at.
        </p>
        <p>
          The same applies to looping. One take counter restarts both regions,
          so they can never come back from a loop out of step.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 210"
          role="img"
          aria-label="One shot list feeds both regions: the inner camera's
            move and hold, and the outer camera's leg, are the same numbers."
        >
          <text class="dg-eb" x="20" y="22">ONE SHOT</text>

          <rect class="dg-plate" x="40" y="40" width="180" height="60" rx="8" />
          <text class="dg-t" x="130" y="66" text-anchor="middle">shots.ts</text>
          <text class="dg-t" x="130" y="86" text-anchor="middle">move 1.9 · hold
            2.1</text>

          <line class="dg-hotline" x1="220" y1="70" x2="300" y2="70" />

          <rect class="dg-box" x="300" y="26" width="560" height="70" rx="6" />
          <text class="dg-eb" x="318" y="48">INSIDE THE SCREEN</text>
          <rect
            class="dg-plate"
            x="318"
            y="56"
            width="240"
            height="30"
            rx="5"
          />
          <text class="dg-t" x="438" y="76" text-anchor="middle">c.Frame 1.9s</text>
          <rect
            class="dg-plate"
            x="566"
            y="56"
            width="278"
            height="30"
            rx="5"
          />
          <text class="dg-t" x="705" y="76" text-anchor="middle">c.SlowZoom 2.1s</text>

          <rect class="dg-box" x="300" y="116" width="560" height="70" rx="6" />
          <text class="dg-eb" x="318" y="138">OUTSIDE, IN THE ROOM</text>
          <rect
            class="dg-plate"
            x="318"
            y="146"
            width="526"
            height="30"
            rx="5"
          />
          <text class="dg-t" x="581" y="166" text-anchor="middle">c.Camera3D
            4.0s</text>

          <line class="dg-hotline" x1="220" y1="70" x2="290" y2="150" />
          <text class="dg-t is-hot" x="130" y="130" text-anchor="middle">the
            same number</text>
        </svg>
      </figure>
    </section>

    <section class="dd">
      <h3>The move you cannot fake with a zoom</h3>
      <div class="dd-col">
        <p>
          <code>c.Frame</code>
          fits a station to the screen: the arriving shot, the one that changes
          magnification.
          <code>c.Aim</code>
          recentres on the next station with the zoom
          <em>held</em>. They are different moves and the eye knows it — under
          an Aim, attention travels and scale does not, which is what makes a
          sequence of stations read as a walk rather than as a series of zooms.
        </p>
        <p>
          <code>c.Pan</code>
          shifts by exact pixels from wherever the camera stands. It is relative
          on purpose: a pan after any shot means "from here", never "to there".
        </p>
        <p>
          And a hold is not a freeze.
          <code>c.SlowZoom @by={{"{{1.05}}"}}</code>
          multiplies the zoom in force, so the beat where nothing happens still
          breathes. It is one step rather than a second track to keep in step
          with the first.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>@padding is a fraction, and zero is not "none"</h3>
      <div class="dd-col">
        <p>
          <code>c.Frame @padding</code>
          is how much of the frame the station should
          <em>fill</em>, and it compiles straight into the zoom:
        </p>
        <pre class="dd-pre"><code>zoom = padding × min(frame.w / box.w, frame.h
            / box.h)</code></pre>
        <p>
          So
          <code>@padding={{"{{0}}"}}</code>
          is not a tight crop with no margin. It is a camera zoomed to nothing:
          the region collapses to a point, and every measurement after it is
          taken through its own zero scale, so there is no way back. It presents
          as a blank screen with a perfectly healthy run behind it.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>The flat laptop is a photograph of the round one</h3>
      <div class="dd-col">
        <p>
          2D is a 53&nbsp;KB WebP of the WebGL laptop at its rest pose, not a
          laptop drawn in CSS. It works because of the hole: the canvas is
          rendered with alpha and the display mesh punches itself out of it, so
          a straight readback is a laptop with a
          <em>transparent screen</em>. An
          <code>&lt;img&gt;</code>
          of that, laid over the DOM exactly where the canvas goes, composites
          the drawing through it in exactly the same way.
        </p>
        <p>
          So the switch changes what is
          <em>animating</em>, not what the machine looks like — the plane
          measures 696px flat and 697px in 3D. The engine stays a megabyte and a
          half that you only pay for when you ask the camera to move.
        </p>
        <p>
          The catch is that the picture and the frozen
          <code>perspective</code>
          and
          <code>matrix3d</code>
          strings are one measurement, taken at one reference size. Replace one
          and you must replace all of them, which is why the capture endpoint
          returns the matrices along with the file — and why the whole flat
          composite is scaled as a single unit rather than fitted piece by
          piece.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>No hairlines inside a layer that will be magnified</h3>
      <div class="dd-col">
        <p>
          A CSS 3D-transformed subtree is rasterised
          <em>once</em>
          at its layout resolution and then sampled through the matrix. The
          inner camera pushes in past 3×, so it is magnifying a texture rather
          than redrawing it — and a 1px stroke lands on a fractional number of
          device pixels and crawls as the camera moves.
        </p>
        <p>
          Every rule on the drawing that used to say 1px says 2px at half the
          opacity: the same amount of ink on screen, resampled cleanly. MSAA and
          its relatives are no help here — they anti-alias the canvas, not the
          DOM layer behind it.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Why the laptop's own body hides the drawing</h3>
      <div class="dd-col">
        <p>
          There is no per-pixel depth test between a canvas and a DOM layer —
          they are separate compositing layers — so the stacking order has to do
          the work. The canvas sits
          <em>above</em>
          the DOM. The display mesh punches its hole with
          <code>NoBlending</code>, which writes the material's RGB
          <em>and its alpha</em>
          into the framebuffer, and the drawing shows through that hole.
        </p>
        <p>
          But the hole is depth-tested like anything else. Where the base and
          the keyboard are nearer the camera than the lid, the display's
          fragments fail that test and the aluminium stays — so the drawing
          disappears behind the bottom of the laptop exactly when it should, out
          of the depth buffer that was already there.
        </p>
        <p>
          With the layers the other way round the DOM paints over everything and
          the board floats in front of the keyboard: the giveaway that a mockup
          is a texture pretending to be a screen.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 190"
          role="img"
          aria-label="The canvas is above the DOM. The display mesh punches an
            alpha hole; nearer geometry fails the depth test and stays opaque."
        >
          <text class="dg-eb" x="20" y="22">LAYERS, BOTTOM TO TOP</text>

          <rect
            class="dg-plate"
            x="60"
            y="120"
            width="360"
            height="42"
            rx="6"
          />
          <text class="dg-t" x="240" y="146" text-anchor="middle">DOM — the
            drawing</text>

          <rect class="dg-box" x="60" y="60" width="360" height="42" rx="6" />
          <text class="dg-t" x="240" y="86" text-anchor="middle">canvas — the
            laptop</text>

          <text class="dg-t is-hot" x="240" y="40" text-anchor="middle">the hole
            is depth-tested</text>

          <rect
            class="dg-plate"
            x="500"
            y="52"
            width="340"
            height="112"
            rx="8"
          />
          <rect class="dg-box" x="524" y="68" width="292" height="58" rx="4" />
          <text class="dg-t" x="670" y="102" text-anchor="middle">drawing,
            through the hole</text>
          <rect class="dg-box" x="524" y="130" width="292" height="20" rx="3" />
          <text class="dg-t is-hot" x="670" y="180" text-anchor="middle">base is
            nearer — it wins</text>
        </svg>
      </figure>
    </section>
  </section>
</template>;

export { LongTakeNotes };
export default LongTakeNotes;
