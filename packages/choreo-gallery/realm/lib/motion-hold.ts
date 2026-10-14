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
 * `observeStage` and `restWhenOff`). Touching the stage, by pointer or key, is
 * asking: the stage wakes, and plays under the library's own reduced-motion
 * policy, in which positions land at once and fades still play. `full` asks
 * for the demo as it was designed, reduced motion and all set aside.
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
 * Wake a hold when the viewer reaches into the stage. Taken in the capture
 * phase, so the stage hears it is on before its own controls hear the press.
 */
export const wakeOnTouch = modifier((el: HTMLElement, [hold]: [MotionHold]) => {
  el.addEventListener('pointerdown', hold.wake, { capture: true });
  el.addEventListener('keydown', hold.wake, { capture: true });
  return () => {
    el.removeEventListener('pointerdown', hold.wake, { capture: true });
    el.removeEventListener('keydown', hold.wake, { capture: true });
  };
});
