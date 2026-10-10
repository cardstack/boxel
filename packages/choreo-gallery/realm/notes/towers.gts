import type { TOC } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import type { NotesSignature } from '../demo';

/**
 * Deep dive for the Towers film — the wall plate under the exhibit.
 * Follows the house dive template (see notes/sylva.gts); the one film-only
 * element is the strip of live junction triggers: @preview plays a join
 * over the film in the stage above. The demo page passes it while the
 * film's frame is attached, so the strip shows before the film can play
 * anything: a join plays once the viewer has opened the film.
 */
const TowersNotes: TOC<NotesSignature> = <template>
  <section class='dive' aria-label='How it works'>
    <header class='dive-head'>
      <p class='dive-kicker'>The cutting room</p>
      <h2>This is not a video</h2>
      <p class='dive-lede'>
        The picture above is not footage and was never a file. It is a live
        composite — a 3D scene, motion graphics and a score — rendered in your
        browser at whatever size the frame has, and responsive the way a page
        is: resize it and the shot reframes, the type re-sets, the bar re-lays.
        It has interactive chapters — skip anywhere and the film re-cuts itself
        from that shot — and its own audio mixer: music, effects, weather and
        voice on separate buses, ducked and faded live. Underneath, a three.js
        construction study driven through a one-block bridge, shot by a camera
        the score authors, graded in a fullscreen shader, mixed on a Web Audio
        graph, narrated from per-beat reads, and EDITED — cuts, wipes,
        dissolves, dips — by the same timeline that delivers the type. This page
        is about the editing half: what it means for a motion timeline to
        splice.
      </p>
    </header>

    <section class='dd'>
      <h3>About this film</h3>
      <div class='dd-col'>
        <p>
          Towers was made the way a short film is made, with the same care and
          the same jobs — a script, a shot list, a colourist's pass, a sound
          mix, a cutting room, a premiere — and none of it was shot. Every frame
          is generated: the building is a three.js scene, the camera is a score,
          the grade is a shader, the voice is synthesised, the music and the
          weather are mixed live on a Web Audio graph, and the whole thing is
          composited in your browser as you watch it, at whatever size you give
          it. It is entirely generated with AI, and it is directed by a human.
          The direction is the part that cannot be generated: which shot follows
          which, where the day runs out, how long the silence lasts after the
          roof closes, when the rain is allowed and when it is not, what the
          snow is for. Those calls were made one at a time, watched, and made
          again, the way an edit is made — and the film argues that this is what
          motion graphics on the web can now be: not a video embedded in a page,
          but a film that
          <em>is</em>
          the page, with chapters you can enter, a mixer you can touch, and a
          picture that has never been a file.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>One clock, one path</h3>
      <div class='dd-col'>
        <p>
          The whole film is a single
          <code>c.Camera3D</code>
          step: every beat contributes waypoints to one spline — one per tick,
          two seconds each — and every cue in the film (a line of narration, a
          stage mark rising, an eave tracing itself) is a
          <code>c.Perform</code>
          delay into that same clock. There is no playlist to drift out of sync,
          because there is nothing to sync: the shot list and the script are one
          object, and a beat buys screen time by contributing waypoints. A hold
          is authorable — repeated points on the spline come to rest and leave
          again — and since the splices landed, a hold also
          <em>breathes</em>: a shot with no authored tail drifts a few degrees
          of orbit on its own, so no frame is ever dead.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Splices</h3>
      <div class='dd-col'>
        <p>
          A waypoint marked
          <code>cut: true</code>
          splits the path into SHOTS. Each side is sampled as its own clamped
          spline — endpoint tangents are one-sided, so no shot's velocity is
          polluted by a pose across the seam — and the sampled pose is a step
          function at the cut waypoint's own instant. Waypoints keep their
          uniform slots, so every cue keeps its clock; the outgoing shot plays
          <em>through</em>
          the seam rather than parking; a cut on the first waypoint drops the
          pose-in-force seed, which is how a chapter skip opens inside its shot
          instead of gliding in from wherever the last run left the lens. The
          principle under all of it: a cut is a point where nothing may
          interpolate, integrate, or resample across the boundary. Discontinuity
          is not the bug — machinery that smooths over it is.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Junctions — try them on the film above</h3>
      <div class='dd-col'>
        <p>
          A seam carries a policy, not just a location. Eleven joins cover the
          grammar, on two tricks. The still-based joins — wipe, blur, luma,
          iris, dip — ride a synchronous snapshot: the bridge renders one frame
          on demand and reads the canvas back, so the outgoing picture is
          captured the instant before the cut and the transition plays on that
          still while the live shot runs underneath. The dissolves — blend and
          melt — moved into the glass: the page holds the outgoing frame on the
          GPU and mixes it in the post pass, and when nothing but the lens
          changes across the seam it keeps the outgoing camera ALIVE, cloned
          with its last velocity, so both shots move under the dissolve. The
          wipe's sweep is two compositor transforms — a masked sheet slides, the
          still inside slides back — because a mask that moves repaints a
          full-resolution frame every tick and stutters. Open the film above,
          then click any of these and it happens upstairs, right now, over
          whatever is playing:
        </p>
        {{#if @preview}}
          <div class='dd-joins'>
            <button type='button' {{on 'click' (fn @preview 'wipe')}}>wipe<i
              >feathered, raked to the sun</i></button>
            <button type='button' {{on 'click' (fn @preview 'blend')}}>blend<i
              >push dissolve</i></button>
            <button type='button' {{on 'click' (fn @preview 'blur')}}>blur<i
              >defocus dissolve</i></button>
            <button type='button' {{on 'click' (fn @preview 'luma')}}>luma<i
              >highlights linger</i></button>
            <button type='button' {{on 'click' (fn @preview 'iris')}}>iris<i
              >closes on the subject</i></button>
            <button type='button' {{on 'click' (fn @preview 'dip')}}>dip<i
              >through a colour</i></button>
            <button type='button' {{on 'click' (fn @preview 'flash')}}>flash<i
              >two-breath pop</i></button>
            <button
              type='button'
              {{on 'click' (fn @preview 'defocus')}}
            >defocus<i>rack focus</i></button>
            <button type='button' {{on 'click' (fn @preview 'sweep')}}>sweep<i
              >the sun flares</i></button>
            <button type='button' {{on 'click' (fn @preview 'whip')}}>whip<i>a
                fast chased tween</i></button>
          </div>
        {{else}}
          <p>
            (The live triggers appear here once the film above is on the page.)
          </p>
        {{/if}}
        <p>
          In the film each is placed where it means something: the ground is
          wiped in under the title, the matchlock guns arrive on the flash, the
          construction chapter comes in through black because a standing keep
          cannot be wiped off a field, the prang arrives on the slow melt, and
          the coda takes the closing dissolve. Under a still-based join the
          hour, the weather, the sun and the grade SNAP at the seam — the still
          already wears the old light, so a crossfade underneath it would be the
          old shot dressed wrong.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Linked tracks, independent seams</h3>
      <div class='dd-col'>
        <p>
          Every track crosses a seam on its own clock, the way an editor lays
          audio. The sound is one Web Audio graph: music, effects, weather and
          voice on their own buses into one master, so mute means all of it and
          the fader on the bar is one gain. A line is a decoded buffer on the
          voice bus with a 70 ms rise; a new line lets the old one down over
          ~120 ms rather than guillotining it. While a line plays the music
          ducks fast on an S-curve and recovers slow, and the weather bed ducks
          with it — rain at full bed over a sentence is the sentence lost. A
          seam into a silent shot is an L-cut: the sentence finishes over the
          new picture and the music lifts when it lands. A beat that is
          <em>about</em>
          silence asks for quiet by name. Each country's bed arrives and leaves
          over three seconds, and every read is normalised in the file to the
          same level, so nothing needs trimming to meet anything.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Navigation is an edit</h3>
      <div class='dd-col'>
        <p>
          Chapter skip does not seek. The lens is an integrator whose pose
          depends on where it has been, so a run dropped into the middle of
          itself arrives with the wrong velocity. Skipping RE-CUTS instead: the
          beat list is sliced, and the path, the cues and the sequence's name
          change together — the region plays a different, shorter film whose
          first waypoint is spliced. The head beat is applied exactly once per
          cut: the cut applies it so the picture is right before the run exists,
          and the run's first cue, which names the same beat a pass later, is
          skipped — applying it twice ran the join twice. The player along the
          foot of the frame is the same re-cut wearing the grammar every viewer
          knows: one segment per chapter sized by running time, a knob on the
          fill's own end, a hover bubble naming the shot under the hand, and a
          drag that reads as time and releases as an edit. Pause holds
          everything at once — the score's run, the page's own clock (grass,
          weather, build, day), the audio graph — and resume shifts the beat
          clock by the length of the hold, so the hours and the type pick up
          where they stood.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>The bridge</h3>
      <div class='dd-col'>
        <p>
          The scene is a page from
          <a
            href='https://threeui.com/browse'
            target='_blank'
            rel='noopener noreferrer'
          >threeui</a>
          by
          <a
            href='https://x.com/MengTo'
            target='_blank'
            rel='noopener noreferrer'
          >Meng To</a>, vendored whole on its own pinned three r149 and reached
          through one function-call bridge: pose goals for a cascaded camera
          chase, annotation tubes drawn on the geometry itself, a shader post
          pass that converts the linear render to sRGB before it grades (grain,
          edge aberration, a per-chapter and per-country grade with its own
          contrast and warmth, no vignette), the sun moved per shot, the air
          thickened per shot, snow that settles and rain that leaves the ground
          wet, a frame budget that owns the pixel ratio, a master fader and a
          hold — and the one-frame synchronous snapshot that makes every
          still-based join possible. The full design note lives at
          <code>docs/choreo-splices.md</code>; the quality pass and its numbers
          in
          <code>notes/towers-quality.md</code>.
        </p>
      </div>
    </section>
  </section>
</template>;

export default TowersNotes;
