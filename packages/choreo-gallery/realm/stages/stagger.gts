import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion, type MotionProps, Presence } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneVariants } from '../lib/tuning';

// glimmer-motion does not export motion-dom's `Variants`; the modifier's own
// `variants` argument is that type.
type Variants = NonNullable<MotionProps['variants']>;

const keyOf = (item: { id: string }) => item.id;

const apps = [
  { hue: '#ff3b1f', name: 'Forge' },
  { hue: '#ff6a3a', name: 'Reel' },
  { hue: '#e4a35a', name: 'Ore' },
  { hue: '#8b969c', name: 'Flux' },
  { hue: '#f3ece3', name: 'Halo' },
  { hue: '#c42712', name: 'Kiln' },
];

const grid: Variants = {
  hidden: {},
  show: {
    transition: { delayChildren: 0.06, staggerChildren: 0.09 },
  },
};

const tile: Variants = {
  hidden: { opacity: 0, scale: 0.35, y: 36 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { bounce: 0.42, type: 'spring', visualDuration: 0.4 },
    y: 0,
  },
};

export class Stagger extends Component {
  @tracked generation = 0;

  get items() {
    return [{ id: `dock-${this.generation}` }];
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
      <Presence @items={{this.items}} @key={{keyOf}} @mode='wait' as |_dock h|>
        <div
          class='apps'
          {{motion
            presence=h
            variants=(tuneVariants 'stagger' grid 'grid')
            initial='hidden'
            animate='show'
          }}
        >
          {{#each apps as |app|}}
            <div
              class='app-tile'
              {{motion variants=(tuneVariants 'stagger' tile 'tile')}}
            >
              <span class='app-icon' style={{iconWash app.hue}}></span>
              <small>{{app.name}}</small>
            </div>
          {{/each}}
        </div>
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

      .apps {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px 12px;
        width: min(86%, 280px);
      }

      .app-tile {
        display: grid;
        justify-items: center;
        gap: 8px;
      }

      .app-icon {
        width: 64px;
        height: 64px;
        border-radius: 18px;
        box-shadow:
          0 12px 24px rgba(0, 0, 0, 0.35),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
      }

      .app-tile small {
        font-size: 11px;
        color: var(--ink-dim);
      }

      @container (max-width: 420px) {
        .apps {
          width: min(92%, 100%);
          max-width: 100%;
        }

        .app-icon {
          width: 52px;
          height: 52px;
          border-radius: 14px;
        }
      }

      @container (max-width: 280px) {
        .apps {
          gap: 10px 6px;
        }

        .app-icon {
          width: 44px;
          height: 44px;
        }
      }
    </style>
  </template>
}

function iconWash(hue: string) {
  return htmlSafe(
    `background: radial-gradient(circle at 32% 28%, #fff7, transparent 36%), linear-gradient(160deg, ${hue}, #1a100c)`,
  );
}

// Declare the demo variables before the first interactive Choreo pass.
tuneVariants('stagger', grid, 'grid');
tuneVariants('stagger', tile, 'tile');

export class StaggerDemo extends GalleryDemo {
  static stage = Stagger;
}
