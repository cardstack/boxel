import { motion } from 'glimmer-motion';

const morph = {
  backgroundColor: ['#ff6a3a', '#e4a35a', '#ff3b1f', '#ff8a4a'],
  borderRadius: ['28%', '50%', '22% 40%', '32%'],
  rotate: [0, 90, 210, 360],
  scale: [1, 0.82, 1.14, 1],
  x: [0, 18, -14, 0],
  y: [0, -28, 10, 0],
};
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
        {{motion animate=glow transition=transition}}
      ></div>
      <div class="morph" {{motion animate=morph transition=transition}}></div>
    </div>
  </div>
</template>;
