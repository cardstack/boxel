import { motion } from 'glimmer-motion';
import { tuneMotion, tuneNumber } from 'test-app/lib/demo-tuning';

function morph() {
  const rotation = tuneNumber('keyframes', 360, 'rotation (deg)', 0, 720, 1);
  const peakScale = tuneNumber(
    'keyframes',
    1.14,
    'peakScale (×)',
    0.5,
    2,
    0.01
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
  <div class="ex">
    <div class="morph-stage">
      <div
        class="morph-glow"
        {{motion
          animate=glow
          transition=(tuneMotion "keyframes" transition "transition")
        }}
      ></div>
      <div
        class="morph"
        {{motion
          animate=(morph)
          transition=(tuneMotion "keyframes" transition "transition")
        }}
      ></div>
    </div>
  </div>
</template>;

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('keyframes', transition, 'transition');
