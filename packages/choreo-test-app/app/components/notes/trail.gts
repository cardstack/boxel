import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Trail demo.
 */
const TrailNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>In flow vs out of flow</h2>
      <p class="dive-lede">
        When an element exits, it normally stays in the document flow until its
        animation finishes — so the gap does not close until it is gone.
        <code>popLayout</code>
        lifts the leaver out of flow immediately, and the survivors close up
        while the exit is still playing.
      </p>
    </header>

    <section class="dd">
      <h3>Without popLayout</h3>
      <div class="dd-col">
        <p>
          An element exits with an opacity fade, a slight scale-down, and a
          horizontal slide. While it is animating, it still occupies space in
          the row. The other crumbs cannot move into that space until the exit
          animation finishes and the element is removed from the DOM.
        </p>
        <p>
          The result is a two-step sequence: the crumb fades, the gap closes.
          With fast animations this is barely noticeable, but at slower speeds
          the pause is visible.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 200"
          role="img"
          aria-label="Without popLayout: the leaver stays in flow during its
            exit, so the gap only closes after it finishes."
        >
          <text class="dg-eb" x="20" y="22">WITHOUT POPLAYOUT</text>

          <line class="dg-rule" x1="100" y1="160" x2="850" y2="160" />
          <text class="dg-t is-faint" x="90" y="164" text-anchor="end">time →</text>

          <rect class="dg-box" x="100" y="50" width="260" height="32" rx="5" />
          <text class="dg-t" x="230" y="70" text-anchor="middle">crumb fades out
            (in flow)</text>

          <rect class="dg-hot" x="370" y="50" width="280" height="32" rx="5" />
          <text class="dg-t is-hot" x="510" y="70" text-anchor="middle">gap
            closes</text>

          <line class="dg-hair dg-dash" x1="360" y1="44" x2="360" y2="160" />
          <text class="dg-t is-faint" x="366" y="108">crumb unmounts</text>
          <text class="dg-t is-faint" x="366" y="128">then survivors can move</text>
        </svg>
        <figcaption>
          Two steps: the exit plays, then the gap closes. A visible pause
          between them.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>With popLayout</h3>
      <div class="dd-col">
        <p>
          <code>popLayout</code>
          removes the exiting element from the document flow the instant the
          exit begins. The element is positioned absolutely over its last known
          location, so it still appears in place while it fades — but it no
          longer takes up space. The surrounding crumbs can close the gap
          immediately.
        </p>
        <p>
          The survivors animate into the smaller row with
          <code>layout=true</code>. The exit and the gap-closing happen
          simultaneously instead of sequentially.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 220"
          role="img"
          aria-label="With popLayout: the leaver is lifted out of flow, so
            the gap closes while the exit animation plays."
        >
          <text class="dg-eb" x="20" y="22">WITH POPLAYOUT</text>

          <line class="dg-rule" x1="100" y1="190" x2="850" y2="190" />
          <text class="dg-t is-faint" x="90" y="194" text-anchor="end">time →</text>

          <rect class="dg-box" x="100" y="50" width="260" height="32" rx="5" />
          <text class="dg-t" x="230" y="70" text-anchor="middle">crumb fades out
            (out of flow)</text>

          <rect class="dg-hot" x="100" y="100" width="380" height="32" rx="5" />
          <text class="dg-t is-hot" x="290" y="120" text-anchor="middle">gap
            closes simultaneously</text>

          <rect
            class="dg-boxcop"
            x="100"
            y="150"
            width="200"
            height="26"
            rx="5"
          />
          <text class="dg-t is-cop" x="200" y="168" text-anchor="middle">both
            start at the same time</text>
        </svg>
        <figcaption>
          One step: the exit plays and the gap closes at the same time.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>Entering crumbs work the same way</h3>
      <div class="dd-col">
        <p>
          A new crumb enters with an opacity fade and a horizontal slide. The
          other crumbs shift to make room for it, and that shift is animated by
          <code>layout=true</code>. The entrance and the layout adjustment
          happen simultaneously.
        </p>
        <p>
          Together, the entrance and the exit create a trail that grows and
          shrinks as you navigate. Each step adds a crumb with a smooth
          entrance, and going back removes one with a smooth exit, with the row
          adjusting in real time.
        </p>
      </div>
    </section>
  </section>
</template>;

export default TrailNotes;
export { TrailNotes };
