import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Interruption demo.
 */
const InterruptNotes: TOC<object> = <template>
  <section class='dive' aria-label='How it works'>
    <header class='dive-head'>
      <p class='dive-kicker'>How it works</p>
      <h2>Velocity is the difference</h2>
      <p class='dive-lede'>
        Both pucks are told to go somewhere new. What they carry from the old
        trip is where they part ways.
      </p>
    </header>

    <section class='dd'>
      <h3>A spring remembers how fast it was going</h3>
      <div class='dd-col'>
        <p>
          When you click a station while the puck is still mid-flight, the
          engine looks at two things: the puck's current position and its
          current velocity. The new spring starts from that position, already at
          that speed.
        </p>
        <p>
          This is why the spring puck bends. If you send it back the way it
          came, it overshoots — it was still travelling in the opposite
          direction when the new target arrived, so it has to decelerate,
          reverse, and then accelerate toward the new station. That curve is not
          scripted anywhere. It falls out of the physics.
        </p>
      </div>

      <figure class='dd-fig'>
        <svg
          class='dg'
          viewBox='0 0 900 280'
          role='img'
          aria-label='Two position-over-time curves: the spring bends smoothly
            on retarget, the tween restarts from zero velocity.'
        >
          <text class='dg-eb' x='20' y='22'>POSITION OVER TIME</text>

          <line class='dg-rule' x1='60' y1='250' x2='860' y2='250' />
          <line class='dg-rule' x1='60' y1='40' x2='60' y2='260' />
          <text class='dg-t is-faint' x='50' y='256' text-anchor='end'>A</text>
          <text class='dg-t is-faint' x='50' y='146' text-anchor='end'>B</text>
          <text class='dg-t is-faint' x='50' y='56' text-anchor='end'>C</text>
          <line class='dg-hair dg-dash' x1='60' y1='140' x2='860' y2='140' />
          <line class='dg-hair dg-dash' x1='60' y1='50' x2='860' y2='50' />

          <line class='dg-cop dg-dash' x1='360' y1='40' x2='360' y2='260' />
          <text class='dg-t is-cop' x='366' y='268'>click: A → C</text>

          <path
            class='dg-hotline'
            d='M60,250 C140,250 180,148 220,142
               C260,136 300,140 360,140
               L360,140
               C400,140 420,62 460,48
               C500,34 530,56 560,50
               C590,44 610,50 640,50
               C740,50 860,50 860,50'
          />
          <text class='dg-t is-hot' x='750' y='42'>spring</text>

          <path
            class='dg-inkline'
            d='M60,250 C140,250 180,148 220,142
               C260,136 300,140 360,140
               L360,250
               C420,250 460,80 500,56
               C540,32 570,56 600,50
               C660,50 860,50 860,50'
          />
          <text class='dg-t is-dim' x='750' y='62'>tween</text>

          <circle class='dg-dot' cx='360' cy='140' r='4' />
          <circle class='dg-faintdot' cx='360' cy='250' r='4' />
        </svg>
        <figcaption>
          Both reach B at the same time. Click C while they are there: the
          spring bends towards C without stopping; the tween drops to zero speed
          and eases up again.
        </figcaption>
      </figure>
    </section>

    <section class='dd'>
      <h3>A tween forgets everything</h3>
      <div class='dd-col'>
        <p>
          A tween is a curve drawn from a start value to an end value over a
          fixed duration. Interrupting it means starting a new curve from
          wherever the value happens to be at that moment. The velocity at the
          point of interruption is discarded — the new curve always begins from
          zero speed.
        </p>
        <p>
          This is not a bug. It is what a fixed duration means: the curve has a
          defined shape, and that shape starts at zero velocity by definition.
        </p>
      </div>

      <figure class='dd-fig'>
        <svg
          class='dg'
          viewBox='0 0 900 200'
          role='img'
          aria-label='Speed at the moment of retarget: the spring carries its
            speed, the tween resets to zero.'
        >
          <text class='dg-eb' x='20' y='22'>SPEED AT THE RETARGET</text>

          <rect class='dg-box' x='60' y='44' width='360' height='56' rx='8' />
          <text class='dg-t is-hot' x='240' y='76' text-anchor='middle'>spring:
            still moving at 480 px/s</text>

          <rect class='dg-box' x='60' y='118' width='360' height='56' rx='8' />
          <text class='dg-t is-dim' x='240' y='150' text-anchor='middle'>tween:
            speed = 0</text>

          <rect
            class='dg-plate'
            x='490'
            y='44'
            width='360'
            height='130'
            rx='8'
          />
          <text class='dg-t' x='670' y='78' text-anchor='middle'>The spring's
            new animation</text>
          <text class='dg-t' x='670' y='100' text-anchor='middle'>starts with
            that speed baked in.</text>
          <text class='dg-t' x='670' y='130' text-anchor='middle'>The tween's
            new animation</text>
          <text class='dg-t' x='670' y='152' text-anchor='middle'>always starts
            from standstill.</text>
        </svg>
        <figcaption>
          That speed is velocity transfer — the property that makes a spring
          feel physical.
        </figcaption>
      </figure>
    </section>

    <section class='dd'>
      <h3>Two rails, same clicks</h3>
      <div class='dd-col'>
        <p>
          The demo shows two copies of the same layout, driven by the same
          clicks. The top rail uses a spring; the bottom rail uses a tween. If
          you let the puck arrive and then click, both look identical. The
          difference only shows when you click while the puck is still moving.
        </p>
        <p>
          Try clicking two stations in quick succession, or clicking back the
          way the puck came. Use the speed control to slow the page down and the
          difference becomes obvious.
        </p>
      </div>
    </section>
  </section>
</template>;

export default InterruptNotes;
export { InterruptNotes };
