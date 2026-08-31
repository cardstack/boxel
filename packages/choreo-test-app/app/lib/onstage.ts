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

/**
 * Stop a card's CSS animations while nobody can see it.
 *
 * `onStage` above is for demos that own a loop and can be told to stop. This is
 * for the other twenty-odd, which own no loop at all and animate purely in CSS
 * — and between them, on an idle gallery, they were running twenty-five
 * animations at once with fourteen of those coming from one stage. Nothing was
 * broken; it is simply that a page of forty-two live demos is a page of
 * forty-two things that never rest, and the crossing has to share a thread with
 * all of them.
 *
 * It toggles a class rather than touching the animations, because
 * `animation-play-state` is inherited-by-selector and pauses a whole subtree in
 * one declaration — including animations that were declared by a stage this
 * file has never heard of. Pausing is also the right verb: a paused animation
 * keeps its position, so a card scrolled away and back does not restart its
 * decoration from frame zero, which would be a worse artefact than the cost it
 * saves.
 *
 * Web Animations — Motion's own — need the second half, because
 * `animation-play-state` cannot reach them: they are script-driven and have no
 * CSS animation to pause. Only the ENDLESS ones are touched. A finite animation
 * left alone finishes when it was always going to finish, which is the whole
 * reason not to pause everything: a Choreo run stopped behind the fold is a run
 * that lands at the wrong time, and a card scrolled past mid-transition should
 * come back settled rather than half way through a move it started a minute
 * ago.
 *
 * `iterations` reads as `Infinity` or, for some engines, `null` — both mean the
 * same thing here and both are checked.
 */
const endless = (a: Animation) => {
  const n = a.effect?.getTiming?.().iterations;
  return n === Infinity || n === null;
};

export const restWhenOff = modifier((el: HTMLElement) => {
  const settle = (visible: boolean) => {
    el.classList.toggle('is-resting', !visible);
    for (const a of el.getAnimations({ subtree: true })) {
      if (!endless(a)) {
        continue;
      }
      if (visible) {
        if (a.playState === 'paused') {
          a.play();
        }
      } else if (a.playState === 'running') {
        a.pause();
      }
    }
  };
  const io = new IntersectionObserver(
    (entries) => {
      const last = entries[entries.length - 1];
      if (last) {
        settle(last.isIntersecting);
      }
    },
    { rootMargin: '200px' }
  );
  io.observe(el);
  return () => {
    io.disconnect();
    settle(true);
  };
});

export default onStage;
