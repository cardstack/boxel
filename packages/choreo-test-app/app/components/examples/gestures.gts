import { motion } from 'glimmer-motion';
import { tuneMotion, tuneNumber } from 'test-app/lib/demo-tuning';

/**
 * A globe. Hover and it swells and warms; press and it collapses — and
 * collapsing makes it hotter, ember through gold to blue-white, the way
 * compression does.
 *
 * The core and the two glow layers inherit the state from the body they sit
 * in: variants propagate down the motion tree, so one gesture drives all of
 * them. Nothing animates `box-shadow` — interpolating a shadow string means
 * parsing and rebuilding it every frame, and it shows. The glow is real
 * elements moving on opacity and scale instead, which the compositor can do
 * smoothly, and it can be as bold as it likes for free.
 */

/** the squeeze is a spring; light does not snap, so it gets its own curve */
const snap = { bounce: 0.4, type: 'spring', visualDuration: 0.26 } as const;
const light = { duration: 0.55, ease: [0.22, 1, 0.36, 1] } as const;
const wash = { duration: 0.45, ease: [0.33, 0, 0.2, 1] } as const;

function body() {
  return {
    press: {
      scale: tuneNumber('gestures', 0.44, 'pressScale (×)', 0.1, 1, 0.01),
      transition: tuneMotion('gestures', snap, 'snap'),
    },
    hover: {
      scale: tuneNumber('gestures', 1.1, 'hoverScale (×)', 1, 1.8, 0.01),
      transition: tuneMotion('gestures', snap, 'snap'),
    },
    rest: { scale: 1, transition: tuneMotion('gestures', snap, 'snap') },
  };
}

/** the globe's own light: deep ember, to gold, to blue-white under pressure */
function core() {
  return {
    press: {
      backgroundColor: '#d3e6ff',
      transition: tuneMotion('gestures', wash, 'wash'),
    },
    hover: {
      backgroundColor: '#ffb257',
      transition: tuneMotion('gestures', wash, 'wash'),
    },
    rest: {
      backgroundColor: '#ef3f1a',
      transition: tuneMotion('gestures', wash, 'wash'),
    },
  };
}

/** the limb — the hot rim at the edge of a compressed body */
function limb() {
  return {
    press: {
      backgroundColor: '#8fb8ff',
      opacity: 1,
      transition: tuneMotion('gestures', wash, 'wash'),
    },
    hover: {
      backgroundColor: '#ffe0a8',
      opacity: 0.72,
      transition: tuneMotion('gestures', wash, 'wash'),
    },
    rest: {
      backgroundColor: '#ff7a45',
      opacity: 0.4,
      transition: tuneMotion('gestures', wash, 'wash'),
    },
  };
}

/** the near glow, tight to the body */
function inner() {
  return {
    press: {
      opacity: 1,
      scale: 1.9,
      transition: tuneMotion('gestures', light, 'light'),
    },
    hover: {
      opacity: 0.7,
      scale: 1.35,
      transition: tuneMotion('gestures', light, 'light'),
    },
    rest: {
      opacity: 0.28,
      scale: 1.05,
      transition: tuneMotion('gestures', light, 'light'),
    },
  };
}

/** and the far one, which is what makes a hard press feel bright */
function outer() {
  return {
    press: {
      opacity: 0.95,
      scale: 3,
      transition: tuneMotion('gestures', light, 'light'),
    },
    hover: {
      opacity: 0.34,
      scale: 1.7,
      transition: tuneMotion('gestures', light, 'light'),
    },
    rest: {
      opacity: 0,
      scale: 1.1,
      transition: tuneMotion('gestures', light, 'light'),
    },
  };
}

const focus = { boxShadow: '0 0 0 5px rgba(255, 106, 58, 0.45)' };

export const Gestures = <template>
  <div class="ex">
    <button
      type="button"
      class="press"
      aria-label="Compress"
      {{motion
        variants=(body)
        initial="rest"
        animate="rest"
        whileHover="hover"
        whileTap="press"
        whileFocus=focus
      }}
    >
      <span class="press-glow is-far" {{motion variants=(outer)}}></span>
      <span class="press-glow is-near" {{motion variants=(inner)}}></span>
      <span class="press-core" {{motion variants=(core)}}>
        <span class="press-limb" {{motion variants=(limb)}}></span>
      </span>
    </button>
  </div>
</template>;
