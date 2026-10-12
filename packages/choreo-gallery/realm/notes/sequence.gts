import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Sequence demo.
 */
const SequenceNotes: TOC<object> = <template>
  <section class='dive' aria-label='How it works'>
    <header class='dive-head'>
      <p class='dive-kicker'>How it works</p>
      <h2>Steps that wait for each other</h2>
      <p class='dive-lede'>
        A
        <code>&lt;c.Sequence&gt;</code>
        runs its children one after another. Each step waits for the previous
        one to finish before it starts. This is how you build "fade out, then
        move, then fade in" as a single coordinated animation.
      </p>
    </header>

    <section class='dd'>
      <h3>Hold borrows a value for a window of time</h3>
      <div class='dd-col'>
        <p>
          <code>&lt;c.Hold&gt;</code>
          sets a property on a sprite for the duration of the sequence step it
          appears in. When that step ends, the property reverts.
        </p>
        <p>
          In this demo, Hold is used for z-index. The card being opened is held
          at z-index 2 so it sits above its neighbours while it grows. The card
          being closed is held at z-index 1 so it sits below the hero while its
          content fades. When the sequence finishes, both revert to the default
          layer.
        </p>
        <p>
          Without Hold, you would need to set a z-index flag, start a timer,
          then clear the flag when the animation finishes. Hold ties the
          lifetime of the property to the lifetime of the sequence step. If you
          click again before the animation finishes, the old sequence is
          interrupted and the holds are released — no stale flags, no timers to
          clear.
        </p>
      </div>

      <figure class='dd-fig'>
        <svg
          class='dg'
          viewBox='0 0 900 260'
          role='img'
          aria-label='A sequence with three steps: fade out the old content,
            move the card, and fade in the new content. Hold keeps z-index
            set for the duration.'
        >
          <text class='dg-eb' x='20' y='22'>SEQUENCE TIMELINE</text>

          <line class='dg-rule' x1='80' y1='220' x2='860' y2='220' />
          <text class='dg-t is-faint' x='70' y='224' text-anchor='end'>time →</text>

          <rect class='dg-box' x='80' y='50' width='200' height='34' rx='6' />
          <text class='dg-t' x='180' y='72' text-anchor='middle'>fade out old
            content</text>

          <rect class='dg-hot' x='280' y='50' width='340' height='34' rx='6' />
          <text class='dg-t is-hot' x='450' y='72' text-anchor='middle'>move the
            card (projection)</text>

          <rect class='dg-box' x='620' y='50' width='220' height='34' rx='6' />
          <text class='dg-t' x='730' y='72' text-anchor='middle'>fade in new
            content</text>

          <rect
            class='dg-boxcop'
            x='80'
            y='110'
            width='760'
            height='30'
            rx='5'
          />
          <text class='dg-t is-cop' x='460' y='130' text-anchor='middle'>Hold:
            z-index = 2 (for the full sequence)</text>

          <line class='dg-hair dg-dash' x1='280' y1='44' x2='280' y2='220' />
          <line class='dg-hair dg-dash' x1='620' y1='44' x2='620' y2='220' />

          <text class='dg-t is-faint' x='180' y='180' text-anchor='middle'>step
            1</text>
          <text class='dg-t is-faint' x='450' y='180' text-anchor='middle'>step
            2</text>
          <text class='dg-t is-faint' x='730' y='180' text-anchor='middle'>step
            3</text>

          <text
            class='dg-t is-faint'
            x='860'
            y='130'
            text-anchor='end'
          >released</text>
        </svg>
        <figcaption>
          Each step waits for the previous one. The Hold spans all three and
          releases when the sequence ends.
        </figcaption>
      </figure>
    </section>

    <section class='dd'>
      <h3>Projection does the geometry</h3>
      <div class='dd-col'>
        <p>
          The card grows from a square tile to a wide hero. That shape change is
          handled by
          <code>layout=true</code>
          — the projection tree measures the card before and after the state
          change and animates the difference. The Sequence does not move the
          card itself; it controls the
          <em>ordering</em>
          of the steps around it.
        </p>
        <p>
          Scale correction applies here too. The card's children — the title and
          the content — use
          <code>layout=true</code>
          on their own, so they are counter-scaled against the parent and stay
          sharp while it stretches.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>Parallel inside Sequence</h3>
      <div class='dd-col'>
        <p>
          A
          <code>&lt;c.Parallel&gt;</code>
          inside a sequence step runs its children simultaneously. The step
          finishes when the longest child finishes.
        </p>
        <p>
          This demo uses it in two places: the old content fades out while its
          Hold and Tween run together, and the new content fades in partway
          through the card's move by using a delay inside a Parallel. The delay
          means the content starts appearing before the card has finished moving
          — so the card arrives already carrying its content instead of showing
          a blank surface that fills in after.
        </p>
      </div>
    </section>
  </section>
</template>;

export default SequenceNotes;
export { SequenceNotes };
