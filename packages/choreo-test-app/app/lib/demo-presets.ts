import type { DialValue } from 'dialkit/vanilla';

interface DemoPreset {
  name: string;
  values: Record<string, DialValue>;
}

/** Two authored looks per demo. Version 1 keeps the source defaults. */
export const demoPresets: Record<string, DemoPreset[]> = {
  lightbox: [
    {
      name: 'Dreamy expansion',
      values: {
        spring: {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.65,
        },
      },
    },
    {
      name: 'Quick peek',
      values: {
        spring: {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0,
        },
      },
    },
  ],
  tabs: [
    {
      name: 'Jelly tab',
      values: {
        pill: {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.65,
        },
      },
    },
    {
      name: 'Magnetic tab',
      values: {
        pill: {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0,
        },
      },
    },
  ],
  layout: [
    {
      name: 'Rubber layout',
      values: {
        transition: {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.65,
        },
      },
    },
    {
      name: 'Crisp shuffle',
      values: {
        transition: {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0,
        },
      },
    },
  ],
  trail: [
    {
      name: 'Slinky trail',
      values: {
        spring: {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.65,
        },
      },
    },
    {
      name: 'Tight formation',
      values: {
        spring: {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0,
        },
      },
    },
  ],
  subdivision: [
    {
      name: 'Soft mosaic',
      values: {
        settle: {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.65,
        },
      },
    },
    {
      name: 'Precision tiles',
      values: {
        settle: {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0,
        },
      },
    },
  ],
  lists: [
    {
      name: 'Bouncy sorting',
      values: {
        quick: {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.65,
        },
      },
    },
    {
      name: 'Express sorting',
      values: {
        quick: {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0,
        },
      },
    },
  ],
  split: [
    {
      name: 'Elastic split',
      values: {
        firm: {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.65,
        },
      },
    },
    {
      name: 'Firm snap',
      values: {
        firm: {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0,
        },
      },
    },
  ],
  keyframes: [
    {
      name: 'Helicopter',
      values: {
        'rotation (deg)': 720,
        'peakScale (\u00d7)': 1.35,
        'lift (px)': 48,
        transition: {
          type: 'easing',
          duration: 0.8,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
    {
      name: 'Moon hop',
      values: {
        'rotation (deg)': 90,
        'peakScale (\u00d7)': 1.5,
        'lift (px)': 65,
        transition: {
          type: 'easing',
          duration: 2.3,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
  ],
  gestures: [
    {
      name: 'Rubber sun',
      values: {
        'pressScale (\u00d7)': 0.18,
        'hoverScale (\u00d7)': 1.45,
        snap: {
          type: 'spring',
          visualDuration: 0.5,
          bounce: 0.65,
        },
      },
    },
    {
      name: 'Quiet pulse',
      values: {
        'pressScale (\u00d7)': 0.82,
        'hoverScale (\u00d7)': 1.04,
        snap: {
          type: 'spring',
          visualDuration: 0.2,
          bounce: 0,
        },
      },
    },
  ],
  inbox: [
    {
      name: 'Paper boomerang',
      values: {
        toss: {
          type: 'spring',
          visualDuration: 0.75,
          bounce: 0.6,
        },
        quick: {
          type: 'spring',
          visualDuration: 0.45,
          bounce: 0.35,
        },
      },
    },
    {
      name: 'Express mail',
      values: {
        toss: {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0,
        },
        quick: {
          type: 'spring',
          visualDuration: 0.18,
          bounce: 0,
        },
      },
    },
  ],
  interrupt: [
    {
      name: 'Spring tug',
      values: {
        carry: {
          type: 'spring',
          visualDuration: 0.8,
          bounce: 0.65,
        },
        'TIMED duration (s)': 1.2,
      },
    },
    {
      name: 'Fast catch',
      values: {
        carry: {
          type: 'spring',
          visualDuration: 0.24,
          bounce: 0.08,
        },
        'TIMED duration (s)': 0.35,
      },
    },
  ],
  camera: [
    {
      name: 'Floating lens',
      values: {
        carry: {
          type: 'spring',
          visualDuration: 0.8,
          bounce: 0.08,
        },
        settle: {
          type: 'spring',
          visualDuration: 0.7,
          bounce: 0.3,
        },
      },
    },
    {
      name: 'Whip and settle',
      values: {
        carry: {
          type: 'spring',
          visualDuration: 0.2,
          bounce: 0,
        },
        settle: {
          type: 'spring',
          visualDuration: 0.35,
          bounce: 0.45,
        },
      },
    },
  ],
  far: [
    {
      name: 'Rubber courier',
      values: {
        carry: {
          type: 'spring',
          visualDuration: 0.8,
          bounce: 0.55,
        },
        settle: {
          type: 'spring',
          visualDuration: 0.55,
          bounce: 0.4,
        },
      },
    },
    {
      name: 'Direct delivery',
      values: {
        carry: {
          type: 'spring',
          visualDuration: 0.25,
          bounce: 0,
        },
        settle: {
          type: 'spring',
          visualDuration: 0.2,
          bounce: 0,
        },
      },
    },
  ],
  escort: [
    {
      name: 'Leisurely escort',
      values: {
        'Carry spring 1': {
          type: 'spring',
          visualDuration: 0.85,
          bounce: 0.25,
        },
        'Follow duration 2 (s)': 2.5,
        'Follow duration 3 (s)': 2.5,
      },
    },
    {
      name: 'Quick handoff',
      values: {
        'Carry spring 1': {
          type: 'spring',
          visualDuration: 0.25,
          bounce: 0.1,
        },
        'Follow duration 2 (s)': 0.7,
        'Follow duration 3 (s)': 0.7,
      },
    },
  ],
  sequence: [
    {
      name: 'Anticipation',
      values: {
        'Step 1 duration (s)': 0.5,
        'Step 2 duration (s)': 1.1,
        'Step 3 duration (s)': 0.18,
        soft: {
          type: 'spring',
          visualDuration: 0.7,
          bounce: 0.5,
        },
      },
    },
    {
      name: 'Staccato',
      values: {
        'Step 1 duration (s)': 0.12,
        'Step 2 duration (s)': 0.25,
        'Step 3 duration (s)': 0.16,
        soft: {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0.1,
        },
      },
    },
  ],
  jump: [
    {
      name: 'Scenic jump',
      values: {
        'Scroll duration 1 (s)': 1.1,
        'Raise duration 2 (s)': 1.8,
        'Hold duration 3 (s)': 1.2,
      },
    },
    {
      name: 'Jump cut',
      values: {
        'Scroll duration 1 (s)': 0.2,
        'Raise duration 2 (s)': 0.35,
        'Hold duration 3 (s)': 0.3,
      },
    },
  ],
  'long-take': [
    {
      name: 'Gallery stroll',
      values: {
        'shotTempo (\u00d7)': 0.6,
      },
    },
    {
      name: 'Express tour',
      values: {
        'shotTempo (\u00d7)': 1.8,
      },
    },
  ],
  sylva: [
    {
      name: 'Dream glide',
      values: {
        'Camera first spring response': 10,
        'Camera second spring response': 6,
        'Aim first spring response': 4,
        'Aim second spring response': 2.5,
        'Tour duration (s)': 45,
      },
    },
    {
      name: 'Brisk tracking',
      values: {
        'Camera first spring response': 32,
        'Camera second spring response': 24,
        'Aim first spring response': 14,
        'Aim second spring response': 9,
        'Tour duration (s)': 20,
      },
    },
  ],
  towers: [
    {
      name: 'Into the mist',
      values: {
        'Camera rig height (units)': 9,
        'Cloud haze (ratio)': 0.65,
        'Color grade strength (ratio)': 0.75,
      },
    },
    {
      name: 'Clear architecture',
      values: {
        'Camera rig height (units)': 4.5,
        'Cloud haze (ratio)': 0.02,
        'Color grade strength (ratio)': 0.1,
      },
    },
  ],
  sagrada: [
    {
      name: 'Cathedral gaze',
      values: {
        'Camera rig height (units)': 10,
        'Color grade strength (ratio)': 0.85,
      },
    },
    {
      name: 'Stone study',
      values: {
        'Camera rig height (units)': 4,
        'Color grade strength (ratio)': 0.1,
      },
    },
  ],
  rack: [
    {
      name: 'Tile ballet',
      values: {
        'SPAN duration (s)': 3.8,
      },
    },
    {
      name: 'Speed scrabble',
      values: {
        'SPAN duration (s)': 0.7,
      },
    },
  ],
  fold: [
    {
      name: 'Suspenseful fold',
      values: {
        'cmd hold duration (s)': 2,
      },
    },
    {
      name: 'Quick fold',
      values: {
        'cmd hold duration (s)': 0.25,
      },
    },
  ],
  'build-order': [
    {
      name: 'Show each beat',
      values: {
        'HOLD duration (s)': 1.8,
      },
    },
    {
      name: 'Rapid assembly',
      values: {
        'HOLD duration (s)': 0.3,
      },
    },
  ],
  path: [
    {
      name: 'Slow signature',
      values: {
        ring: {
          type: 'easing',
          duration: 1.6,
          ease: [0.22, 1, 0.36, 1],
        },
        spark: {
          type: 'easing',
          duration: 1.25,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
    {
      name: 'Electric sketch',
      values: {
        ring: {
          type: 'easing',
          duration: 0.3,
          ease: [0.22, 1, 0.36, 1],
        },
        spark: {
          type: 'easing',
          duration: 0.22,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
  ],
  header: [
    {
      name: 'Floating header',
      values: {
        tween: {
          type: 'easing',
          duration: 0.65,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
    {
      name: 'Instant response',
      values: {
        tween: {
          type: 'easing',
          duration: 0.1,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
  ],
  parallax: [
    {
      name: 'Deep layers',
      values: {
        'Background travel (px)': -420,
        'Plate rotation (deg)': -28,
        'Plate horizontal travel (px)': 110,
        'Word travel (px)': -220,
      },
    },
    {
      name: 'Gentle depth',
      values: {
        'Background travel (px)': -70,
        'Plate rotation (deg)': -3,
        'Plate horizontal travel (px)': 15,
        'Word travel (px)': -35,
      },
    },
  ],
  reveal: [
    {
      name: 'Curtain call',
      values: {
        'sweep duration (s)': 0.7,
        'fill delay (s)': 0.3,
        'fill duration (s)': 1,
        rise: {
          type: 'spring',
          visualDuration: 0.7,
          bounce: 0.4,
        },
      },
    },
    {
      name: 'Flash reveal',
      values: {
        'sweep duration (s)': 0.16,
        'fill delay (s)': 0.03,
        'fill duration (s)': 0.22,
        rise: {
          type: 'spring',
          visualDuration: 0.24,
          bounce: 0.1,
        },
      },
    },
  ],
  playhead: [
    {
      name: 'Jelly machinery',
      values: {
        PILL: {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.65,
        },
        'KNOB S': {
          type: 'spring',
          visualDuration: 0.5,
          bounce: 0.7,
        },
        RECEIPT: {
          type: 'spring',
          visualDuration: 0.8,
          bounce: 0.5,
        },
        'Step 2 duration (s)': 1.1,
      },
    },
    {
      name: 'Precision beats',
      values: {
        PILL: {
          type: 'spring',
          visualDuration: 0.2,
          bounce: 0,
        },
        'KNOB S': {
          type: 'spring',
          visualDuration: 0.18,
          bounce: 0,
        },
        RECEIPT: {
          type: 'spring',
          visualDuration: 0.25,
          bounce: 0.05,
        },
        'Step 2 duration (s)': 0.3,
      },
    },
  ],
  'inline-edit': [
    {
      name: 'Unhurried edit',
      values: {
        'Crossing duration 1 (s)': 1.1,
        'MOVE duration (s)': 1.1,
        'LEAVE duration (s)': 0.35,
      },
    },
    {
      name: 'Quick correction',
      values: {
        'Crossing duration 1 (s)': 0.22,
        'MOVE duration (s)': 0.22,
        'LEAVE duration (s)': 0.08,
      },
    },
  ],
  slides: [
    {
      name: 'Elastic typography',
      values: {
        type: {
          type: 'spring',
          visualDuration: 0.8,
          bounce: 0.55,
        },
        plate: {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.4,
        },
        radiusTween: {
          type: 'easing',
          duration: 0.75,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
    {
      name: 'Editorial snap',
      values: {
        type: {
          type: 'spring',
          visualDuration: 0.24,
          bounce: 0,
        },
        plate: {
          type: 'spring',
          visualDuration: 0.25,
          bounce: 0.05,
        },
        radiusTween: {
          type: 'easing',
          duration: 0.2,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
  ],
  mockup: [
    {
      name: 'Slow reveal',
      values: {
        swell: {
          type: 'easing',
          duration: 1.2,
          ease: [0.22, 1, 0.36, 1],
        },
        FADE: {
          type: 'easing',
          duration: 0.5,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
    {
      name: 'Pop reveal',
      values: {
        swell: {
          type: 'easing',
          duration: 0.22,
          ease: [0.22, 1, 0.36, 1],
        },
        FADE: {
          type: 'easing',
          duration: 0.1,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
  ],
  presentation: [
    {
      name: 'Dramatic entrance',
      values: {
        'IN duration (s)': 0.65,
        'FLIGHT duration (s)': 2.2,
        'PULSE duration (s)': 0.8,
      },
    },
    {
      name: 'Pitch tempo',
      values: {
        'IN duration (s)': 0.15,
        'FLIGHT duration (s)': 0.5,
        'PULSE duration (s)': 0.22,
      },
    },
  ],
  wires: [
    {
      name: 'Elastic wiring',
      values: {
        GLIDE: {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.65,
        },
      },
    },
    {
      name: 'Fast circuit',
      values: {
        GLIDE: {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0,
        },
      },
    },
  ],
  grid: [
    {
      name: 'Playful pickup',
      values: {
        'ReorderItem transition 1': {
          type: 'spring',
          visualDuration: 0.5,
          bounce: 0.55,
        },
        'ReorderItem whileDrag 2 rotate (deg)': 8,
        'ReorderItem whileDrag 2 scale (\u00d7)': 1.22,
      },
    },
    {
      name: 'Precise pickup',
      values: {
        'ReorderItem transition 1': {
          type: 'spring',
          visualDuration: 0.18,
          bounce: 0,
        },
        'ReorderItem whileDrag 2 rotate (deg)': 0,
        'ReorderItem whileDrag 2 scale (\u00d7)': 1.02,
      },
    },
  ],
  reorder: [
    {
      name: 'Springy stack',
      values: {
        'ReorderItem transition 1': {
          type: 'spring',
          visualDuration: 0.55,
          bounce: 0.55,
        },
        'ReorderItem whileDrag 2 scale (\u00d7)': 1.16,
      },
    },
    {
      name: 'Tidy stack',
      values: {
        'ReorderItem transition 1': {
          type: 'spring',
          visualDuration: 0.16,
          bounce: 0,
        },
        'ReorderItem whileDrag 2 scale (\u00d7)': 1.01,
      },
    },
  ],
  crossing: [
    {
      name: 'Soft silhouette',
      values: {
        'Plate radius': {
          type: 'easing',
          duration: 1.1,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
    {
      name: 'Graphic cut',
      values: {
        'Plate radius': {
          type: 'easing',
          duration: 0.15,
          ease: [0.22, 1, 0.36, 1],
        },
      },
    },
  ],
  drag: [
    {
      name: 'Rubber tether',
      values: {
        'dragElastic (ratio)': 0.65,
        'dragTransition bounceDamping (ratio)': 12,
        'dragTransition bounceStiffness (ratio)': 240,
        'dragTransition power': 0.3,
      },
    },
    {
      name: 'Magnetic well',
      values: {
        'dragElastic (ratio)': 0.02,
        'dragTransition bounceDamping (ratio)': 38,
        'dragTransition bounceStiffness (ratio)': 850,
        'dragTransition power': 0.05,
      },
    },
  ],
  grip: [
    {
      name: 'Slippery grip',
      values: {
        'dragTransition power': 0.45,
        'dragTransition timeConstant': 420,
        'dragTransition bounceDamping (ratio)': 15,
      },
    },
    {
      name: 'Sticky grip',
      values: {
        'dragTransition power': 0.05,
        'dragTransition timeConstant': 90,
        'dragTransition bounceDamping (ratio)': 45,
      },
    },
  ],
  sheet: [
    {
      name: 'Rubber sheet',
      values: {
        settle: {
          type: 'spring',
          visualDuration: 0.7,
          bounce: 0.6,
        },
        'dragElastic (ratio)': 0.5,
      },
    },
    {
      name: 'Firm drawer',
      values: {
        settle: {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0,
        },
        'dragElastic (ratio)': 0.01,
      },
    },
  ],
  drift: [
    {
      name: 'Bouncy parking',
      values: {
        ARRIVE: {
          type: 'spring',
          visualDuration: 0.8,
          bounce: 0.6,
        },
        SHUFFLE: {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.45,
        },
        DROP: {
          type: 'spring',
          visualDuration: 0.6,
          bounce: 0.5,
        },
      },
    },
    {
      name: 'Precision parking',
      values: {
        ARRIVE: {
          type: 'spring',
          visualDuration: 0.25,
          bounce: 0,
        },
        SHUFFLE: {
          type: 'spring',
          visualDuration: 0.2,
          bounce: 0,
        },
        DROP: {
          type: 'spring',
          visualDuration: 0.2,
          bounce: 0.05,
        },
      },
    },
  ],
  hang: [
    {
      name: 'Rubber hang',
      values: {
        'dragElastic (ratio)': 0.6,
        HOME: {
          type: 'spring',
          visualDuration: 0.8,
          bounce: 0.6,
        },
        KNOCK: {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.65,
        },
        OFF: {
          type: 'spring',
          visualDuration: 0.7,
          bounce: 0.35,
        },
      },
    },
    {
      name: 'Decisive release',
      values: {
        'dragElastic (ratio)': 0.02,
        HOME: {
          type: 'spring',
          visualDuration: 0.25,
          bounce: 0,
        },
        KNOCK: {
          type: 'spring',
          visualDuration: 0.2,
          bounce: 0.05,
        },
        OFF: {
          type: 'spring',
          visualDuration: 0.3,
          bounce: 0,
        },
      },
    },
  ],
  stagger: [
    {
      name: 'Popcorn',
      values: {
        'tile hidden scale (\u00d7)': 0.1,
        'tile hidden y (px)': 70,
        'tile show transition': {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.65,
        },
        'grid show transition staggerChildren': 0.16,
      },
    },
    {
      name: 'Domino ripple',
      values: {
        'tile hidden scale (\u00d7)': 0.85,
        'tile hidden y (px)': 18,
        'tile show transition': {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0.05,
        },
        'grid show transition staggerChildren': 0.035,
      },
    },
  ],
  presence: [
    {
      name: 'Soft farewell',
      values: {
        'transition opacity duration (s)': 0.6,
        'transition y': {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.3,
        },
        restMove: {
          type: 'spring',
          visualDuration: 0.6,
          bounce: 0.35,
        },
      },
    },
    {
      name: 'Quick exchange',
      values: {
        'transition opacity duration (s)': 0.1,
        'transition y': {
          type: 'spring',
          visualDuration: 0.18,
          bounce: 0,
        },
        restMove: {
          type: 'spring',
          visualDuration: 0.2,
          bounce: 0,
        },
      },
    },
  ],
  enter: [
    {
      name: 'Jack in the box',
      values: {
        'bannerTransition note late scale': {
          type: 'spring',
          visualDuration: 0.7,
          bounce: 0.7,
        },
        'bannerTransition note late y': {
          type: 'spring',
          visualDuration: 0.65,
          bounce: 0.6,
        },
        'bannerTransition note late delay (s)': 0.2,
      },
    },
    {
      name: 'Polite entrance',
      values: {
        'bannerTransition note late scale': {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0,
        },
        'bannerTransition note late y': {
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0,
        },
        'bannerTransition note late delay (s)': 0,
      },
    },
  ],
  pointer: [
    {
      name: 'Comet tail',
      values: {
        'Halo spring': {
          type: 'spring',
          stiffness: 45,
          damping: 10,
          mass: 1,
        },
        'Ring spring': {
          type: 'spring',
          stiffness: 100,
          damping: 12,
          mass: 1,
        },
        'Pointer spring': {
          type: 'spring',
          stiffness: 420,
          damping: 22,
          mass: 1,
        },
      },
    },
    {
      name: 'Magnetic pointer',
      values: {
        'Halo spring': {
          type: 'spring',
          stiffness: 350,
          damping: 35,
          mass: 1,
        },
        'Ring spring': {
          type: 'spring',
          stiffness: 450,
          damping: 40,
          mass: 1,
        },
        'Pointer spring': {
          type: 'spring',
          stiffness: 650,
          damping: 45,
          mass: 1,
        },
      },
    },
  ],
};
