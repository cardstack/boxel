import type { TOC } from '@ember/component/template-only';

import { CodeBox } from '../shell/code-box';

const SCORE = `<c.Parallel>
  <c.Move @of={{c.moved}} @spring={{GLIDE}} />
  <c.Tween @of={{c.inserted 'note'}} @opacity={{array 0 1}} @duration={{0.32}} />
  <c.Tether @from={{c.id 'm-gauge'}} @to={{c.id 'c-gauge'}}
    @path={{PATH_GAUGE}} />
  <c.Tether @from={{c.id 'm-edition'}} @to={{c.id 'c-edition'}}
    @path={{PATH_EDITION}} />
  <c.Tether @from={{c.id 'm-hed'}} @to={{c.id 'c-hed'}}
    @path={{PATH_HED}} />
</c.Parallel>`;

const PATH = `curve = (lift) => (a, b) => {
  const x1 = a.x + a.width, y1 = a.y + a.height / 2;
  const x2 = b.x, y2 = b.y + b.height / 2;
  const mx = (x1 + x2) / 2;
  return \`M \${x1} \${y1} C \${mx} \${y1 + lift}, \${mx} \${y2 + lift}, \${x2} \${y2}\`;
};`;

/**
 * Deep dive for the Wires demo.
 */
const WiresNotes: TOC<object> = <template>
  <section class='dive' aria-label='How it works'>
    <header class='dive-head'>
      <p class='dive-kicker'>How it works</p>
      <h2>A wire is not an animation you play</h2>
      <p class='dive-lede'>
        It is a path derived from two live boxes, every frame and every still.
        The old proof of this was an ERD that measured after layout, painted
        SVG, then measured
        <em>once more late</em>
        — an 800ms constant standing in for a fact the timeline already knows.
        This page is a draft with comments: the same construct, aimed at track
        changes.
      </p>
    </header>

    <section class='dd'>
      <p class='dd-fn'>c.Tether · @path<span>the thread</span></p>
      <h3>Both boxes, now</h3>
      <div class='dd-col'>
        <p>
          <code>@path</code>
          receives the two sprites' region-relative boxes and returns path data.
          One function, a cubic — the lift fans overlapping threads so they
          share a gap without an elbow. The first comment is selected on load,
          so one thread is always drawn. Hover or tap another mark or comment to
          move it — the selection sticks; it does not clear on leave.
        </p>
        <p>
          A tether with no
          <code>@duration</code>
          occupies the enclosing block — here, the move. Connected threads keep
          their path nodes: V2 moves the word, and the cubic is asked again on
          every frame of the spring — not torn down and faded back in. A new
          comment inserts a new path; stepping back removes it.
        </p>
      </div>
      <CodeBox @label='wires.gts' @source={{PATH}} />
    </section>

    <section class='dd'>
      <p class='dd-fn'>moved · inserted<span>the draft</span></p>
      <h3>The comment keeps its name</h3>
      <div class='dd-col'>
        <p>
          Three versions of one morning note. The prose grows; the highlight
          named
          <code>m-gauge</code>
          walks from "rose overnight" to "the gauge is the story"; Maya's
          comment, still
          <code>c-gauge</code>, updates in place and
          <code>moved</code>
          with the thread attached. Jo's note is
          <code>inserted</code>
          at V2 and
          <code>removed</code>
          if you step back — the tether follows the leaver, then detaches.
        </p>
        <p>
          Resting ink is the same
          <code>@path</code>
          functions, measured once the layout is still, and hidden for the
          window a live
          <code>[data-choreo-tether]</code>
          exists. Hot is an attribute on the region, not a tracked write — a
          tracked hover would restart the run.
        </p>
      </div>
      <CodeBox @label='wires.gts' @source={{SCORE}} />
    </section>
  </section>
</template>;

export default WiresNotes;
export { WiresNotes };
