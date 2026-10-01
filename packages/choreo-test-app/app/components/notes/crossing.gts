import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Crossing demo.
 */
const CrossingNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>A scene swap that never takes a photograph</h2>
      <p class="dive-lede">
        <code>&lt;c.Crossing&gt;</code>
        is the canned version of a whole-subtree swap: leaves fade, the paired
        flight carries, arrivals land near the settle. It is written in nothing
        but the public step vocabulary — no privileged access, no snapshot. The
        absence of that snapshot is the entire point, and it is why this demo is
        full of things that move on their own.
      </p>
    </header>

    <section class="dd">
      <h3>Why the video is here</h3>
      <div class="dd-col">
        <p>
          The View Transitions API animates by capturing the old scene and the
          new one as images and crossfading between them. For static content
          that is invisible and cheap. For a
          <code>&lt;video&gt;</code>, an auto-scrolling pane or a spinning mark,
          it is a freeze: the picture stops on whatever frame the capture
          caught, holds for the length of the transition, and then jumps to
          wherever the live element got to in the meantime.
        </p>
        <p>
          A crossing moves real elements. The plate flies as a box, and its
          innards reflow inside it and keep running. Nothing here is a
          participant except the plate itself — the video, the tape and the
          meter are just content that happens to live in a box that is moving.
          That is the whole trick, and you cannot see it in a still image, which
          is why this tile is the demo rather than a diagram of one.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Counterparts: two skins in one flying box</h3>
      <div class="dd-col">
        <p>
          The title, the kicker and the chip are different strings on every
          slide, so they cannot simply move — there is no single element that
          exists on both sides. They pair by
          <code>id</code>
          instead: the outgoing one and the incoming one are counterparts, and
          the crossing flies one box while dissolving the old skin into the new
          inside it.
        </p>
        <p>
          <code>pack="content"</code>
          is what makes that read on type. The two strings have different
          widths, and packing measures the shrink-wrapped content rather than a
          stretched frame, so "Tide" becoming "Ember" is a crossfade between two
          correctly-sized words rather than two smeared boxes.
        </p>
        <p>
          The inset caption inside the plate is itself a counterpart, so a skin
          crosses
          <em>while its parent is still flying</em>
          — a crossing nested inside a move, which is the case that breaks naive
          implementations.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Shadows are lights, not values</h3>
      <div class="dd-col">
        <p>
          Tide's shadow is a tight teal, Ember's is a huge warm bloom, Violet's
          is a small black. It is tempting to animate
          <code>box-shadow</code>
          between them, and it is wrong twice over: the browser reparses and
          rebuilds the shadow string every frame, and the interpolation drags
          the colour through mud on the way.
        </p>
        <p>
          So each rest-state shadow is its own caster element with a static
          <code>box-shadow</code>, and only opacity crossfades between them —
          the same grammar the crossing uses for skins. Three lights, one dimmer
          each.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Cutting mid-flight</h3>
      <div class="dd-col">
        <p>
          Press
          <kbd>&gt;</kbd>
          twice quickly, or leave it on Stress, and the next cut lands while the
          last one is still in the air. There is no
          <code>moving</code>
          flag and nothing to wait for: the run is replaced, and every sprite
          starts its new flight from wherever it currently is rather than from
          where it was supposed to have finished.
        </p>
        <p>
          The intra-slide loops are the one thing that has to yield. They are
          CSS transforms on the motion nodes themselves, so they would fight the
          transform the flight is writing.
          <code>data-phase="crossing"</code>
          stills them for the span of the run and they restart from rest on
          landing — which is also why the phase is printed in the HUD.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>The tile and the page are one component</h3>
      <div class="dd-col">
        <p>
          This card and
          <code>/crossing-stress</code>
          are the same file with an
          <code>@embedded</code>
          flag. The page owns the viewport, listens on
          <code>window</code>
          and drifts a three.js field behind the slides; the tile stays in flow,
          keeps its keys to itself, and drops the field, whose perpetual
          animation frame would otherwise run behind every other demo in the
          gallery.
        </p>
        <p>
          Everything that differs is containment. The slide geometry is written
          once, in multiples of a unit token that resolves to viewport units on
          the page and container units in the card — so the layout arithmetic
          cannot drift between the two. An earlier
          <code>/crossing-reel</code>
          route was a hand-copied second scene, and it had already fallen out of
          step with the demo it was copied from.
        </p>
      </div>
    </section>
  </section>
</template>;

export default CrossingNotes;
export { CrossingNotes };
