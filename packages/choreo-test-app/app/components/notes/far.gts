import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Far Match demo.
 */
const FarNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>One name across three regions</h2>
      <p class="dive-lede">
        Each bay is its own
        <code>&lt;Choreo&gt;</code>
        region. A region only knows about its own elements. Moving a piece from
        one bay to another is a removal in one region and an insertion in
        another — two unrelated events, unless the regions are told to match
        them.
      </p>
    </header>

    <section class="dd">
      <h3>The far-match barrier</h3>
      <div class="dd-col">
        <p>
          Normally, a region reconciles only its own elements. It knows what was
          inserted, removed, and kept within its own boundary. It has no idea
          what happened in another region.
        </p>
        <p>
          Far matching changes this. When multiple regions share the same
          <code>@id</code>
          namespace, a coordination step runs after all regions have measured:
          ids that were removed from one region and inserted into another are
          paired. The receiving region gets the sender's bounds as a starting
          point, so the element can animate from where it was in the old bay to
          where it is in the new one.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 280"
          role="img"
          aria-label="Three regions, each a bay. A piece moves from bay A to
            bay C: it is removed from A, inserted into C, and the barrier
            pairs the two so C can animate from A's position."
        >
          <text class="dg-eb" x="20" y="22">THREE REGIONS, ONE NAME</text>

          <rect
            class="dg-plate"
            x="40"
            y="44"
            width="240"
            height="160"
            rx="8"
          />
          <text class="dg-t is-dim" x="160" y="68" text-anchor="middle">Bay A</text>
          <rect class="dg-hot" x="60" y="80" width="80" height="30" rx="4" />
          <rect class="dg-box" x="60" y="120" width="80" height="30" rx="4" />
          <rect class="dg-box" x="60" y="160" width="80" height="30" rx="4" />
          <text
            class="dg-t is-hot"
            x="100"
            y="100"
            text-anchor="middle"
          >Flux</text>

          <rect
            class="dg-plate"
            x="320"
            y="44"
            width="240"
            height="160"
            rx="8"
          />
          <text class="dg-t is-dim" x="440" y="68" text-anchor="middle">Bay B</text>
          <rect class="dg-box" x="340" y="80" width="80" height="30" rx="4" />
          <rect class="dg-box" x="340" y="120" width="80" height="30" rx="4" />

          <rect
            class="dg-plate"
            x="600"
            y="44"
            width="260"
            height="160"
            rx="8"
          />
          <text class="dg-t is-dim" x="730" y="68" text-anchor="middle">Bay C</text>
          <rect class="dg-box" x="620" y="80" width="80" height="30" rx="4" />
          <rect class="dg-hot" x="620" y="120" width="80" height="30" rx="4" />
          <text
            class="dg-t is-hot"
            x="660"
            y="140"
            text-anchor="middle"
          >Flux</text>

          <path
            class="dg-hotline dg-dash"
            d="M140,95 C280,95 500,135 620,135"
          />
          <polygon class="dg-arrow" points="616,131 626,135 616,139" />

          <text
            class="dg-t is-faint"
            x="380"
            y="240"
            text-anchor="middle"
          >removed from A — barrier pairs them — inserted into C</text>
          <text class="dg-t is-faint" x="380" y="262" text-anchor="middle">C
            animates from A's last position</text>
        </svg>
        <figcaption>
          A removal and an insertion are paired across regions. The receiving
          element starts from the sender's bounds.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>counterpart</h3>
      <div class="dd-col">
        <p>
          A piece that arrived from another region carries a
          <code>counterpart</code>
          — a reference to the sprite it was matched with. A piece that simply
          moved within its own bay has no counterpart.
        </p>
        <p>
          This demo uses counterpart to decide z-index: a piece crossing between
          bays is lifted above the others so it flies over any bays it passes. A
          piece shuffling within its own bay stays at the default layer.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>One rule covers both halves</h3>
      <div class="dd-col">
        <p>
          Each region runs the same timeline:
          <code>c.Move @of=&#123;&#123;c.moved "piece"&#125;&#125;</code>. From
          a region's perspective, both cases are the same job — a piece that is
          somewhere new moves there on a spring. The only difference is the size
          of the delta: a neighbour closing a gap has a small one, and a piece
          arriving from another bay has the delta between two bays.
        </p>
        <p>
          The barrier handed the arriving piece the sender's bounds as its
          starting position, so the region does not need to know it came from
          somewhere else. It just sees a piece with a large delta and animates
          it.
        </p>
      </div>
    </section>
  </section>
</template>;

export default FarNotes;
export { FarNotes };
