import type { Join } from '@cardstack/choreo/film';
import type { TOC } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

/**
 * Deep dive for the Sagrada film — the wall plate under the exhibit, on
 * the house dive template (see notes/towers.gts). The one film-only
 * element is the strip of live junction triggers, wired to the film's
 * previewJoin through @preview.
 */
const SagradaNotes: TOC<{
  Args: { preview?: (join: Join) => void };
}> = <template>
  <section class='dive' aria-label='How it works'>
    <header class='dive-head'>
      <p class='dive-kicker'>The cutting room</p>
      <h2>A hundred and forty-four years, cut by a score</h2>
      <p class='dive-lede'>
        The picture above is a construction study of the Sagrada Família that
        grows the basilica on a clock in years — every part behind its own cut
        plane in the years it was built, the site works of each era, the city
        filling in round it decade by decade. The film reaches it through the
        same one-block bridge the Towers film uses, and cuts it with the same
        engine: one camera path for the whole film, one cue per beat, splices
        where the edit wants a cut. The difference is the subject. A keep is one
        tower on one axis; a basilica is a hundred metres long with three
        fronts, so every shot here also carries a FOCUS on the ground, and the
        script is written in years.
      </p>
    </header>

    <section class='dd'>
      <h3>About this film</h3>
      <div class='dd-col'>
        <p>
          Nothing here was shot. The basilica is a three.js scene assembled from
          the published plans, the camera is a score, the grade is a shader, the
          voice is synthesised, and the whole picture is composited in your
          browser at whatever size you give it — resize the frame and the shot
          reframes, the type re-sets, the rail re-lays. It is entirely generated
          with AI and directed by a human, and the direction is the part that
          cannot be generated: which shot follows which, how long the silence
          after the fire lasts, whether the crane crew is a joke or a held
          breath, where a century stops being a record and starts being a plan.
        </p>
        <p>
          It is also the second film on the same engine, which is the whole
          point of building one. Towers came first and the construct was cut out
          of it; this one was written against the construct, and everything it
          needed that Towers had not — a clock in years, a focus on the ground,
          exact seeking, photographic stocks — became an argument the construct
          now takes rather than a fork of it.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>The record is the script</h3>
      <div class='dd-col'>
        <p>
          Dates follow the official history: the cornerstone in 1882, Gaudí from
          1883, Barnabas in 1925, the fire of 1936, the Passion front from 1954,
          the naves to 2010, the star of Mary lit in December 2021, the cross of
          Jesus set in February 2026 and lit on the centenary of Gaudí's death.
          Beyond that the film plays the plan, and says so. A beat's
          <code>build</code>
          is authored with
          <code>tAt(year)</code>, which is the scene's own year-to-seconds table
          copied into the film so the two never disagree.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>A clock in years</h3>
      <div class='dd-col'>
        <p>
          Towers runs on seconds; this one runs on a century. The film hands the
          construct a
          <code>clock</code>
          — a span, a
          <code>tAt(year)</code>
          and a
          <code>yearAt(t)</code>
          — and from that one object the rail under the picture stops being a
          progress bar and becomes a date rule: the head rides it, the chapters
          are doors on it, and the readout says the year rather than the minute.
          The same table is what a beat's build clock is authored against, so
          the number on screen and the state of the stone can never disagree.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>A picture that is a function of one number</h3>
      <div class='dd-col'>
        <p>
          Towers is hand-held: the score authors a pose and the lens chases it
          through a damped stage, which is what gives that film its sway — and
          exactly what forfeits random access, because a spring's state is its
          history. A skip there is an edit; the score is re-cut from a chapter's
          head and replayed.
        </p>
        <p>
          This film says
          <code>@seek='exact'</code>
          instead, and gives up the hand to buy the scrub. There is no
          integrator in the pose path: the beat in force is derived from the
          clock, the type's run is seeked to it, the seams are driven by it.
          Drag the playhead anywhere and the frame is correct — the same frame
          you would have got by playing there, because every beat asserts its
          complete state and inherits nothing from the one before. A seek that
          lands in the middle of a dissolve re-makes the outgoing frame first,
          so the seam plays from its middle exactly as it would have played into
          it.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Three fronts, one path</h3>
      <div class='dd-col'>
        <p>
          A keep is one tower on one axis, and a camera that orbits it is always
          looking at the thing. A basilica is a hundred metres long with three
          fronts and a forest inside, so a pose here carries a focus on the
          ground as well as an orbit —
          <code>fx</code>
          and
          <code>fz</code>
          — and the shots that matter are the ones that walk the length of it
          rather than turn on the spot. It is still one camera step for the
          whole film: every beat contributes waypoints to a single spline, a
          hold contributes the same pose several times over, and a cut splices
          the path rather than travelling it.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>The junctions, live</h3>
      <div class='dd-col'>
        <p>
          Each button plays one join over the running picture — no beat change,
          no snap — the transition itself, exhibited.
        </p>
        {{#if @preview}}
          <p class='dd-joins'>
            <button
              type='button'
              {{on 'click' (fn @preview 'wipe')}}
            >wipe</button>
            <button
              type='button'
              {{on 'click' (fn @preview 'blend')}}
            >blend</button>
            <button
              type='button'
              {{on 'click' (fn @preview 'blur')}}
            >blur</button>
            <button
              type='button'
              {{on 'click' (fn @preview 'luma')}}
            >luma</button>
            <button
              type='button'
              {{on 'click' (fn @preview 'iris')}}
            >iris</button>
            <button
              type='button'
              {{on 'click' (fn @preview 'dip')}}
            >dip</button>
            <button
              type='button'
              {{on 'click' (fn @preview 'flash')}}
            >flash</button>
            <button
              type='button'
              {{on 'click' (fn @preview 'whip')}}
            >whip</button>
          </p>
        {{else}}
          <p class='dd-fn'>
            The strip is live on the film itself: open the picture above in
            Theater and the buttons play each join over the running frame.
          </p>
        {{/if}}
      </div>
    </section>
  </section>
</template>;

export default SagradaNotes;
