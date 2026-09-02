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
  Args: { preview?: (join: string) => void };
}> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">The cutting room</p>
      <h2>A hundred and forty-four years, cut by a score</h2>
      <p class="dive-lede">
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

    <section class="dd">
      <h3>The record is the script</h3>
      <div class="dd-col">
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

    <section class="dd">
      <h3>The junctions, live</h3>
      <div class="dd-col">
        <p>
          Each button plays one join over the running picture — no beat change,
          no snap — the transition itself, exhibited.
        </p>
        {{#if @preview}}
          <p class="dd-joins">
            <button
              type="button"
              {{on "click" (fn @preview "wipe")}}
            >wipe</button>
            <button
              type="button"
              {{on "click" (fn @preview "blend")}}
            >blend</button>
            <button
              type="button"
              {{on "click" (fn @preview "blur")}}
            >blur</button>
            <button
              type="button"
              {{on "click" (fn @preview "luma")}}
            >luma</button>
            <button
              type="button"
              {{on "click" (fn @preview "iris")}}
            >iris</button>
            <button
              type="button"
              {{on "click" (fn @preview "dip")}}
            >dip</button>
            <button
              type="button"
              {{on "click" (fn @preview "flash")}}
            >flash</button>
            <button
              type="button"
              {{on "click" (fn @preview "whip")}}
            >whip</button>
          </p>
        {{/if}}
      </div>
    </section>
  </section>
</template>;

export default SagradaNotes;
