import type { TOC } from '@ember/component/template-only';
import { CodeBox } from 'test-app/components/code-box';

const SCORE = `<c.Sequence>
  <c.Tween @of={{c.id 'title'}} @opacity={{array 0 1}} … />
  <c.Gate @delay={{0.72}} />
  <c.Tween @of={{c.id 'kicker'}} … />
  <c.Gate />
  <c.Move @of={{c.id 'hull'}} @from={{c.beacon 'approach'}}
    @path={{APPROACH}} @rotate='auto' … />
  <c.Gate />
  <c.Tween @of={{c.id 'marks'}} @opacity={{array 0 1}} … />
  <c.Gate />
  <c.Tween @of={{c.id 'stamp'}} @scale={{array 0.86 1.08 1}} … />
</c.Sequence>`;

const ADVANCE = `tap = () => this.c?.advance();
// parked  → opens the gate
// in flight → completes the segment, then parks
// play() does neither`;

/**
 * Deep dive for the Presentation demo.
 */
const PresentationNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>A run that parks</h2>
      <p class="dive-lede">
        A click does not start an animation. It opens a gate in a score that is
        already compiled. While you wait, the run is a still — settled, nothing
        in flight, the next beat not yet begun. That is Keynote’s driver: not
        time, the click.
      </p>
    </header>

    <section class="dd">
      <p class="dd-fn">c.Gate · c.advance()<span>the click</span></p>
      <h3>Advance is not play()</h3>
      <div class="dd-col">
        <p>
          <code>play()</code>
          would unpause a paused clock, and everything queued behind the pause
          would run. A gate is a named still in the cue list. Linger and the
          rest of the slide has not started. Mash during a beat and you do not
          skip it: every property lands on its segment-end value, then you sit
          at the next gate. That is Keynote’s click-through.
        </p>
        <p>
          The kicker writes itself ~0.7s after the title, on a
          <code>@delay</code>
          gate you never clicked. Some beats are the presenter’s; one is the
          slide’s. Both belong on the timeline — audience time is a cue, not a
          <code>setTimeout</code>.
        </p>
      </div>
      <CodeBox @label="presentation.gts" @source={{SCORE}} />
      <CodeBox @label="presentation.gts" @source={{ADVANCE}} />

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 220"
          role="img"
          aria-label="A timeline split by three gates. Title plays, a delay
            gate auto-opens into the kicker, then two presenter gates park
            before the path and before the stamp."
        >
          <text class="dg-eb" x="20" y="24">ONE PASS, THREE STILLS</text>
          <line class="dg-rule" x1="40" y1="190" x2="860" y2="190" />

          <rect class="dg-box" x="40" y="70" width="120" height="36" rx="6" />
          <text class="dg-t" x="100" y="93" text-anchor="middle">title</text>

          <rect class="dg-hot" x="176" y="78" width="10" height="20" rx="2" />
          <text
            class="dg-t is-hot"
            x="181"
            y="60"
            text-anchor="middle"
          >auto</text>

          <rect class="dg-box" x="204" y="70" width="100" height="36" rx="6" />
          <text class="dg-t" x="254" y="93" text-anchor="middle">kicker</text>

          <rect class="dg-cop" x="320" y="62" width="12" height="52" rx="2" />
          <text
            class="dg-t is-cop"
            x="326"
            y="56"
            text-anchor="middle"
          >click</text>

          <rect class="dg-box" x="350" y="70" width="220" height="36" rx="6" />
          <text class="dg-t" x="460" y="93" text-anchor="middle">path · hull</text>

          <rect class="dg-cop" x="586" y="62" width="12" height="52" rx="2" />
          <text
            class="dg-t is-cop"
            x="592"
            y="56"
            text-anchor="middle"
          >click</text>

          <rect class="dg-box" x="616" y="70" width="140" height="36" rx="6" />
          <text class="dg-t" x="686" y="93" text-anchor="middle">pulse</text>

          <text class="dg-t is-faint" x="40" y="140">mash mid-path: the stroke
            finishes, then you park. same score.</text>
          <text class="dg-t is-faint" x="40" y="162">the cursor only moves
            forward. Replay is the only reverse.</text>
        </svg>
      </figure>
    </section>

    <section class="dd">
      <p class="dd-fn">@path · keyframes<span>the ride-alongs</span></p>
      <h3>A path move and a pulse, because Keynote would</h3>
      <div class="dd-col">
        <p>
          Neither construct has a page of its own. The hull flies from a beacon
          at the approach to the berth, and
          <code>@path</code>
          bends that journey — similarity-mapped, so the curve never moves the
          landing. The stamp is a round-trip scale,
          <code>{{"{{array 0.86 1.08 1}}"}}</code>
          , Keynote’s emphasis: it ends where it began.
        </p>
        <p>
          Build Order is the inspector. Playhead is the clock in your hand.
          Presentation is the clock that waits for the room. Slides 02 and 04
          keep a nested
          <code>&lt;Choreo&gt;</code>
          — an inner region the outer score cannot see — so a click that opens a
          gate can hand the rest of the slide to a second timeline (word
          delivery, a rule that grows, a pulse). Slide 03 clicks each station in
          after the line has drawn — one gate, one point. Between slides,
          <code>Presence</code>
          crossfades in
          <code>sync</code>
          : fade, rise, scale, or push, from the control in the bar.
        </p>
      </div>
    </section>
  </section>
</template>;

export { PresentationNotes };
export default PresentationNotes;
