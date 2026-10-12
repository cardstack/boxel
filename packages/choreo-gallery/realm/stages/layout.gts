import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { LayoutGroup, motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneMotion } from '../lib/tuning';
import LayoutNotes from '../notes/layout';

const records = [
  {
    artist: 'Night shift',
    id: 'atlas',
    title: 'Atlas',
    wash: 'linear-gradient(160deg, #ff7a45, #7a1408)',
  },
  {
    artist: 'Kiln floor',
    id: 'ember',
    title: 'Ember',
    wash: 'linear-gradient(160deg, #ffb36a, #c42712)',
  },
  {
    artist: 'Cooling rack',
    id: 'flux',
    title: 'Flux',
    wash: 'linear-gradient(160deg, #8b969c, #2a211c)',
  },
  {
    artist: 'Foundry glass',
    id: 'halo',
    title: 'Halo',
    wash: 'linear-gradient(160deg, #f3ece3, #9c6b3c)',
  },
];

const curves = {
  bounce: { bounce: 0.48, type: 'spring', visualDuration: 0.5 },
  ease: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
  linear: { duration: 0.4, ease: 'linear' },
  snap: { bounce: 0, type: 'spring', visualDuration: 0.18 },
} as const;

const names = ['snap', 'bounce', 'ease', 'linear'] as const;

type Curve = (typeof names)[number];

export class LayoutToggle extends Component {
  @tracked grid = false;
  @tracked curve: Curve = 'bounce';

  get transition() {
    return curves[this.curve];
  }

  toggle = () => {
    this.grid = !this.grid;
  };

  pick = (curve: Curve) => {
    this.curve = curve;
    this.grid = !this.grid;
  };

  <template>
    <LayoutGroup>
      <div class='ex'>
        <div class='curve-row'>
          {{#each names as |name|}}
            <button
              type='button'
              class={{if (isOn name this.curve) 'chip is-on' 'chip'}}
              {{on 'click' (fn this.pick name)}}
            >{{name}}</button>
          {{/each}}
        </div>
        <button type='button' class='replay' {{on 'click' this.toggle}}>
          {{if this.grid 'List' 'Grid'}}
        </button>
        <div class={{if this.grid 'shelf is-grid' 'shelf is-list'}}>
          {{#each records as |record|}}
            <div
              class='record'
              {{motion
                layout=true
                transition=(tuneMotion 'layout' this.transition 'transition')
              }}
            >
              <div
                class='record-art'
                {{motion
                  layout=true
                  style=(artStyle record.wash)
                  transition=(tuneMotion 'layout' this.transition 'transition')
                }}
              ></div>
              <div
                class='record-meta'
                {{motion
                  layout='position'
                  transition=(tuneMotion 'layout' this.transition 'transition')
                }}
              >
                <strong>{{record.title}}</strong>
                <small>{{record.artist}}</small>
              </div>
            </div>
          {{/each}}
        </div>
      </div>
    </LayoutGroup>
    <style scoped>
      .chip {
        border: 1px solid var(--line);
        background: transparent;
        color: var(--ink-dim);
        border-radius: 999px;
        padding: 7px 12px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .chip.is-on {
        color: var(--ink);
        border-color: var(--line-strong);
        background: var(--bg-spot);
      }

      @media (hover: hover) {
        .chip:hover {
          color: var(--ink);
          border-color: var(--line-strong);
          background: var(--bg-spot);
        }
      }

      .chip.is-on {
        box-shadow: inset 0 0 0 1px rgba(255, 59, 31, 0.35);
        color: var(--ember-hot);
      }

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

      .ex:has(.curve-row) {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: safe center;
        padding: 72px 16px 20px;
      }

      .curve-row {
        position: absolute;
        top: 14px;
        left: 14px;
        right: 96px;
        z-index: 3;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        max-width: none;
      }

      .shelf {
        width: min(88%, 300px);
      }

      .shelf.is-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /**
       * Grid mode is the one that can overflow, so it is bounded on BOTH axes
       * against the stage rather than only by width. `.ex` is a size container, and
       * the third term is this layout's own arithmetic: two columns of (w − 10)/2,
       * a ~38px caption under each, twice over, plus the row gap — which comes to
       * w + 78. Holding that under 76% of the stage height leaves room for the curve
       * picker above and keeps the second row on screen at any size.
       *
       * The class selector is deliberate: a narrow-stage rule below widens `.shelf`
       * to fill its container, and this has to outrank it.
       */
      .shelf.is-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px 10px;
        width: min(88cqw, 300px, calc(86cqh - 60px));
      }

      .record {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .shelf.is-grid .record {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
      }

      .record-art {
        width: 56px;
        height: 56px;
        border-radius: 14px;
        flex: none;
        box-shadow: 0 10px 22px
          rgba(var(--shadow-rgb), calc(0.35 * var(--shadow-a)));
      }

      .shelf.is-grid .record-art {
        width: 100%;
        height: auto;
        aspect-ratio: 1;
        border-radius: 16px;
      }

      .record-meta strong {
        display: block;
        font-family: var(--font-display);
        font-size: clamp(12px, 3.4cqw, 16px);
        letter-spacing: -0.03em;
      }

      .record-meta small {
        color: var(--ink-dim);
        font-size: clamp(10px, 2.6cqw, 12px);
      }

      @container (max-width: 420px) {
        .ex:has(.curve-row) {
          padding-top: 78px;
        }

        .curve-row {
          right: 80px;
        }

        .curve-row .chip {
          padding: 5px 8px;
          font-size: 10px;
        }

        .shelf {
          width: min(92%, 100%);
          max-width: 100%;
        }
      }

      @media (max-width: 720px) {
        .chip {
          padding: 9px 14px;
        }
      }
    </style>
  </template>
}

function isOn(name: Curve, curve: Curve) {
  return name === curve;
}

function artStyle(wash: string) {
  return { background: wash };
}

export class LayoutToggleDemo extends GalleryDemo {
  static stage = LayoutToggle;
  static notes = LayoutNotes;
}
