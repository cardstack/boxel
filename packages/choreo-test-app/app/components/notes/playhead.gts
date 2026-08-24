import type { TOC } from '@ember/component/template-only';
import { CodeBox } from 'test-app/components/code-box';

const BIND =
  "{{motion animate=(this.pose 'pill') transition=(this.tx 'pill')}}";

const BEATS = `const BEATS = [
  { kind: 'hold',                    ms: 340 },
  { kind: 'move',  cue: 'express',   ms: 620 },
  { kind: 'press', cue: 'express',   ms: 220 },
  { kind: 'hold',                    ms: 360 },
];

const { clips, duration } = compile(BEATS);`;

const DISPATCH = `this.stage.querySelector('[data-cue="' + cue + '"]').click();`;

const FLIGHT = `interface Flight { from: number; since: number; to: number }

const gen = spring({ keyframes: [flight.from, flight.to], ...spec });
const { value } = gen.next(t - flight.since);`;

const POSES = `get poses() {
  return this.scored
    ? poseAt(this.t, MOMENTS, posesOf, SPRINGS)
    : posesOf(this.state);
}

tx = (name) => this.scored ? { duration: 0 } : TWEENS[name];`;

const SEEK = `seek(t) {
  this.t = t;
  this.state = stateAt(t, MOMENTS);
  this.fired = HITS.filter(c => hitAt(c) <= t).length;
  this.paint();
}`;

/**
 * Deep dive for the Playhead demo.
 */
const PlayheadNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>Two clocks, one score</h2>
      <p class="dive-lede">
        Pressing play and dragging the scrubber look the same, but they work
        differently. Playing runs an animation. Scrubbing calculates what the
        animation would have looked like at any point in time. Everything else —
        the buttons, the springs, the elements — is shared between the two.
      </p>
    </header>

    <section class="dd">
      <p class="dd-fn">compile()<span>lib/score.ts</span></p>
      <h3>The score is a list of actions, not a timeline</h3>
      <div class="dd-col">
        <p>
          You do not write coordinates or timestamps. You write actions: move
          there, click it, wait. Each beat specifies what kind of action, how
          long it takes, and which button it targets. The absolute times are
          computed by adding up the durations.
        </p>
      </div>
      <CodeBox @label="lib/score.ts" @source={{BEATS}} />
      <div class="dd-col">
        <p>
          The click does not fire at the start of a press beat. It fires
          <strong>42% of the way in</strong>. A real hand presses down, the
          button fires, and the hand comes back up. Clicking partway through the
          beat is what makes it look like a press instead of a teleport.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 200"
          role="img"
          aria-label="Beats are compiled into clips on a timeline. Each click
            fires at 42 percent of the way through its press beat."
        >
          <text class="dg-eb" x="20" y="26">WHAT YOU WRITE</text>

          <rect class="dg-box" x="20" y="40" width="128" height="38" rx="5" />
          <rect class="dg-box" x="148" y="40" width="234" height="38" rx="5" />
          <rect class="dg-hot" x="382" y="40" width="83" height="38" rx="5" />
          <rect class="dg-box" x="465" y="40" width="136" height="38" rx="5" />
          <rect class="dg-box" x="601" y="40" width="196" height="38" rx="5" />
          <rect class="dg-hot" x="797" y="40" width="83" height="38" rx="5" />

          <text
            class="dg-t is-dim"
            x="84"
            y="64"
            text-anchor="middle"
          >wait</text>
          <text class="dg-t" x="265" y="64" text-anchor="middle">go to "express"</text>
          <text
            class="dg-t is-hot"
            x="423"
            y="64"
            text-anchor="middle"
          >click</text>
          <text
            class="dg-t is-dim"
            x="533"
            y="64"
            text-anchor="middle"
          >wait</text>
          <text class="dg-t" x="699" y="64" text-anchor="middle">go to "gift
            wrap"</text>
          <text
            class="dg-t is-hot"
            x="838"
            y="64"
            text-anchor="middle"
          >click</text>

          <text class="dg-eb" x="20" y="112">WHAT IT BECOMES</text>
          <line class="dg-rule" x1="20" y1="140" x2="880" y2="140" />
          <g class="dg-rule">
            <line x1="20" y1="134" x2="20" y2="146" />
            <line x1="148" y1="134" x2="148" y2="146" />
            <line x1="382" y1="134" x2="382" y2="146" />
            <line x1="465" y1="134" x2="465" y2="146" />
            <line x1="601" y1="134" x2="601" y2="146" />
            <line x1="797" y1="134" x2="797" y2="146" />
            <line x1="880" y1="134" x2="880" y2="146" />
          </g>

          <g class="dg-emberline dg-dash">
            <line x1="417" y1="78" x2="417" y2="136" />
            <line x1="832" y1="78" x2="832" y2="136" />
          </g>
          <circle class="dg-dot" cx="417" cy="140" r="4.5" />
          <circle class="dg-dot" cx="832" cy="140" r="4.5" />

          <text class="dg-t is-hot" x="417" y="166" text-anchor="middle">click
            at 1052 ms</text>
          <text class="dg-t is-hot" x="880" y="166" text-anchor="end">click at
            2152 ms</text>
          <text class="dg-t is-faint" x="20" y="190">click time = beat start +
            42% of the beat</text>
        </svg>
        <figcaption>
          You never write a time. Times are computed by adding up beat
          durations.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <p class="dd-fn">ghostAt(t)<span>lib/score.ts</span></p>
      <h3>The cursor position is computed, not animated</h3>
      <div class="dd-col">
        <p>
          Give
          <code>ghostAt</code>
          a time and it returns four numbers: the pointer's x and y position,
          and how hard it is pressing. Nothing is running. You can ask it about
          1.2 seconds and it answers. Ask about 0.8 seconds next and it answers
          that too. It works in any order.
        </p>
        <p>
          It finds which beat that time falls in. If it is a move beat, it
          interpolates between the previous button and the next one. Otherwise
          the pointer sits still on a button.
        </p>
        <p>
          Two details keep it from looking mechanical. The pointer accelerates
          and decelerates instead of moving at a constant speed, and the path
          curves slightly between buttons. The curve is widest in the middle and
          zero at both ends, so the pointer still lands exactly on target.
        </p>
        <p>
          Button positions are read from the page layout, not from where the
          button currently appears. Elements here move during animations, so
          asking "where does this button appear right now" would give a
          different answer every frame. The layout position is stable.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 250"
          role="img"
          aria-label="The pointer follows a curved path from one button to
            another, with easing at both ends."
        >
          <text class="dg-eb" x="20" y="22">WHERE THE POINTER GOES</text>

          <rect
            class="dg-plate"
            x="40"
            y="36"
            width="430"
            height="196"
            rx="10"
          />
          <rect class="dg-box" x="118" y="54" width="272" height="160" rx="8" />
          <rect
            class="dg-plate"
            x="138"
            y="72"
            width="112"
            height="26"
            rx="5"
          />
          <rect class="dg-hot" x="258" y="72" width="112" height="26" rx="5" />
          <rect
            class="dg-plate"
            x="138"
            y="112"
            width="232"
            height="30"
            rx="5"
          />
          <rect
            class="dg-plate"
            x="138"
            y="156"
            width="232"
            height="30"
            rx="5"
          />
          <text
            class="dg-t is-faint"
            x="194"
            y="89"
            text-anchor="middle"
          >standard</text>
          <text
            class="dg-t is-hot"
            x="314"
            y="89"
            text-anchor="middle"
          >express</text>
          <text class="dg-t is-faint" x="254" y="131" text-anchor="middle">gift
            wrap</text>
          <text class="dg-t is-faint" x="254" y="175" text-anchor="middle">place
            order</text>

          <path class="dg-cop dg-dash" d="M68,206 Q112,146 314,85" />
          <circle class="dg-faintdot" cx="68" cy="206" r="4" />
          <text
            class="dg-t is-faint"
            x="68"
            y="226"
            text-anchor="middle"
          >start</text>
          <path
            class="dg-hand"
            d="M314,85 l-1,15 l4.5,-4.5 l3.5,7 l3,-1.6 l-3.4,-6.8 l6.2,-0.6 z"
          />
          <circle class="dg-dot" cx="314" cy="85" r="2.5" />

          <path class="dg-cop dg-dash" d="M506,78 q14,-11 28,0" />
          <text class="dg-t is-dim" x="548" y="82">curved path, not a straight
            line</text>
          <path class="dg-inkline" d="M506,124 c7,0 7,-14 14,-14 s7,14 14,14" />
          <text class="dg-t is-dim" x="548" y="128">eases in and out</text>
          <g class="dg-emberline">
            <line x1="508" y1="166" x2="532" y2="166" />
            <line x1="520" y1="154" x2="520" y2="178" />
          </g>
          <text class="dg-t is-dim" x="548" y="170">aimed at the layout
            position, not the rendered one</text>
        </svg>
        <figcaption>
          Give it a time and it returns a position. No animation is running —
          the pointer is placed there directly.
        </figcaption>
      </figure>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 220"
          role="img"
          aria-label="During a click the pointer dips and springs back, while
            a ring spreads from the button and outlasts the beat."
        >
          <text class="dg-eb" x="20" y="22">WHAT A CLICK LOOKS LIKE</text>

          <rect class="dg-band" x="90" y="50" width="204" height="120" />
          <line class="dg-hair" x1="90" y1="50" x2="90" y2="170" />
          <line class="dg-rule" x1="90" y1="170" x2="830" y2="170" />

          <polyline class="dg-inkline" points="90,170 175,60 294,170 830,170" />
          <line class="dg-hotline" x1="175" y1="170" x2="694" y2="60" />
          <circle class="dg-dot" cx="694" cy="60" r="3.5" />

          <g class="dg-hair dg-dash">
            <line x1="175" y1="50" x2="175" y2="170" />
            <line x1="294" y1="60" x2="294" y2="170" />
            <line x1="694" y1="60" x2="694" y2="170" />
          </g>

          <text class="dg-t" x="175" y="44" text-anchor="middle">pointer dips</text>
          <text class="dg-t is-hot" x="694" y="44" text-anchor="middle">ring
            fades out</text>

          <text
            class="dg-t is-faint"
            x="90"
            y="192"
            text-anchor="middle"
          >0</text>
          <text
            class="dg-t is-faint"
            x="175"
            y="192"
            text-anchor="middle"
          >click</text>
          <text class="dg-t is-faint" x="294" y="192" text-anchor="middle">beat
            ends</text>
          <text class="dg-t is-faint" x="694" y="192" text-anchor="middle">+560
            ms</text>
        </svg>
        <figcaption>
          The ring outlasts the beat. It stays on the clicked button while the
          pointer moves on.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <p class="dd-fn">dispatch(t)<span>playhead.gts</span></p>
      <h3>The click is a real click</h3>
      <div class="dd-col">
        <p>
          When a click moment passes during playback, the script finds the
          actual button element and calls
          <code>.click()</code>
          on it. The button's own event handler runs, just as if a user had
          clicked it.
        </p>
      </div>
      <CodeBox @label="playhead.gts" @source={{DISPATCH}} />
      <div class="dd-col">
        <p>
          This matters because the timeline figures out a scrubbed state by
          replaying the same handler code. There is only one description of what
          each button does, so a scrubbed state can never disagree with a
          clicked state.
        </p>
      </div>
    </section>

    <section class="dd">
      <p class="dd-fn">poseAt(t)<span>lib/score.ts</span></p>
      <h3>Scrubbing solves the springs at any time</h3>
      <div class="dd-col">
        <p>
          Everything that moves on this stage is a number: how far across the
          pill is, how far over the switch knob is, how high the receipt is. A
          scrubbed frame is not just "which step are we on" — it can be halfway
          through a step.
        </p>
        <p>
          To compute the value at a given time, it replays the score from the
          beginning. For each animated value it tracks where it started, where
          it is heading, and when the destination changed. Every time a click
          changes the target, it records the current position as the new
          starting point and resets the clock.
        </p>
      </div>
      <CodeBox @label="lib/score.ts" @source={{FLIGHT}} />
      <div class="dd-col">
        <p>
          Then it asks the spring itself. A spring is a mathematical function:
          given the time since it started, it returns where it is. You can ask
          it about any moment, in any order, as many times as you like. That is
          exactly the property a scrubber needs — dragging backwards means
          asking about earlier times.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 320"
          role="img"
          aria-label="A chart of the pill's position over time: still at zero,
            springs to 127 after the first click, then springs back after the
            last click. A probe at 1250ms reads 120.1."
        >
          <text class="dg-eb" x="20" y="24">PILL POSITION OVER TIME</text>
          <line class="dg-hair dg-dash" x1="70" y1="80" x2="878" y2="80" />
          <line class="dg-hair dg-dash" x1="70" y1="240" x2="878" y2="240" />
          <line class="dg-rule" x1="70" y1="60" x2="70" y2="270" />
          <text
            class="dg-t is-faint"
            x="60"
            y="84"
            text-anchor="end"
          >right</text>
          <text
            class="dg-t is-faint"
            x="60"
            y="244"
            text-anchor="end"
          >left</text>

          <path
            class="dg-hotline"
            d="M70,240 L214,240 C232,240 244,104 264,74 C280,50 296,90 312,82
              C328,75 336,80 352,80 L768,80 C784,80 794,214 812,244
              C826,266 842,234 856,240 L878,240"
          />

          <g class="dg-rule">
            <line x1="214" y1="60" x2="214" y2="270" />
            <line x1="768" y1="60" x2="768" y2="270" />
          </g>
          <text class="dg-t is-dim" x="220" y="72">click — 1052 ms</text>
          <text class="dg-t is-dim" x="762" y="72" text-anchor="end">click —
            5092 ms</text>
          <text class="dg-t is-faint" x="220" y="288">heading right</text>
          <text class="dg-t is-faint" x="762" y="288" text-anchor="end">heading
            back left</text>

          <line class="dg-cop dg-dash" x1="242" y1="60" x2="242" y2="270" />
          <circle class="dg-copdot" cx="242" cy="119" r="4.5" />
          <text class="dg-t is-cop" x="252" y="140">scrub to 1250 ms → 120.1 px</text>
          <text class="dg-t is-faint" x="878" y="306" text-anchor="end">the
            overshoot is the same spring</text>
        </svg>
        <figcaption>
          Playing and scrubbing trace the same curve, because they use the same
          spring function. Scrub to 1120 ms and the pill is at 37.9 px; 1500 ms
          and it is at 128.4 — past the target, on its way back.
        </figcaption>
      </figure>

      <div class="dd-call">
        <p>
          <b>One limitation.</b>
          If a click changes the target while a value is mid-flight, the new
          spring starts from the right position but not the right velocity.
          Nothing jumps, so scrubbing looks correct — it is just slightly softer
          than the live version.
        </p>
      </div>
    </section>

    <section class="dd">
      <p class="dd-fn">get poses()<span>playhead.gts</span></p>
      <h3>One line separates the two modes</h3>
      <div class="dd-col">
        <p>
          The buttons, the springs, and the elements are all shared. The entire
          difference between playing and scrubbing is which of two values gets
          passed to the same element.
        </p>
      </div>
      <CodeBox @label="playhead.gts" @source={{POSES}} />
      <div class="dd-col">
        <p>
          Both end up on the same attribute —
          <code>{{BIND}}</code>. Playing passes a destination and a spring spec;
          the engine handles the animation. Scrubbing passes finished numbers
          and a zero-duration transition; the element jumps to position with no
          animation because the answer is already computed.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 400"
          role="img"
          aria-label="Two side-by-side flowcharts. Playing: a frame ticks,
            time advances, a click fires, the app updates, the element gets
            a destination and spring. Scrubbing: the slider moves, clicks are
            replayed, springs are solved, the element gets finished numbers."
        >
          <defs>
            <marker
              id="dd-ar"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            ><path class="dg-arrow" d="M0,0 L10,5 L0,10 z" /></marker>
          </defs>

          <text class="dg-h" x="40" y="22">PLAYING</text>
          <text class="dg-h is-hot" x="490" y="22">SCRUBBING</text>

          <rect class="dg-box" x="40" y="40" width="370" height="34" rx="6" />
          <text class="dg-t" x="56" y="62">a frame goes by</text>
          <rect class="dg-box" x="40" y="98" width="370" height="34" rx="6" />
          <text class="dg-t" x="56" y="120">advance time by the frame's duration</text>
          <rect class="dg-box" x="40" y="156" width="370" height="34" rx="6" />
          <text class="dg-t" x="56" y="178">if a click is due — fire the real
            click</text>
          <rect
            class="dg-boxcop"
            x="40"
            y="214"
            width="370"
            height="34"
            rx="6"
          />
          <text class="dg-t is-cop" x="56" y="236">the app updates its own state</text>
          <rect class="dg-box" x="40" y="272" width="370" height="34" rx="6" />
          <text class="dg-t" x="56" y="294">element gets a destination + a
            spring</text>

          <rect class="dg-box" x="490" y="40" width="370" height="34" rx="6" />
          <text class="dg-t" x="506" y="62">you drag the slider to a time</text>
          <rect class="dg-box" x="490" y="98" width="370" height="34" rx="6" />
          <text class="dg-t" x="506" y="120">replay the score from time zero</text>
          <rect
            class="dg-boxcop"
            x="490"
            y="156"
            width="370"
            height="34"
            rx="6"
          />
          <text class="dg-t is-cop" x="506" y="178">fold every click up to that
            time</text>
          <rect class="dg-hot" x="490" y="214" width="370" height="34" rx="6" />
          <text class="dg-t is-hot" x="506" y="236">solve the springs for that
            time</text>
          <rect class="dg-box" x="490" y="272" width="370" height="34" rx="6" />
          <text class="dg-t" x="506" y="294">element gets finished numbers, no
            spring</text>

          <g class="dg-rule" marker-end="url(#dd-ar)">
            <line x1="225" y1="76" x2="225" y2="94" />
            <line x1="225" y1="134" x2="225" y2="152" />
            <line x1="225" y1="192" x2="225" y2="210" />
            <line x1="225" y1="250" x2="225" y2="268" />
            <line x1="225" y1="308" x2="225" y2="336" />
            <line x1="675" y1="76" x2="675" y2="94" />
            <line x1="675" y1="134" x2="675" y2="152" />
            <line x1="675" y1="192" x2="675" y2="210" />
            <line x1="675" y1="250" x2="675" y2="268" />
            <line x1="675" y1="308" x2="675" y2="336" />
          </g>

          <rect
            class="dg-plate"
            x="40"
            y="340"
            width="820"
            height="42"
            rx="8"
          />
          <text class="dg-t is-dim" x="450" y="366" text-anchor="middle">the
            same buttons, the same springs, the same elements</text>
        </svg>
        <figcaption>
          Only the last step differs. Playing provides a destination; scrubbing
          provides the answer.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <p class="dd-fn">seek(t)<span>playhead.gts</span></p>
      <h3>Nothing needs to be disabled</h3>
      <div class="dd-modes">
        <div class="dd-mode">
          <span class="dd-tag">playing</span>
          <b>The engine drives</b>
          <p>Real clicks, real springs. The timeline shows progress.</p>
        </div>
        <div class="dd-mode">
          <span class="dd-tag">scored</span>
          <b>The timeline drives</b>
          <p>Paused or being dragged. All values are computed and set directly.</p>
        </div>
        <div class="dd-mode">
          <span class="dd-tag">live</span>
          <b>You drive</b>
          <p>Touch a control and the timeline steps aside.</p>
        </div>
      </div>
      <div class="dd-col">
        <p>
          You might expect the transport controls to be greyed out when you
          interact with the form directly. They are not. Seeking to a time never
          resumes from where it left off — it replays the entire score from zero
          up to that point.
        </p>
      </div>
      <CodeBox @label="playhead.gts" @source={{SEEK}} />
      <div class="dd-col">
        <p>
          Whatever you clicked by hand is not in the replayed sequence. Play,
          Reset, and the scrubber all go through
          <code>seek</code>, so all three reset the state cleanly and none of
          them needs special handling.
        </p>
      </div>
    </section>

    <section class="dd">
      <p class="dd-fn">advance(now)<span>playhead.gts</span></p>
      <h3>The playhead runs its own frame loop</h3>
      <div class="dd-col">
        <p>
          Each frame, the playhead adds the elapsed time since the last frame,
          capped at 50ms. If the browser gets busy — a background tab, a page
          with dozens of live demos — the timeline loses a fraction of a second
          rather than jumping forward to where the wall clock says it should be.
        </p>
        <p>
          The frame loop is separate from the animation engine's. A click
          dispatched by the playhead causes a re-render, and re-rendering runs
          the engine. A clock living inside the engine would be advanced by its
          own clicks.
        </p>
        <p>
          Playback also pauses when the card scrolls off screen, using an
          IntersectionObserver, and resumes when it returns.
        </p>
      </div>
    </section>

    <section class="dd">
      <p class="dd-fn">the boundary<span>what cannot be scrubbed</span></p>
      <h3>Only numbers can be rewound</h3>
      <div class="dd-col">
        <p>
          Everything on this stage moves by changing a number. That is
          deliberate. A spring is a mathematical function, so you can ask it
          about any point in time. Other kinds of animation are not.
        </p>
        <p>
          When an element moves because the layout changed, the engine works it
          out by measuring the page before and after. There is no function to
          query — only two measurements that already happened. The same applies
          to an element leaving the page: once it is gone, there is nothing to
          ask.
        </p>
        <p>
          That is why the sliding pill is a number instead of a layout
          animation, and why the receipt stays in the DOM invisibly instead of
          being removed. Making layout animations and exits queryable is the
          next piece to build.
        </p>
      </div>
    </section>
  </section>
</template>;

export default PlayheadNotes;
export { PlayheadNotes };
