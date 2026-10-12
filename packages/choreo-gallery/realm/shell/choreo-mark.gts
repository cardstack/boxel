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
 * The geometry is exported because the mark exists twice: static in the
 * top bar, and taken apart in the Build Order demo, where its own assembly
 * is the demonstration. One set of numbers, so the logo being animated is
 * provably the logo being worn.
 */

/** the fading half of the outer sweep: bottom tip round the left, into the past */
export const TAIL = 'M18.3 16.9A8 8 0 0 1 4 12';

/** the arriving half: over the top, ending where the bead sits */
export const HEAD = 'M4 12A8 8 0 0 1 18.3 7.1';

/** the outer element now — the arc terminates inside it */
export const BEAD = { cx: 18.3, cy: 7.1, r: 2.8 } as const;

/**
 * The second timeline: 210° from the lower left over the top, arriving at
 * its own dot. It starts 5° further round than the geometry alone wants, so
 * its lighter stroke reads as ending level with the heavier outer sweep.
 */
export const ORBIT = 'M13.66 16.07A4.4 4.4 0 0 1 8.4 9.5';

/**
 * The inner element now — the last 85° of the sweep in the hot color. It
 * trails the outer bead by 22°, which keeps the two clear of each other and
 * makes the mark read as a chase rather than a diagram.
 */
export const TIP = 'M8.4 9.5A4.4 4.4 0 0 1 14.2 8.2';

export const ChoreoMark = <template>
  {{! Static on purpose — the mark performs in the Build Order demo; up here
    it has already arrived. }}
  <svg class='choreo-mark' viewBox='0 0 24 24' aria-hidden='true'>
    <path
      d={{TAIL}}
      fill='none'
      stroke='var(--mark-tail)'
      stroke-width='2.2'
      stroke-linecap='round'
    />
    <path
      d={{HEAD}}
      fill='none'
      stroke='var(--ember-hot)'
      stroke-width='2.2'
      stroke-linecap='round'
    />
    <circle cx={{BEAD.cx}} cy={{BEAD.cy}} r={{BEAD.r}} fill='var(--ember)' />
    <path
      d={{ORBIT}}
      fill='none'
      stroke='var(--mark-orbit)'
      stroke-width='1.6'
      stroke-linecap='round'
    />
    <path
      d={{TIP}}
      fill='none'
      stroke='var(--ember-hot)'
      stroke-width='1.6'
      stroke-linecap='round'
    />
  </svg>
  <style scoped>
    .choreo-mark {
      --mark-tail: rgba(255, 59, 31, 0.35);
      --mark-orbit: rgba(139, 150, 156, 0.75);
      width: 34px;
      height: 34px;
      display: block;
    }
  </style>
</template>;

export default ChoreoMark;
