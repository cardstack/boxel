import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Lightbox demo.
 */
const LightboxNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>Two halves of one thing</h2>
      <p class="dive-lede">
        A thumbnail and a lightbox are never on screen at the same time. Giving
        both the same
        <code>layoutId</code>
        tells the engine they are the same object, so the new one animates from
        the old one's position instead of appearing out of nowhere.
      </p>
    </header>

    <section class="dd">
      <h3>layoutId pairs two elements that take turns</h3>
      <div class="dd-col">
        <p>
          When you click a tile, the overlay mounts and a new element appears
          with the same
          <code>layoutId</code>
          as the tile you clicked. The engine measures where the tile was,
          measures where the overlay element is, and animates a single box from
          the first position to the second. The tile is still in the DOM — it
          stays hidden so the grid keeps its shape — but on screen it looks like
          the tile flew up and grew into the lightbox.
        </p>
        <p>
          Closing the lightbox runs the same process in reverse. The overlay
          unmounts, the tile reappears, and the animation plays backwards. You
          never write coordinates or keyframes. The engine works it out from the
          two measurements.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 260"
          role="img"
          aria-label="A tile in the grid and a lightbox card share a layoutId.
            The engine measures both positions and animates between them."
        >
          <text class="dg-eb" x="20" y="22">BEFORE THE CLICK</text>
          <text class="dg-eb" x="480" y="22">AFTER THE CLICK</text>

          <rect
            class="dg-plate"
            x="20"
            y="40"
            width="400"
            height="180"
            rx="10"
          />

          <rect class="dg-box" x="40" y="60" width="80" height="64" rx="6" />
          <rect class="dg-hot" x="140" y="60" width="80" height="64" rx="6" />
          <rect class="dg-box" x="240" y="60" width="80" height="64" rx="6" />
          <rect class="dg-box" x="40" y="140" width="80" height="64" rx="6" />
          <rect class="dg-box" x="140" y="140" width="80" height="64" rx="6" />
          <rect class="dg-box" x="240" y="140" width="80" height="64" rx="6" />
          <text
            class="dg-t is-hot"
            x="180"
            y="96"
            text-anchor="middle"
          >Atlas</text>
          <text
            class="dg-t is-faint"
            x="180"
            y="240"
            text-anchor="middle"
          >layoutId="atlas-card"</text>

          <rect
            class="dg-plate"
            x="480"
            y="40"
            width="400"
            height="180"
            rx="10"
          />
          <rect class="dg-band" x="500" y="56" width="360" height="148" />
          <rect class="dg-hot" x="560" y="72" width="240" height="116" rx="8" />
          <text
            class="dg-t is-hot"
            x="680"
            y="136"
            text-anchor="middle"
          >Atlas</text>
          <text
            class="dg-t is-faint"
            x="680"
            y="240"
            text-anchor="middle"
          >layoutId="atlas-card"</text>

          <path
            class="dg-hotline dg-dash"
            d="M220,92 C320,92 460,130 560,130"
          />
          <polygon class="dg-arrow" points="556,126 566,130 556,134" />
        </svg>
        <figcaption>
          Same
          <code>layoutId</code>, two sizes. The engine draws one box that grows
          from the first measurement to the second.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>Two pairs, not one</h3>
      <div class="dd-col">
        <p>
          This demo uses two
          <code>layoutId</code>
          pairs: one for the plate (the coloured card) and one for the label.
          The plate changes aspect ratio — a square tile growing into a wide
          hero — and the label changes font size.
        </p>
        <p>
          If the label were inside the plate with no
          <code>layoutId</code>
          of its own, it would be scaled along with the plate. A 14px word
          stretched to 24px looks blurry. With its own
          <code>layoutId</code>, the label is measured independently and
          re-rendered at its actual size throughout the animation, so the text
          stays sharp.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 220"
          role="img"
          aria-label="Two nested layoutId pairs: the plate carries the shape,
            the label carries the text. Each animates independently."
        >
          <text class="dg-eb" x="20" y="22">TWO SHARED ELEMENTS, NESTED</text>

          <rect class="dg-box" x="60" y="44" width="340" height="60" rx="8" />
          <text class="dg-t" x="80" y="78">plate → layoutId="atlas-card"</text>
          <rect class="dg-hot" x="80" y="114" width="300" height="46" rx="6" />
          <text class="dg-t is-hot" x="100" y="142">label →
            layoutId="atlas-name"</text>

          <rect
            class="dg-plate"
            x="500"
            y="44"
            width="360"
            height="150"
            rx="8"
          />
          <text class="dg-t is-dim" x="520" y="78">the plate changes shape</text>
          <text class="dg-t is-dim" x="520" y="100">(square → wide)</text>
          <text class="dg-t is-dim" x="520" y="138">the label changes size</text>
          <text class="dg-t is-dim" x="520" y="160">(14px → 24px)</text>
          <text class="dg-t is-dim" x="520" y="182">each one animates on its own</text>
        </svg>
        <figcaption>
          Two measurements, two animations, both on the same spring. The label
          stays sharp the whole way.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>Presence keeps the exit alive</h3>
      <div class="dd-col">
        <p>
          When you close the lightbox,
          <code>this.open</code>
          is set to
          <code>null</code>. Normally that would remove the overlay from the DOM
          in the same frame — no animation, just gone.
          <code>&lt;Presence&gt;</code>
          prevents that. It keeps the overlay mounted until the exit animation
          finishes, then removes it.
        </p>
        <p>
          The shared-element spring plays in reverse, the scrim fades out on a
          shorter tween, and the detail fields dissolve. Only when everything
          has finished does
          <code>&lt;Presence&gt;</code>
          finally unmount the overlay.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Scale correction</h3>
      <div class="dd-col">
        <p>
          A shared-element animation works by scaling one box into another. A
          120×120 tile growing to 480×280 means a 4× horizontal scale and a 2.3×
          vertical scale — and everything inside inherits that distortion.
        </p>
        <p>
          The engine corrects for this. Every frame, it tracks the parent's
          current scale and applies the inverse to children that have their own
          <code>layoutId</code>
          or
          <code>layout=true</code>. The label is counter-scaled so it renders at
          its real size, not the stretched one.
        </p>
        <p>
          Border radius gets the same treatment. The plate carries its radius in
          the
          <code>style</code>
          prop so the engine can interpolate it against the changing scale. A
          radius left in the stylesheet would come out oval mid-animation.
        </p>
      </div>
    </section>
  </section>
</template>;

export default LightboxNotes;
export { LightboxNotes };
