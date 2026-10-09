import type { TOC } from '@ember/component/template-only';

import { CodeBox } from '../shell/code-box';

const SCORE = `<c.Sequence>
  <c.Wait @of={{hand}} @duration={{0.34}} />
  <c.Tween @of={{hand}} @x={{this.walkX 'home' 'express'}}
    @y={{this.walkY 'home' 'express'}} @duration={{0.62}} />
  <c.Tween @name='press-express' @of={{hand}}
    @scale={{array 1 0.74 1}} @duration={{0.22}} />
  <c.Spring @at={{at 'press-express' 0.55}}
    @of={{pill}} @x={{array 0 127}} @spring={{PILL}} />
</c.Sequence>`;

const DISPATCH = `// the transport reads run.time; the score knows which
// button, never what the button does
while (this.pressAt[this.fired] <= run.time) {
  const cue = PRESSES[this.fired++];
  this.stage.querySelector('[data-cue="' + cue + '"]').click();
}`;

const STILL = `run.pause();
run.time = t;   // a computed still — either direction, any order`;

const FOLD = `fold(t) {
  let state = INITIAL;
  for (const [i, moment] of this.pressAt.entries()) {
    if (moment <= t) state = press(state, PRESSES[i]);
  }
  this.state = state;
}`;

const LIVE = `{{#if this.isLive}}
  {{! the app as a plain app: values spring to what state says }}
  <c.Spring @of={{pill}} @x={{this.pillX}} @spring={{PILL}} />
{{else}}
  {{! …the score… }}
{{/if}}`;

const PARK = `if (run.time >= run.duration - 0.02) {
  run.pause();                      // park at the end — a FINISHED run
  run.time = run.duration - 0.01;   // replays on any unrelated render,
  this.mode = 'scored';             // and a watched score must stand
}`;

/**
 * Deep dive for the Playhead demo.
 */
const PlayheadNotes: TOC<object> = <template>
  <section class='dive' aria-label='How it works'>
    <header class='dive-head'>
      <p class='dive-kicker'>How it works</p>
      <h2>One score, one clock</h2>
      <p class='dive-lede'>
        Pressing play and dragging the scrubber used to be two code paths this
        demo kept honest by hand — its own frame loop, its own spring sampler.
        Both are gone. The score is a
        <code>&lt;c.Sequence&gt;</code>
        in the template, the library plays it, and the scrubber sets
        <code>run.time</code>. The buttons, the springs and the elements are
        shared with the app itself.
      </p>
    </header>

    <section class='dd'>
      <p class='dd-fn'>&lt;c.Sequence&gt;<span>the score</span></p>
      <h3>The score is a list of actions, not a timeline</h3>
      <div class='dd-col'>
        <p>
          You do not write coordinates or timestamps. You write actions in
          order: wait, walk there, press it. Each press is a
          <em>named</em>
          dip of the hand, and everything that happens BECAUSE of the press —
          the ring's pop, the pill's spring — hangs off that name:
          <code>at 'press-express' 0.55</code>
          is the moment the finger lands. The absolute times fall out of the
          compiler.
        </p>
      </div>
      <CodeBox @label='playhead.gts' @source={{SCORE}} />
      <div class='dd-col'>
        <p>
          The click does not fire at the start of a press beat. It fires
          <strong>55% of the way in</strong>
          — a real hand presses down, the button fires, the hand comes back up.
          The value cues are anchored to the same moment, so the pill sets off
          exactly as the finger lands.
        </p>
      </div>

      <figure class='dd-fig'>
        <svg
          class='dg'
          viewBox='0 0 900 200'
          role='img'
          aria-label='Beats are compiled into a timeline. Each click fires 55
            percent of the way through its press beat.'
        >
          <text class='dg-eb' x='20' y='26'>WHAT YOU WRITE</text>

          <rect class='dg-box' x='20' y='40' width='128' height='38' rx='5' />
          <rect class='dg-box' x='148' y='40' width='234' height='38' rx='5' />
          <rect class='dg-hot' x='382' y='40' width='83' height='38' rx='5' />
          <rect class='dg-box' x='465' y='40' width='136' height='38' rx='5' />
          <rect class='dg-box' x='601' y='40' width='196' height='38' rx='5' />
          <rect class='dg-hot' x='797' y='40' width='83' height='38' rx='5' />

          <text
            class='dg-t is-dim'
            x='84'
            y='64'
            text-anchor='middle'
          >wait</text>
          <text class='dg-t' x='265' y='64' text-anchor='middle'>go to "express"</text>
          <text
            class='dg-t is-hot'
            x='423'
            y='64'
            text-anchor='middle'
          >click</text>
          <text
            class='dg-t is-dim'
            x='533'
            y='64'
            text-anchor='middle'
          >wait</text>
          <text class='dg-t' x='699' y='64' text-anchor='middle'>go to "gift
            wrap"</text>
          <text
            class='dg-t is-hot'
            x='838'
            y='64'
            text-anchor='middle'
          >click</text>

          <text class='dg-eb' x='20' y='112'>WHAT THE COMPILER RESOLVES</text>
          <line class='dg-rule' x1='20' y1='140' x2='880' y2='140' />
          <g class='dg-rule'>
            <line x1='20' y1='134' x2='20' y2='146' />
            <line x1='148' y1='134' x2='148' y2='146' />
            <line x1='382' y1='134' x2='382' y2='146' />
            <line x1='465' y1='134' x2='465' y2='146' />
            <line x1='601' y1='134' x2='601' y2='146' />
            <line x1='797' y1='134' x2='797' y2='146' />
            <line x1='880' y1='134' x2='880' y2='146' />
          </g>

          <g class='dg-emberline dg-dash'>
            <line x1='428' y1='78' x2='428' y2='136' />
            <line x1='843' y1='78' x2='843' y2='136' />
          </g>
          <circle class='dg-dot' cx='428' cy='140' r='4.5' />
          <circle class='dg-dot' cx='843' cy='140' r='4.5' />

          <text class='dg-t is-hot' x='428' y='166' text-anchor='middle'>click
            at 1081 ms</text>
          <text class='dg-t is-hot' x='880' y='166' text-anchor='end'>click at
            1961 ms</text>
          <text class='dg-t is-faint' x='20' y='190'>click time = the press's
            start + 55% of the press — read back from run.cues</text>
        </svg>
        <figcaption>
          You never write a time. The compiler resolves them, and the transport
          reads the presses' moments back from the compiled cues — the tick
          marks on the rail are the same numbers.
        </figcaption>
      </figure>
    </section>

    <section class='dd'>
      <p class='dd-fn'>walkX · walkY<span>the hand</span></p>
      <h3>The hand is cues; only its map is measured</h3>
      <div class='dd-col'>
        <p>
          A walk is a tween of the hand's
          <code>x</code>
          and
          <code>y</code>
          between two spots, eased in and out. The spots are still measured here
          — where a control LIVES is this stage's knowledge, read from layout
          offsets rather than
          <code>getBoundingClientRect</code>, because elements on this stage are
          mid-animation whenever you ask. Everything about
          <em>time</em>
          belongs to the compiled score.
        </p>
        <p>
          The press is a scale dip through the arrow's own hotspot, and the ring
          rides
          <em>inside</em>
          the hand — one transform source — so its pop happens wherever the hand
          is, with no second set of position cues.
        </p>
      </div>

      <figure class='dd-fig'>
        <svg
          class='dg'
          viewBox='0 0 900 250'
          role='img'
          aria-label='The pointer moves in a straight, eased line from its
            rest to a button, aimed at the layout position.'
        >
          <text class='dg-eb' x='20' y='22'>WHERE THE POINTER GOES</text>

          <rect
            class='dg-plate'
            x='40'
            y='36'
            width='430'
            height='196'
            rx='10'
          />
          <rect class='dg-box' x='118' y='54' width='272' height='160' rx='8' />
          <rect
            class='dg-plate'
            x='138'
            y='72'
            width='112'
            height='26'
            rx='5'
          />
          <rect class='dg-hot' x='258' y='72' width='112' height='26' rx='5' />
          <rect
            class='dg-plate'
            x='138'
            y='112'
            width='232'
            height='30'
            rx='5'
          />
          <rect
            class='dg-plate'
            x='138'
            y='156'
            width='232'
            height='30'
            rx='5'
          />
          <text
            class='dg-t is-faint'
            x='194'
            y='89'
            text-anchor='middle'
          >standard</text>
          <text
            class='dg-t is-hot'
            x='314'
            y='89'
            text-anchor='middle'
          >express</text>
          <text class='dg-t is-faint' x='254' y='131' text-anchor='middle'>gift
            wrap</text>
          <text class='dg-t is-faint' x='254' y='175' text-anchor='middle'>place
            order</text>

          <path class='dg-cop dg-dash' d='M68,206 L314,85' />
          <circle class='dg-faintdot' cx='68' cy='206' r='4' />
          <text
            class='dg-t is-faint'
            x='68'
            y='226'
            text-anchor='middle'
          >start</text>
          <path
            class='dg-hand'
            d='M314,85 l-1,15 l4.5,-4.5 l3.5,7 l3,-1.6 l-3.4,-6.8 l6.2,-0.6 z'
          />
          <circle class='dg-dot' cx='314' cy='85' r='2.5' />

          <path class='dg-inkline' d='M506,124 c7,0 7,-14 14,-14 s7,14 14,14' />
          <text class='dg-t is-dim' x='548' y='128'>eases in and out</text>
          <g class='dg-emberline'>
            <line x1='508' y1='166' x2='532' y2='166' />
            <line x1='520' y1='154' x2='520' y2='178' />
          </g>
          <text class='dg-t is-dim' x='548' y='170'>aimed at the layout
            position, not the rendered one</text>
        </svg>
        <figcaption>
          The walk is a cue like any other: play it, or stand it at any t — the
          library's still puts the hand exactly where the score says.
        </figcaption>
      </figure>

      <figure class='dd-fig'>
        <svg
          class='dg'
          viewBox='0 0 900 220'
          role='img'
          aria-label='During a click the pointer dips and springs back, while
            a ring spreads from the press and outlasts the beat.'
        >
          <text class='dg-eb' x='20' y='22'>WHAT A CLICK LOOKS LIKE</text>

          <rect class='dg-band' x='90' y='50' width='204' height='120' />
          <line class='dg-hair' x1='90' y1='50' x2='90' y2='170' />
          <line class='dg-rule' x1='90' y1='170' x2='830' y2='170' />

          <polyline class='dg-inkline' points='90,170 175,60 294,170 830,170' />
          <line class='dg-hotline' x1='175' y1='170' x2='694' y2='60' />
          <circle class='dg-dot' cx='694' cy='60' r='3.5' />

          <g class='dg-hair dg-dash'>
            <line x1='175' y1='50' x2='175' y2='170' />
            <line x1='294' y1='60' x2='294' y2='170' />
            <line x1='694' y1='60' x2='694' y2='170' />
          </g>

          <text class='dg-t' x='175' y='44' text-anchor='middle'>pointer dips</text>
          <text class='dg-t is-hot' x='694' y='44' text-anchor='middle'>ring
            fades out</text>

          <text
            class='dg-t is-faint'
            x='90'
            y='192'
            text-anchor='middle'
          >0</text>
          <text
            class='dg-t is-faint'
            x='175'
            y='192'
            text-anchor='middle'
          >click</text>
          <text class='dg-t is-faint' x='294' y='192' text-anchor='middle'>beat
            ends</text>
          <text class='dg-t is-faint' x='694' y='192' text-anchor='middle'>+420
            ms</text>
        </svg>
        <figcaption>
          The ring's pop is anchored to the press by name and lifted out of the
          sequence's flow — it outlasts the beat while the hand moves on, and
          its own end still counts toward the run's length.
        </figcaption>
      </figure>
    </section>

    <section class='dd'>
      <p class='dd-fn'>dispatch(t)<span>playhead.gts</span></p>
      <h3>The click is a real click</h3>
      <div class='dd-col'>
        <p>
          As each press's moment goes by, the transport finds the actual button
          element and calls
          <code>.click()</code>
          on it. The button's own event handler runs, just as if a user had
          clicked it.
        </p>
      </div>
      <CodeBox @label='playhead.gts' @source={{DISPATCH}} />
      <div class='dd-col'>
        <p>
          This matters because the scrubbed state is computed by folding the
          same handler code over the presses behind the playhead. There is only
          one description of what each button does, so a scrubbed state can
          never disagree with a clicked one.
        </p>
      </div>
    </section>

    <section class='dd'>
      <p class='dd-fn'>run.time = t<span>scrubbing</span></p>
      <h3>A scrubbed frame is the library's still</h3>
      <div class='dd-col'>
        <p>
          The demo used to re-run Motion's spring generator itself to answer
          "where is the pill at 1.25 seconds". Now the question goes to the run:
          <code>time</code>
          is settable in either direction, and a scrubbed frame is a computed
          still — the run retires its animations and stands every value exactly
          where the score says t looks like, spring curves included, with no
          memory of the frame before.
        </p>
      </div>
      <CodeBox @label='playhead.gts' @source={{STILL}} />
      <div class='dd-col'>
        <p>
          Every value cue states both ends of its journey —
          <code>@x=&lbrace;&lbrace;array 0 127&rbrace;&rbrace;</code>
          — so the run's first frame pins the whole scene to its opening state,
          and asking about an earlier time is not a different operation from
          asking about a later one.
        </p>
      </div>

      <figure class='dd-fig'>
        <svg
          class='dg'
          viewBox='0 0 900 320'
          role='img'
          aria-label="A chart of the pill's position over time: still at zero,
            springs right after the first click, then springs back after the
            last click. A scrub probe reads a mid-flight value."
        >
          <text class='dg-eb' x='20' y='24'>PILL POSITION OVER TIME</text>
          <line class='dg-hair dg-dash' x1='70' y1='80' x2='878' y2='80' />
          <line class='dg-hair dg-dash' x1='70' y1='240' x2='878' y2='240' />
          <line class='dg-rule' x1='70' y1='60' x2='70' y2='270' />
          <text
            class='dg-t is-faint'
            x='60'
            y='84'
            text-anchor='end'
          >right</text>
          <text
            class='dg-t is-faint'
            x='60'
            y='244'
            text-anchor='end'
          >left</text>

          <path
            class='dg-hotline'
            d='M70,240 L214,240 C232,240 244,104 264,74 C280,50 296,90 312,82
              C328,75 336,80 352,80 L768,80 C784,80 794,214 812,244
              C826,266 842,234 856,240 L878,240'
          />

          <g class='dg-rule'>
            <line x1='214' y1='60' x2='214' y2='270' />
            <line x1='768' y1='60' x2='768' y2='270' />
          </g>
          <text class='dg-t is-dim' x='220' y='72'>click — 1081 ms</text>
          <text class='dg-t is-dim' x='762' y='72' text-anchor='end'>click —
            5121 ms</text>
          <text class='dg-t is-faint' x='220' y='288'>heading right</text>
          <text class='dg-t is-faint' x='762' y='288' text-anchor='end'>heading
            back left</text>

          <line class='dg-cop dg-dash' x1='242' y1='60' x2='242' y2='270' />
          <circle class='dg-copdot' cx='242' cy='119' r='4.5' />
          <text class='dg-t is-cop' x='252' y='140'>scrub here → a mid-flight
            value, on the same curve</text>
          <text class='dg-t is-faint' x='878' y='306' text-anchor='end'>the
            overshoot is the same spring</text>
        </svg>
        <figcaption>
          Playing and scrubbing trace the same curve, because the same spring
          plays it and the same spring is sampled — the run's stills come from
          the engine's own generator, not a re-implementation of it.
        </figcaption>
      </figure>
    </section>

    <section class='dd'>
      <p class='dd-fn'>fold(t)<span>the state</span></p>
      <h3>Nothing needs to be disabled</h3>
      <div class='dd-modes'>
        <div class='dd-mode'>
          <span class='dd-tag'>playing</span>
          <b>The run drives</b>
          <p>run.play(). Real clicks, real springs. The playhead is a readout.</p>
        </div>
        <div class='dd-mode'>
          <span class='dd-tag'>scored</span>
          <b>The playhead drives</b>
          <p>run.pause() and run.time = t. Every value is a computed still.</p>
        </div>
        <div class='dd-mode'>
          <span class='dd-tag'>live</span>
          <b>You drive</b>
          <p>Touch a control and the template swaps the score for the app's own
            state springs.</p>
        </div>
      </div>
      <div class='dd-col'>
        <p>
          You might expect the transport to be greyed out when a real hand has
          the scene. It is not. Seeking never resumes from where things were
          left — the app's state at t is folded from the presses behind the
          playhead, from zero, every time.
        </p>
      </div>
      <CodeBox @label='playhead.gts' @source={{FOLD}} />
      <div class='dd-col'>
        <p>
          Whatever you clicked by hand is simply not in the folded answer. And
          the swap itself is one template branch — the mode picks which timeline
          the region compiles:
        </p>
      </div>
      <CodeBox @label='playhead.gts' @source={{LIVE}} />
    </section>

    <section class='dd'>
      <p class='dd-fn'>the reader<span>playhead.gts</span></p>
      <h3>A transport is a reader, not a clock</h3>
      <div class='dd-col'>
        <p>
          The old demo ran its own requestAnimationFrame loop with a clamped
          delta, and the comments explaining why ran longer than the loop. All
          deleted: the run owns the clock, and the transport only looks at it —
          the rail's fill, the clock text and the range are written imperatively
          each frame, because a region re-passes on every render and a tracked
          value written at 60fps would replay the pass at 60fps (the Build Order
          demo's lesson, learned the hard way).
        </p>
        <p>
          One deliberate move at the end of the score: the run is parked a hair
          before its own finish line.
        </p>
      </div>
      <CodeBox @label='playhead.gts' @source={{PARK}} />
      <div class='dd-col'>
        <p>
          A finished run replays on the next real pass — that is the rule that
          lets an event re-fire a Hold on a quiet region — but a score that has
          been watched to the end must simply stand until Play or a scrub says
          otherwise. Parked is not finished, so the region keeps the run, and
          the scene holds.
        </p>
      </div>
    </section>

    <section class='dd'>
      <p class='dd-fn'>the boundary<span>what cannot be scrubbed</span></p>
      <h3>Only numbers can be rewound</h3>
      <div class='dd-col'>
        <p>
          Everything on this stage moves by changing a number. That is
          deliberate. A spring is a mathematical function, so a still can be
          computed for any point in time. Other kinds of animation are not.
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
          being removed. The run's stills now cover values, flights and text
          deliveries; layout projection and exits remain on the far side of the
          line.
        </p>
      </div>
    </section>
  </section>
  <style scoped>
    .dd-modes {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 10px;
    }

    .dd-mode {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 13px 14px 15px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--bg-elev);
    }

    .dd-mode b {
      font-family: var(--font-display);
      font-size: 13px;
      font-weight: 700;
    }

    .dd-mode p {
      margin: 0;
      font-size: 13px;
      line-height: 1.55;
      color: var(--ink-dim);
    }

    .dd-tag {
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--ember);
    }
  </style>
</template>;

export default PlayheadNotes;
export { PlayheadNotes };
