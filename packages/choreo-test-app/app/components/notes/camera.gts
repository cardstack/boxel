import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Camera demo.
 */
const CameraNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>The region's frame is a subject too</h2>
      <p class="dive-lede">
        Every other step animates sprites inside the region. A
        <code>&lt;c.Camera&gt;</code>
        step animates the region itself — one transform on the whole frame,
        so the entire scene travels as a single composited layer. The demo is
        one camera step, aimed by state: click a photograph and the pass
        replays the step toward it; click another mid-flight and the dive
        simply bends.
      </p>
    </header>

    <section class="dd">
      <h3>@fit: dive on this thing, and centre it</h3>
      <div class="dd-col">
        <p>
          The whole dive is one declaration:
          <code>@fit</code>
          names the sprite, and
          <code>@margin</code>
          says how much of the glass it should fill once centred. The library
          computes the rest — the zoom from the ratio of the two boxes on
          whichever axis fits first, and the pan that lands the sprite's
          centre on the frame's centre. Passing
          <code>null</code>
          fits nothing: the camera returns to the resting identity.
        </p>
        <p>
          The number is derived, not guessed. A fixed multiplier assumes a
          reference viewport; on a narrow phone the same multiplier either
          underzooms or crops the photograph against the edge of the glass.
          Computed from the real boxes, every screen lands the frame at the
          same share.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 300"
          role="img"
          aria-label="A frame sits in the corner of the glass. @fit computes
            the zoom from the margin and the two boxes, and the pan that
            carries the frame's centre onto the glass's centre."
        >
          <text class="dg-eb" x="20" y="22">ZOOM AND PAN, BOTH COMPUTED</text>

          <rect class="dg-plate" x="40" y="44" width="380" height="220" rx="8" />
          <text class="dg-t is-dim" x="230" y="68" text-anchor="middle">the glass, at rest</text>
          <rect class="dg-hot" x="64" y="200" width="64" height="40" rx="4" />
          <circle class="dg-arrow" cx="96" cy="220" r="3" />
          <circle class="dg-t is-faint" cx="230" cy="154" r="3" fill="currentColor" />
          <path class="dg-hotline dg-dash" d="M100,216 C140,190 190,170 226,157" />
          <polygon class="dg-arrow" points="222,153 230,154 224,161" />
          <text class="dg-t is-faint" x="150" y="150" text-anchor="middle">pan: centre − P</text>

          <rect class="dg-plate" x="480" y="44" width="380" height="220" rx="8" />
          <text class="dg-t is-dim" x="670" y="68" text-anchor="middle">dived in</text>
          <rect class="dg-hot" x="580" y="90" width="180" height="128" rx="6" />
          <text class="dg-t is-hot" x="670" y="160" text-anchor="middle">margin of the glass</text>
          <text
            class="dg-t is-faint"
            x="670"
            y="288"
            text-anchor="middle"
          >zoom = margin × min(glass ÷ frame), whichever axis fits first</text>
        </svg>
        <figcaption>
          One argument names the sprite; the zoom and the centring pan both
          fall out of the two measured boxes.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>Rest geometry, not painted geometry</h3>
      <div class="dd-col">
        <p>
          The landmine in any hand-rolled version: click straight from one
          dive to the next tile, and the measurement fires while the camera
          is mid-zoom — maybe mid-spring — on the old frame.
          <code>getBoundingClientRect</code>
          answers with whatever was painted that instant, and the newly
          selected tile appears to fly away from its own dive.
        </p>
        <p>
          The library measures in the same space its FLIP machinery already
          uses: every box in a pass is taken through the frame's transform
          and divided back by the zoom it was measured under. So
          <code>@fit</code>
          always computes against the sprite's rest-layout box — correct by
          construction, no matter what the camera is doing on screen when
          the click lands.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>An aim that cannot drift</h3>
      <div class="dd-col">
        <p>
          The applied transform is
          <code>translate(x + (1−z)·P) scale(z)</code>
          with the origin pinned at
          <code>0 0</code>
          — pure arithmetic over numbers frozen when the cue compiled.
          Nothing reads the DOM per frame, so a board that reflows mid-cue
          cannot move the picture, and at
          <code>z&nbsp;=&nbsp;1</code>
          the aim term vanishes: an unpanned camera is exactly the identity,
          leaving no transform on the region at rest.
        </p>
        <p>
          A re-aim is smooth by the same construction. Each cue freezes its
          own aim point and lerps from the point previously in force — so
          interrupting a dive with another dive bends one continuous flight
          instead of cutting to a new one.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>@steady: legible against the zoom</h3>
      <div class="dd-col">
        <p>
          Some things ride the camera; some things are labels. The take
          numbers and the corner marks are named
          <code>@steady</code>: they counter-scale against the zoom so they
          stay readable — but damped, not 1:1. A label that held its exact
          size while the world grew around it would feel stuck to the glass;
          one that scaled fully would be unreadable. The damping curve
          (<code>pow(z, 0.3)</code>
          zoomed out,
          <code>pow(z, 0.7)</code>
          zoomed in, clamped) sits between the two.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Reading the camera back</h3>
      <div class="dd-col">
        <p>
          The region yields
          <code>c.camera</code>
          — where the frame stands, tracked, updated when a camera step lands
          rather than per frame, so app logic can derive from it without a
          feedback loop. The magnification readout over the corner is exactly
          that: it sits outside the region so it never rides the transform,
          and it shows the state the library landed, not a number this demo
          computed for itself.
        </p>
      </div>
    </section>
  </section>
</template>;

export default CameraNotes;
export { CameraNotes };
