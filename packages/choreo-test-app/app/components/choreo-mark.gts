/**
 * The mark: a comet lettering a C.
 *
 * A choreography is not a picture of movement — it is the same element,
 * measured before and after, and the line the engine draws between those
 * measurements. So the mark is that line, arriving: an arc that fades in
 * from the past, sweeps 284°, and terminates inside the filled bead that is
 * the element NOW. The gap it leaves open letters Choreo's C.
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

/** the fading half of the sweep: bottom tip round the left, into the past */
export const TAIL = 'M18.3 16.9A8 8 0 0 1 4 12';

/** the arriving half: over the top, ending where the bead sits */
export const HEAD = 'M4 12A8 8 0 0 1 18.3 7.1';

/** the element now — the arc terminates inside it */
export const BEAD = { cx: 18.3, cy: 7.1, r: 2.8 } as const;

export const ChoreoMark = <template>
  <svg class="choreo-mark" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d={{TAIL}}
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      opacity="0.4"
    />
    <path
      d={{HEAD}}
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      opacity="0.8"
    />
    <circle cx={{BEAD.cx}} cy={{BEAD.cy}} r={{BEAD.r}} fill="currentColor" />
  </svg>
</template>;
