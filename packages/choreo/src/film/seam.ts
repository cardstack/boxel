/**
 * THE SEAM'S GATE: hold the cut until its still can be PAINTED.
 *
 * Every join that carries the outgoing frame carries it as a JPEG data
 * URL in the DOM, and a full-resolution JPEG handed to the DOM is not
 * paintable on the frame it is handed over — the browser decodes it off
 * the main thread. The lens, meanwhile, moves on that frame. So the seam
 * used to play backwards: three frames of the incoming shot at 60 Hz,
 * then the still of the outgoing one, then the transition over it.
 *
 * The gate decodes the frame into the memory cache first and holds the
 * whole cut — the lens snap, the overlay, an iris's projection — until
 * it is ready; the DOM image then paints from that decode on the frame
 * it is inserted. The outgoing shot stays live and moving for those few
 * milliseconds, which nobody can see: a cut two frames late reads as a
 * cut, a cut that shows the wrong picture does not.
 *
 * Three rules the film depends on:
 *
 * - **Nothing to decode, nothing to wait for.** A seam with no still (a
 *   cut, a flash, a dissolve the page held in its own glass) runs
 *   SYNCHRONOUSLY, on the caller's stack, exactly as it always did.
 * - **One seam at a time.** A cut that arrives while an earlier one is
 *   still waiting retires it; the earlier one never runs.
 * - **No seam waits for ever.** A decode that never comes back (a
 *   truncated capture, a browser without `HTMLImageElement.decode`) is
 *   given `cap` milliseconds and then the cut goes anyway.
 */
export class Seam {
  /** which cut is in hand; a later one retires an earlier one */
  private turn = 0;

  /**
   * Hold `cut` until `still` can be painted, or run it now if there is
   * no still. `cap` is the longest the film will wait on a decode.
   */
  hold(still: string, cut: () => void, cap = 120): void {
    if (!still) {
      cut();
      return;
    }
    const mine = (this.turn += 1);
    let ran = false;
    const go = () => {
      if (ran || mine !== this.turn) {
        return;
      }
      ran = true;
      cut();
    };
    const pre = new Image();
    pre.src = still;
    setTimeout(go, cap);
    const decoding = pre.decode?.();
    if (decoding) {
      void decoding.then(go, go);
    } else {
      go();
    }
  }
}
