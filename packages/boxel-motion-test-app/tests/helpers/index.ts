export const frameDuration = 1000 /*ms*/ / 60; /*frames*/

export class TestClock {
  #clockStartTime: number;
  #startTimes = new WeakMap<Animation, number | null>();
  #now = 0;

  constructor() {
    let clockStartTime = document.timeline.currentTime;
    if (clockStartTime == null) {
      throw new Error(`document timeline doesn't have a currentTime`);
    }
    this.#clockStartTime = clockStartTime;
    for (let animation of document.getAnimations()) {
      // we use the clock start time for animations already running when the
      // clock starts, otherwise there are sub ms time delays between animation
      // starts and this clock's start time which can result in not being able
      // to advance the animation to the last frame unless you take into account
      // this minor delta of time.
      this.#startTimes.set(animation, clockStartTime);
      animation.pause();
      animation.currentTime = 0;
    }
  }

  get now() {
    return this.#now;
  }

  set now(now: number) {
    this.#now = now;
    for (let animation of document.getAnimations()) {
      let startTime = this.#startTimes.get(animation);
      if (startTime === null) {
        // skip animations that are not playing, presumably this should be impossible
        continue;
      }
      if (startTime === undefined) {
        // handle animation interruptions--animations that were not running when
        // the clock started
        startTime = animation.startTime;
        if (startTime === null) {
          // skip animations that are not playing, presumably this should be impossible
          continue;
        }
        this.#startTimes.set(animation, startTime);
        animation.pause();
      }

      // when the animation is paused its start time is set to null (since the
      // start time only pertains the the currently "playing" animation), so we
      // need to leverage the document timeline as the means to compare
      // animations that have started after the clock has started (i.e.
      // interruptions).
      animation.currentTime = Math.max(
        now - (this.#clockStartTime - startTime),
        0
      );
    }
  }

  setToFrameBefore(time: number): number {
    this.now = time - frameDuration;
    return this.now;
  }

  setToFrameAfter(time: number): number {
    this.now = time + frameDuration;
    return this.now;
  }
}
