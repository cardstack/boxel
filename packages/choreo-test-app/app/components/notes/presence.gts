import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Presence Modes demo.
 */
const PresenceNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>Three ways to swap</h2>
      <p class="dive-lede">
        The old notice leaves and the new one arrives. The three modes control
        what happens to the gap between them.
      </p>
    </header>

    <section class="dd">
      <h3>sync — both at once</h3>
      <div class="dd-col">
        <p>
          The leaver starts its exit and the newcomer starts its entrance in the
          same frame. For a moment, both are on screen. Because the leaver is
          still in flow, the newcomer is pushed below it. Once the leaver
          finishes and unmounts, the newcomer slides up into the empty space.
        </p>
        <p>
          That slide is what
          <code>layout=true</code>
          does. Without it, the newcomer would snap up in a single frame. With
          it, the position change is animated — and this is the thing that makes
          the three modes visually distinct from each other.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 200"
          role="img"
          aria-label="Sync mode: the old and new notices overlap in time,
            then the new one slides up when the old one unmounts."
        >
          <text class="dg-eb" x="20" y="22">SYNC</text>

          <line class="dg-rule" x1="100" y1="170" x2="850" y2="170" />
          <text class="dg-t is-faint" x="90" y="174" text-anchor="end">time →</text>

          <rect class="dg-box" x="100" y="50" width="300" height="32" rx="5" />
          <text class="dg-t" x="250" y="70" text-anchor="middle">old — fading
            out</text>

          <rect class="dg-hot" x="100" y="100" width="500" height="32" rx="5" />
          <text class="dg-t is-hot" x="350" y="120" text-anchor="middle">new —
            fading in, then sliding up</text>

          <rect class="dg-band" x="100" y="44" width="300" height="94" />
          <text
            class="dg-t is-cop"
            x="250"
            y="160"
            text-anchor="middle"
          >overlap</text>

          <line class="dg-cop dg-dash" x1="400" y1="44" x2="400" y2="170" />
          <text class="dg-t is-faint" x="406" y="160">old unmounts → new slides
            up</text>
        </svg>
        <figcaption>
          Sync is the busiest mode. The newcomer moves twice: once for its
          entrance, and once for the layout shift when the leaver unmounts.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>wait — exit first, then enter</h3>
      <div class="dd-col">
        <p>
          The newcomer does not mount until the leaver has finished its exit
          animation and been removed from the DOM. There is a visible gap — the
          slot is empty for a beat — and then the newcomer fades in, already in
          the right position.
        </p>
        <p>
          No layout animation is needed here because the newcomer is placed
          directly into an empty slot. There is nothing to shift.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 180"
          role="img"
          aria-label="Wait mode: the old notice finishes and unmounts,
            then the new notice enters into the empty slot."
        >
          <text class="dg-eb" x="20" y="22">WAIT</text>

          <line class="dg-rule" x1="100" y1="150" x2="850" y2="150" />
          <text class="dg-t is-faint" x="90" y="154" text-anchor="end">time →</text>

          <rect class="dg-box" x="100" y="50" width="260" height="32" rx="5" />
          <text class="dg-t" x="230" y="70" text-anchor="middle">old — fading
            out</text>

          <rect class="dg-plate" x="360" y="50" width="80" height="32" rx="5" />
          <text
            class="dg-t is-faint"
            x="400"
            y="70"
            text-anchor="middle"
          >gap</text>

          <rect class="dg-hot" x="440" y="50" width="300" height="32" rx="5" />
          <text class="dg-t is-hot" x="590" y="70" text-anchor="middle">new —
            fading in</text>

          <text class="dg-t is-faint" x="400" y="112" text-anchor="middle">old
            unmounts</text>
          <line class="dg-hair dg-dash" x1="360" y1="44" x2="360" y2="100" />
          <text class="dg-t is-faint" x="440" y="136" text-anchor="start">new
            mounts into the empty slot</text>
          <line class="dg-hair dg-dash" x1="440" y1="44" x2="440" y2="124" />
        </svg>
        <figcaption>
          Wait is the cleanest mode: one thing at a time. The tradeoff is the
          visible pause between the two notices.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>popLayout — the leaver leaves flow immediately</h3>
      <div class="dd-col">
        <p>
          The leaver is lifted out of the normal document flow the instant its
          exit begins. It is still visible — it fades and slides — but it no
          longer takes up space. The slot collapses underneath it, and the
          newcomer is placed into a row that has already closed the gap.
        </p>
        <p>
          The survivors animate into the smaller layout with
          <code>layout=true</code>, so the collapse is smooth rather than a
          sudden jump.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 220"
          role="img"
          aria-label="popLayout: the old notice is lifted out of flow,
            survivors close the gap, and the new notice enters immediately."
        >
          <text class="dg-eb" x="20" y="22">POPLAYOUT</text>

          <line class="dg-rule" x1="100" y1="190" x2="850" y2="190" />
          <text class="dg-t is-faint" x="90" y="194" text-anchor="end">time →</text>

          <rect class="dg-box" x="100" y="50" width="260" height="32" rx="5" />
          <text class="dg-t" x="230" y="70" text-anchor="middle">old — fading,
            out of flow</text>

          <rect class="dg-hot" x="100" y="100" width="500" height="32" rx="5" />
          <text class="dg-t is-hot" x="350" y="120" text-anchor="middle">new —
            fading in, already in position</text>

          <rect
            class="dg-boxcop"
            x="100"
            y="150"
            width="200"
            height="26"
            rx="5"
          />
          <text class="dg-t is-cop" x="200" y="168" text-anchor="middle">gap
            closes immediately</text>

          <line class="dg-cop dg-dash" x1="100" y1="86" x2="100" y2="148" />
          <text class="dg-t is-faint" x="370" y="168">survivors slide into the
            smaller layout</text>
        </svg>
        <figcaption>
          popLayout gives you both: the exit plays visually, but the layout acts
          as if the element is already gone.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>layout=true ties them together</h3>
      <div class="dd-col">
        <p>
          All three columns use
          <code>layout=true</code>
          on the toast and on the "Up next" element below it. That is what turns
          a layout change into a smooth animation instead of a jump. In sync
          mode it makes the newcomer slide up. In popLayout it makes the
          survivors close the gap.
        </p>
        <p>
          In wait mode it does nothing visible — there is only one element at a
          time, so there is no layout shift to animate. But the same code is
          used for all three, with only the mode changed.
        </p>
      </div>
    </section>
  </section>
</template>;

export default PresenceNotes;
export { PresenceNotes };
