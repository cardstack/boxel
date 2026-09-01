import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Sylva demo.
 */
const SylvaNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>Live DOM, hole-punched into a shader world</h2>
      <p class="dive-lede">
        The world is Meng To's "Living Green" (threeui), vendored whole on its
        own three r149. The cards are not textures — they are real DOM under
        the canvas, each shown through a hole the scene cuts at its exact
        pose, so a branch nearer the camera hides a card the way it hides
        anything else. The field buttons are live: occluded by moss and still
        pressable, and pressing one reaches back into the world.
      </p>
    </header>

    <section class="dd">
      <h3>Three claims, one route</h3>
      <div class="dd-col">
        <p>
          Every earlier stage put DOM behind a hole a model already owned — a
          phone's display, a laptop's screen. This route proves the free
          cases: a card anchored to a bare point in a scene, with a
          hole-punch proxy we author; several at once, which needs the DOM's
          paint order re-sorted to match view depth every frame; and input,
          where a press on an occluded card is raycast against the wood
          first, so the moss keeps the clicks that belong to it.
        </p>
        <p>
          The hole wears the card's entrance. The grow-out-of-the-dot spring
          is integrated by the host and written to the shell's style and the
          hole's pose from the same numbers in the same frame — one writer,
          so the two rectangles cannot disagree even for a frame.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>A camera that never stops</h3>
      <div class="dd-col">
        <p>
          The whole lap is one
          <code>c.Camera3D</code>
          step: a
          <code>@through</code>
          path — title drift, eight reading swings, the way home — splined on
          a single clock, so the camera crosses every waypoint with
          continuous velocity instead of parking at seams. The aim rides in
          the waypoints via
          <code>@look</code>, the orbit centre tweened with the pose. Cards
          are presented by
          <code>c.Perform</code>
          cues clipped into the path with
          <code>@at</code>
          and
          <code>@delay</code>, each open swapping the last card out
          mid-flight — a cross-fade, never a cut.
        </p>
        <p>
          Under it, the lens chases the score through two cascaded
          critically-damped springs — Drift's rule, a score for the scene
          change and a loop for the simulation — so velocity, acceleration
          and jerk all cross every seam. The score stays a pure function of
          the clock; the chaser is just the dolly's mass.
        </p>
      </div>
    </section>
  </section>
</template>;

export default SylvaNotes;
export { SylvaNotes };
