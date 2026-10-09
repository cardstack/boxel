import { motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneMotion, tuneNumber } from '../lib/tuning';

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
  <div class='ex'>
    <button
      type='button'
      class='press'
      aria-label='Compress'
      {{motion
        variants=(body)
        initial='rest'
        animate='rest'
        whileHover='hover'
        whileTap='press'
        whileFocus=focus
      }}
    >
      <span class='press-glow is-far' {{motion variants=(outer)}}></span>
      <span class='press-glow is-near' {{motion variants=(inner)}}></span>
      <span class='press-core' {{motion variants=(core)}}>
        <span class='press-limb' {{motion variants=(limb)}}></span>
      </span>
    </button>
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

    /* The stage is mostly empty air around one quiet ball, so in light mode
       it takes a little more presence than the default platter tint. Dark
       mode's plain platter is already fine. */
    .choreo-site[data-theme='light'] .ex {
      background:
        radial-gradient(
          80% 70% at 50% 40%,
          rgba(255, 59, 31, 0.16),
          transparent 60%
        ),
        rgba(var(--surface-tint-rgb), 0.14);
    }

    .press {
      position: relative;
      width: min(40%, 136px);
      aspect-ratio: 1;
      border: 0;
      border-radius: 50%;
      display: grid;
      place-items: center;
      padding: 0;
      background: transparent;
      cursor: pointer;
    }

    /* the glow is elements, not a shadow: opacity and scale only, so it is smooth
         at any boldness */
    .press-glow {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      pointer-events: none;
      will-change: transform, opacity;
    }

    .press-glow.is-near {
      background: radial-gradient(
        circle,
        rgba(255, 176, 110, 0.62) 0%,
        rgba(255, 106, 58, 0.34) 46%,
        transparent 70%
      );
      filter: blur(6px);
    }

    .press-glow.is-far {
      background: radial-gradient(
        circle,
        rgba(186, 216, 255, 0.5) 0%,
        rgba(255, 122, 69, 0.22) 40%,
        transparent 68%
      );
      filter: blur(14px);
    }

    .press-core {
      position: relative;
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: #ef3f1a;
      overflow: hidden;
      box-shadow:
        inset 0 -16px 34px rgba(20, 12, 10, 0.36),
        inset 0 12px 26px rgba(255, 255, 255, 0.3);
    }

    /* the limb: a bright rim just inside the edge */
    .press-limb {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: #ff7a45;
      mask: radial-gradient(circle, transparent 54%, #000 76%, transparent 97%);
      -webkit-mask: radial-gradient(
        circle,
        transparent 54%,
        #000 76%,
        transparent 97%
      );
    }
  </style>
</template>;

export class GesturesDemo extends GalleryDemo {
  static stage = Gestures;
}
