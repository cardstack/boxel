/**
 * The mark: one thing, at three moments, on the path between them.
 *
 * A choreography is not a picture of movement — it is the same element,
 * measured before and after, and the line the engine draws between those
 * measurements. So the mark is three beads on one arc, growing toward the
 * present: the trail is where it has been, the filled bead is where it is.
 */
export const ChoreoMark = <template>
  <svg class="choreo-mark" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M3 18.4C6.2 11.6 11.6 7 19.4 5.4"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      opacity="0.45"
    />
    <circle
      cx="3.9"
      cy="17.6"
      r="1.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
      opacity="0.55"
    />
    <circle
      cx="10.6"
      cy="11.4"
      r="2.2"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
      opacity="0.8"
    />
    <circle cx="18.4" cy="6.4" r="3.1" fill="currentColor" />
  </svg>
</template>;
