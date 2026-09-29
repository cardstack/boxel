import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Subdivision demo.
 */
const SubdivisionNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>Same element, opposite behaviour</h2>
      <p class="dive-lede">
        The tiles use
        <code>layout=true</code>
        in both cases. What changes is whether the state update is wrapped in
        <code>instantLayoutTransition</code>. That one wrapper is the entire
        difference between "animate to the new layout" and "jump there
        immediately".
      </p>
    </header>

    <section class="dd">
      <h3>While the finger is down: instant</h3>
      <div class="dd-col">
        <p>
          When you drag a seam, every pointer-move event updates the grid column
          size. That update is wrapped in
          <code>instantLayoutTransition</code>, which tells the projection tree
          to accept the new measurements without animating them.
        </p>
        <p>
          This is necessary because the seam must track the finger exactly. A
          seam that lags behind the pointer — because a spring is easing it into
          position — feels broken. So the layout change is applied directly,
          every frame, with no transition.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 200"
          role="img"
          aria-label="During drag: each pointer move updates the column size
            inside instantLayoutTransition, so the tiles follow immediately."
        >
          <text class="dg-eb" x="20" y="22">DURING DRAG</text>

          <rect
            class="dg-plate"
            x="40"
            y="44"
            width="360"
            height="130"
            rx="8"
          />
          <rect class="dg-box" x="60" y="60" width="140" height="98" rx="5" />
          <rect class="dg-box" x="220" y="60" width="160" height="98" rx="5" />

          <line class="dg-hotline" x1="200" y1="50" x2="200" y2="168" />
          <text class="dg-t is-hot" x="200" y="190" text-anchor="middle">seam
            follows finger</text>

          <rect
            class="dg-plate"
            x="480"
            y="44"
            width="380"
            height="130"
            rx="8"
          />
          <text
            class="dg-t"
            x="670"
            y="88"
            text-anchor="middle"
          >instantLayoutTransition(() =&gt;</text>
          <text class="dg-t" x="670" y="110" text-anchor="middle">
            this.col = next</text>
          <text class="dg-t" x="670" y="132" text-anchor="middle">)</text>
          <text class="dg-t is-faint" x="670" y="162" text-anchor="middle">no
            spring — tiles jump to match</text>
        </svg>
        <figcaption>
          Every pointer event changes the column percentage. The wrapper skips
          the animation so the tiles track instantly.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>On release: animated</h3>
      <div class="dd-col">
        <p>
          When you lift your finger, the column snaps to the nearest whole
          percentage. This time the update is not wrapped. The projection tree
          sees a layout change, measures before and after, and animates the
          tiles on a spring to their new positions.
        </p>
        <p>
          Same elements, same
          <code>layout=true</code>, same CSS grid — the only difference is
          whether
          <code>instantLayoutTransition</code>
          was used. That is the entire API surface for "animate this layout
          change" versus "apply it immediately".
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 200"
          role="img"
          aria-label="On release: the column snaps to a round number without
            the instant wrapper, so the tiles spring into place."
        >
          <text class="dg-eb" x="20" y="22">ON RELEASE</text>

          <rect
            class="dg-plate"
            x="40"
            y="44"
            width="360"
            height="130"
            rx="8"
          />
          <rect class="dg-box" x="60" y="60" width="130" height="98" rx="5" />
          <rect class="dg-hot" x="200" y="60" width="90" height="98" rx="5" />
          <rect class="dg-box" x="300" y="60" width="80" height="98" rx="5" />
          <text
            class="dg-t is-hot"
            x="245"
            y="120"
            text-anchor="middle"
          >snapping</text>

          <rect
            class="dg-plate"
            x="480"
            y="44"
            width="380"
            height="130"
            rx="8"
          />
          <text class="dg-t" x="670" y="94" text-anchor="middle">this.col =
            Math.round(this.col)</text>
          <text class="dg-t is-faint" x="670" y="130" text-anchor="middle">no
            wrapper — tiles spring to position</text>
        </svg>
        <figcaption>
          Same elements, same
          <code>layout=true</code>. The only difference is the wrapper.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>layout="position" for the text</h3>
      <div class="dd-col">
        <p>
          The tile labels use
          <code>layout="position"</code>
          instead of
          <code>layout=true</code>. A tile that is changing shape has a
          non-uniform scale — its width changes more than its height — and
          everything inside inherits that distortion.
          <code>layout="position"</code>
          moves the label without applying the parent's scale, so the text stays
          crisp throughout the resize.
        </p>
      </div>
    </section>
  </section>
</template>;

export default SubdivisionNotes;
export { SubdivisionNotes };
