import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion, Presence } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneMotion } from '../lib/tuning';

const keyOf = (item: { id: string }) => item.id;
const draw = { opacity: 1, pathLength: 1 };
const hide = { opacity: 0 };
const sparkIn = { opacity: 1, pathLength: 0 };
const ringIn = { opacity: 0.7, pathLength: 0 };
const spark = { duration: 0.62, ease: [0.22, 1, 0.36, 1] } as const;
const ring = { delay: 0.06, duration: 0.72, ease: [0.22, 1, 0.36, 1] } as const;
const sparkPath =
  'M50 10C53 32 60 40 82 42C60 46 55 58 58 84C50 62 38 54 14 52C38 46 46 32 50 10Z';

export class PathDraw extends Component {
  @tracked generation = 0;

  get items() {
    return [{ id: `path-${this.generation}` }];
  }

  replay = () => {
    this.generation += 1;
  };

  <template>
    <div class='ex'>
      <button
        type='button'
        class='replay'
        {{on 'click' this.replay}}
      >Replay</button>
      <Presence @items={{this.items}} @key={{keyOf}} @mode='wait' as |_item h|>
        <svg class='spark-svg' viewBox='0 0 100 100' aria-hidden='true'>
          <defs>
            <linearGradient id='spark-stroke' x1='0' y1='0' x2='1' y2='1'>
              <stop offset='0%' stop-color='#ffb36a' />
              <stop offset='100%' stop-color='#ff3b1f' />
            </linearGradient>
          </defs>
          <circle
            cx='50'
            cy='50'
            r='38'
            {{motion
              presence=h
              initial=ringIn
              animate=draw
              exit=hide
              transition=(tuneMotion 'path' ring 'ring')
            }}
          />
          <path
            d={{sparkPath}}
            {{motion
              presence=h
              initial=sparkIn
              animate=draw
              exit=hide
              transition=(tuneMotion 'path' spark 'spark')
            }}
          />
        </svg>
      </Presence>
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

      /* The stage is mostly empty air around one quiet stroke, so in light mode
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

      .replay {
        position: absolute;
        top: 14px;
        right: 14px;
        z-index: 3;
        border: 1px solid var(--line-strong);
        background: rgba(var(--bg-rgb), 0.72);
        backdrop-filter: blur(8px);
        border-radius: 999px;
        padding: 7px 12px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-dim);
      }

      @media (hover: hover) {
        .replay:hover {
          color: var(--ink);
        }
      }

      .spark-svg {
        width: 188px;
        height: 188px;
        overflow: visible;
      }

      .spark-svg path,
      .spark-svg circle {
        fill: none;
        stroke: url(#spark-stroke);
        stroke-width: 2.4;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .spark-svg path {
        filter: drop-shadow(0 0 12px var(--glow));
      }

      .spark-svg circle {
        stroke-width: 1.2;
        opacity: 0.7;
      }
    </style>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('path', ring, 'ring');
tuneMotion('path', spark, 'spark');

export class PathDrawDemo extends GalleryDemo {
  static stage = PathDraw;
}
