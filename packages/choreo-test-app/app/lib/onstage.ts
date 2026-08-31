import { modifier } from 'ember-modifier';

/**
 * Tell a demo whether anyone can see it.
 *
 * The gallery renders forty-two live demos at once. Most of them are cheap —
 * they are a handful of elements that move when you press something and sit
 * still otherwise. A few are not: Long Take and the mockup each own a WebGL
 * context and a render loop, and Drift runs a fixed-step integrator at 120Hz
 * with a canvas under it. Three of those scrolled off the top of the page are
 * three render loops burning frames for nobody.
 *
 * The cheapest fix would be to unmount them, and it is the wrong one: a stage
 * that unmounts loses the tune you gave it, the marks you laid and the laps you
 * set, and scrolling past your own work should not delete it. So the stage
 * stays mounted and stops WORKING — which is also what makes this safe to reach
 * for. Nothing here changes what a demo is, only whether it is running.
 *
 * `rootMargin` is generous on purpose. A demo that starts the instant its top
 * edge crosses the fold arrives already moving; one that waits for the exact
 * boundary arrives frozen and then jerks into life a frame later, which reads
 * as a bug rather than as an optimisation.
 */
export const onStage = modifier(
  (el: HTMLElement, [tell]: [(visible: boolean) => void]) => {
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) {
          tell(last.isIntersecting);
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      // torn down means gone, which for every caller is the same as offscreen —
      // and saying so here means no caller needs its own destructor for it
      tell(false);
    };
  }
);

export default onStage;
