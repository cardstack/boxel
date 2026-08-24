/**
 * The mark: a comet lettering a C.
 *
 * A choreography is not a picture of movement — it is the same element,
 * measured before and after, and the line the engine draws between those
 * measurements. So the mark is that line, arriving, twice over: an outer
 * arc that fades in from the past, sweeps 284°, and terminates inside the
 * filled bead that is the element NOW — and a second, inner orbit on its
 * own timeline, arriving at its own dot. One arc is motion; two in phase
 * are a choreography. The gap they leave open letters Choreo's C.
 *
 * Nothing crosses anything: the trail ENDS at the present, which is the
 * whole grammar of the mark — arrival, not intersection.
 *
 * The geometry is exported because the mark exists twice: static up in the
 * top bar, and taken apart in the Build Order demo, where its own assembly
 * is the demonstration — the tail draws, the head draws after it, the bead
 * lands. One set of numbers, so the logo being animated is provably the
 * logo being worn.
 */

/** the fading half of the outer sweep: bottom tip round the left, into the past */
export const TAIL = 'M18.3 16.9A8 8 0 0 1 4 12';

/** the arriving half: over the top, ending where the bead sits */
export const HEAD = 'M4 12A8 8 0 0 1 18.3 7.1';

/** the outer element now — the arc terminates inside it */
export const BEAD = { cx: 18.3, cy: 7.1, r: 2.8 } as const;

/**
 * The second timeline. One arc is motion; two arcs in phase are a
 * choreography, and concentric is what keeps the promise that nothing on
 * this mark ever crosses anything — orbits at different radii cannot meet.
 * 210° from the lower left over the top, arriving at its own dot.
 */
export const ORBIT = 'M13.3 16.2A4.4 4.4 0 0 1 8.4 9.5';

/**
 * The inner element now — not a bead but a burning stretch of the line
 * itself: the last 85° of the sweep in the hot color, rounded caps. It ends
 * at one o'clock, reaching for the outer bead at half past, both plainly
 * mid-flight; the 22° it still trails is what keeps the two clear of each other,
 * and what makes the mark read as a chase rather than a diagram — the inner
 * timeline has started, and has not caught up yet.
 */
export const TIP = 'M8.4 9.5A4.4 4.4 0 0 1 14.2 8.2';

export const ChoreoMark = <template>
  {{! full color, same grade the demo wears: faint copper past, copper
      present-tense line, ember bead, steel second timeline, hot tip.
      Static on purpose — the mark performs in the Build Order demo; up
      here it has already arrived. }}
  <svg class="choreo-mark" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d={{TAIL}}
      fill="none"
      stroke="rgba(228, 163, 90, 0.4)"
      stroke-width="2.2"
      stroke-linecap="round"
    />
    <path
      d={{HEAD}}
      fill="none"
      stroke="var(--copper)"
      stroke-width="2.2"
      stroke-linecap="round"
    />
    <circle cx={{BEAD.cx}} cy={{BEAD.cy}} r={{BEAD.r}} fill="var(--ember)" />
    <path
      d={{ORBIT}}
      fill="none"
      stroke="rgba(139, 150, 156, 0.75)"
      stroke-width="1.6"
      stroke-linecap="round"
    />
    <path
      d={{TIP}}
      fill="none"
      stroke="var(--ember-hot)"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  </svg>
</template>;
