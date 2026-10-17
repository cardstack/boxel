import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the viewer's system asks for reduced motion, kept current: the
 * setting can change while the gallery is open, and the stages follow it.
 */
class MotionPreference {
  @tracked reduce = false;

  constructor() {
    if (typeof matchMedia !== 'function') {
      return;
    }
    const query = matchMedia(QUERY);
    this.reduce = query.matches;
    query.addEventListener('change', (event) => {
      this.reduce = event.matches;
    });
  }
}

export const motionPreference = new MotionPreference();

/**
 * What a stage may do for a viewer who has asked for reduced motion.
 *
 * Every demo here is a piece of motion, so the gallery does not take the
 * motion away; it waits to be asked. A held stage counts as off, wherever it
 * is: its autoplay does not start and its endless effects stand still (see
 * `observeStage` and `restWhenOff`). Touching the stage, by pointer, key or click, is
 * asking: the stage wakes, and plays under the library's own reduced-motion
 * policy, in which positions land at once and fades still play. `full` asks
 * for the demo as it was designed: the stage's MotionConfig turns to
 * `'never'`, which every `{{motion}}` node and `<Choreo>` region inside it
 * follows. A stage that reads `prefers-reduced-motion` itself, in a media
 * query or through `matchMedia`, keeps its own reduced behaviour.
 *
 * The container a hold governs wears it as `data-motion-hold`.
 */
export class MotionHold {
  @tracked full = false;
  @tracked private touched = false;

  get held(): boolean {
    return motionPreference.reduce && !this.full && !this.touched;
  }

  /** `data-motion-hold`'s value */
  get state(): 'free' | 'held' {
    return this.held ? 'held' : 'free';
  }

  /** the policy for the stage's MotionConfig */
  get reducedMotion(): 'never' | 'user' {
    return this.full ? 'never' : 'user';
  }

  wake = () => {
    if (motionPreference.reduce && !this.touched) {
      this.touched = true;
    }
  };

  toggleFull = () => {
    this.full = !this.full;
  };
}

/**
 * Wake a hold when the viewer reaches into the stage: a press, a key, or a
 * bare click, which is all a screen reader's browse mode or voice control
 * sends. Listened for in the capture phase, so a control that stops its
 * event's propagation still wakes the stage. The stage hears that it is on
 * once the hold's change renders, after the press's own handlers have run.
 */
const WAKERS = ['pointerdown', 'keydown', 'click'] as const;

export const wakeOnTouch = modifier((el: HTMLElement, [hold]: [MotionHold]) => {
  for (const type of WAKERS) {
    el.addEventListener(type, hold.wake, { capture: true });
  }
  return () => {
    for (const type of WAKERS) {
      el.removeEventListener(type, hold.wake, { capture: true });
    }
  };
});
