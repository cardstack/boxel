import { motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
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

export const Keyframes = <template>
  <div class='ex'>
    <div class='morph-stage'>
      <div
        class='morph-glow'
        {{motion
          animate=glow
          transition=(tuneMotion 'keyframes' transition 'transition')
        }}
      ></div>
      <div
        class='morph'
        {{motion
          animate=(morph)
          transition=(tuneMotion 'keyframes' transition 'transition')
        }}
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
        rgba(255, 59, 31, 0.45),
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
</template>;

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('keyframes', transition, 'transition');

export class KeyframesDemo extends GalleryDemo {
  static stage = Keyframes;
}
