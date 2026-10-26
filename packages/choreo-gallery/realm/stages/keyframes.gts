import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { observeStage } from '../lib/onstage';
import { tuneMotion, tuneNumber } from '../lib/tuning';

function morph() {
  const rotation = tuneNumber('keyframes', 360, 'rotation (deg)', 0, 720, 1);
  const peakScale = tuneNumber(
    'keyframes',
    1.14,
    'peakScale (×)',
    0.5,
    2,
    0.01,
  );
  const lift = tuneNumber('keyframes', 28, 'lift (px)', 0, 80, 1);
  return {
    backgroundColor: ['#ff6a3a', '#e4a35a', '#ff3b1f', '#ff8a4a'],
    borderRadius: ['28%', '50%', '22% 40%', '32%'],
    rotate: [0, rotation / 4, (rotation * 7) / 12, rotation],
    scale: [1, 0.82, peakScale, 1],
    x: [0, 18, -14, 0],
    y: [0, -lift, 10, 0],
  };
}
const glow = {
  opacity: [0.35, 0.7, 0.25, 0.45],
  scale: [0.9, 1.25, 0.8, 1],
};
const transition = {
  duration: 1.35,
  ease: [0.22, 1, 0.36, 1],
  repeat: Infinity,
} as const;

/** each value at its first keyframe */
function firstOf<T extends object>(frames: T) {
  return Object.fromEntries(
    Object.entries(frames).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  ) as { [K in keyof T]: T[K] extends readonly (infer V)[] ? V : T[K] };
}
const STILL = { duration: 0 } as const;

/**
 * The loop repeats forever and Motion runs it by script, frame by frame, so
 * nothing the stage's resting reaches can pause it. Off stage (scrolled away,
 * or under a demo page) it settles on its first keyframe, where every pass of
 * the loop begins, and the loop stops; it starts again from there when the
 * stage comes back. It mounts playing, as any `{{motion}}` loop does, and a
 * stage that turns out to be off stage settles as soon as that is known.
 *
 * Off is believed only once it has held for two frames. The stage's first
 * report comes before anything has been measured, and says off; the measured
 * answer follows a frame later. Settling on that first word would stop the
 * loop and start it again from its first frame on every mount.
 */
export class Keyframes extends Component {
  @tracked private onStage = true;

  watch = modifier((el: HTMLElement) => {
    let pending = 0;
    const stage = observeStage(el, (visible) => {
      cancelAnimationFrame(pending);
      pending = 0;
      if (visible) {
        this.onStage = true;
        return;
      }
      pending = requestAnimationFrame(() => {
        pending = requestAnimationFrame(() => {
          pending = 0;
          this.onStage = false;
        });
      });
    });
    return () => {
      cancelAnimationFrame(pending);
      stage.disconnect();
    };
  });

  get morph() {
    return this.onStage ? morph() : firstOf(morph());
  }

  get glow() {
    return this.onStage ? glow : firstOf(glow);
  }

  get transition() {
    return this.onStage
      ? tuneMotion('keyframes', transition, 'transition')
      : STILL;
  }

  <template>
    <div class='ex'>
      <div class='morph-stage' {{this.watch}}>
        <div
          class='morph-glow'
          {{motion animate=this.glow transition=this.transition}}
        ></div>
        <div
          class='morph'
          {{motion animate=this.morph transition=this.transition}}
        ></div>
      </div>
    </div>
    <style scoped>
      .ex {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 100%;
        /* every stage keeps air on all four sides. A demo that runs edge to edge
           reads as a layout bug rather than as a stage, and the ones sized
           `min(Npx, 100%)` hit the frame exactly when the card is narrow.
           The block padding matters as much as the inline: on a stage tall
           enough to fill the platter, content flush against the top and bottom
           of the recess reads as overflowed rather than placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      .morph-stage {
        position: relative;
        width: 160px;
        height: 160px;
        display: grid;
        place-items: center;
      }

      .morph-glow {
        position: absolute;
        width: 140px;
        height: 140px;
        border-radius: 50%;
        background: radial-gradient(
          circle,
          color-mix(in srgb, var(--primary) 45%, transparent),
          transparent 68%
        );
        filter: blur(8px);
      }

      .morph {
        position: relative;
        width: 92px;
        height: 92px;
        background: var(--ember-hot);
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.12) inset,
          0 22px 50px var(--glow);
      }
    </style>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('keyframes', transition, 'transition');

export class KeyframesDemo extends GalleryDemo {
  static stage = Keyframes;
}
