import type { TOC } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

/**
 * Deep dive for the Towers film — the wall plate under the exhibit.
 * Follows the house dive template (see notes/sylva.gts); the one film-only
 * element is the strip of live junction triggers, wired to the film's own
 * previewJoin through @preview.
 */
const TowersNotes: TOC<{
  Args: { preview: (join: string) => void };
}> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">The cutting room</p>
      <h2>A film with no video file, cut live by a score</h2>
      <p class="dive-lede">
        The picture above is not footage. It is a three.js construction study
        driven through a one-block bridge, shot by a camera the score
        authors, graded in CSS and a fullscreen shader, narrated from
        per-beat audio, and EDITED — cuts, wipes, dissolves, dips — by the
        same timeline that delivers the type. This page is about the editing
        half: what it means for a motion timeline to splice.
      </p>
    </header>

    <section class="dd">
      <h3>One clock, one path</h3>
      <div class="dd-col">
        <p>
          The whole film is a single
          <code>c.Camera3D</code>
          step: every beat contributes waypoints to one spline — one per
          tick, two seconds each — and every cue in the film (a line of
          narration, a stage mark rising, an eave tracing itself) is a
          <code>c.Perform</code>
          delay into that same clock. There is no playlist to drift out of
          sync, because there is nothing to sync: the shot list and the
          script are one object, and a beat buys screen time by contributing
          waypoints. A hold is authorable — repeated points on the spline
          come to rest and leave again — and since the splices landed, a
          hold also
          <em>breathes</em>: a shot with no authored tail drifts a few
          degrees of orbit on its own, so no frame is ever dead.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Splices</h3>
      <div class="dd-col">
        <p>
          A waypoint marked
          <code>cut: true</code>
          splits the path into SHOTS. Each side is sampled as its own
          clamped spline — endpoint tangents are one-sided, so no shot's
          velocity is polluted by a pose across the seam — and the sampled
          pose is a step function at the cut waypoint's own instant.
          Waypoints keep their uniform slots, so every cue keeps its clock;
          the outgoing shot plays
          <em>through</em>
          the seam rather than parking; a cut on the first waypoint drops
          the pose-in-force seed, which is how a chapter skip opens inside
          its shot instead of gliding in from wherever the last run left the
          lens. The principle under all of it: a cut is a point where
          nothing may interpolate, integrate, or resample across the
          boundary. Discontinuity is not the bug — machinery that smooths
          over it is.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Junctions — try them on the film above</h3>
      <div class="dd-col">
        <p>
          A seam carries a policy, not just a location. Eleven joins cover
          the grammar, every one riding a single trick: the bridge renders
          one frame on demand and reads the canvas back synchronously, so
          the outgoing picture is captured the instant before the cut and
          the transition plays on that still while the live shot runs
          underneath. Click any of these and it happens upstairs, right now,
          over whatever is playing:
        </p>
        <div class="dd-joins">
          <button
            type="button"
            {{on "click" (fn @preview "wipe")}}
          >wipe<i>feathered, raked to the sun</i></button>
          <button
            type="button"
            {{on "click" (fn @preview "blend")}}
          >blend<i>push dissolve</i></button>
          <button
            type="button"
            {{on "click" (fn @preview "blur")}}
          >blur<i>defocus dissolve</i></button>
          <button
            type="button"
            {{on "click" (fn @preview "luma")}}
          >luma<i>highlights linger</i></button>
          <button
            type="button"
            {{on "click" (fn @preview "iris")}}
          >iris<i>closes on the subject</i></button>
          <button
            type="button"
            {{on "click" (fn @preview "dip")}}
          >dip<i>through a colour</i></button>
          <button
            type="button"
            {{on "click" (fn @preview "flash")}}
          >flash<i>two-breath pop</i></button>
          <button
            type="button"
            {{on "click" (fn @preview "defocus")}}
          >defocus<i>rack focus</i></button>
          <button
            type="button"
            {{on "click" (fn @preview "sweep")}}
          >sweep<i>the sun flares</i></button>
          <button
            type="button"
            {{on "click" (fn @preview "whip")}}
          >whip<i>a fast chased tween</i></button>
        </div>
        <p>
          In the film each is placed where it means something: HISTORY
          arrives through black, the matchlock guns arrive on the flash, the
          rain beat comes in through its own mist, the stone racks into
          focus, the comparison plates enter through paper-white, and the
          coda takes the closing dissolve.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Linked tracks, independent seams</h3>
      <div class="dd-col">
        <p>
          Every track crosses a seam on its own clock, the way an editor
          lays audio. A sentence interrupted by a new line barge-fades over
          ~120ms on its
          <em>own</em>
          audio element while the new line starts clean on a fresh one — one
          throat per line, because a shared element guillotines the old take
          on the
          <code>src</code>
          swap no matter how politely you fade. A seam into a silent shot is
          an L-cut: the sentence finishes over the new picture and the music
          lifts when it lands. A beat that is
          <em>about</em>
          silence asks for quiet by name. The music bed ducks fast and
          recovers slow, and no boundary anywhere hard-clips a waveform.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Navigation is an edit</h3>
      <div class="dd-col">
        <p>
          Chapter skip does not seek. The lens is an integrator whose pose
          depends on where it has been, so a run dropped into the middle of
          itself arrives with the wrong velocity. Skipping RE-CUTS instead:
          the beat list is sliced, and the path, the cues and the sequence's
          name change together — the region plays a different, shorter film
          whose first waypoint is spliced. The transport at the top of the
          frame is the same re-cut wearing a broadcast bar: one segment per
          chapter, sized by real running time, filled by whole-film
          progress, each segment a door.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>The bridge</h3>
      <div class="dd-col">
        <p>
          The scene is a page from
          <a
            href="https://threeui.com/browse"
            target="_blank"
            rel="noopener"
          >threeui</a>
          by
          <a
            href="https://x.com/MengTo"
            target="_blank"
            rel="noopener"
          >Meng To</a>, vendored whole on its own pinned three r149 and
          reached through one function-call bridge: pose goals for a
          cascaded camera chase, annotation tubes drawn on the geometry
          itself, a shader post pass (grain, edge aberration, vignette, a
          milk lift into the blacks), the sun moved per shot, the air
          thickened per shot, the music ducked under the voice — and the
          one-frame synchronous snapshot that makes every freeze-based join
          possible. The full design note lives at
          <code>docs/choreo-splices.md</code>.
        </p>
      </div>
    </section>
  </section>
</template>;

export default TowersNotes;
