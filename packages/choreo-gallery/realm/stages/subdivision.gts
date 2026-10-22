import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { instantLayoutTransition, layoutChange, motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneMotion } from '../lib/tuning';
import SubdivisionNotes from '../notes/subdivision';

const tiles = [
  { id: 'atlas', label: 'Atlas', stock: 'Kiln floor' },
  { id: 'ember', label: 'Ember', stock: 'Night shift' },
  { id: 'flux', label: 'Flux', stock: 'Cooling rack' },
  { id: 'halo', label: 'Halo', stock: 'Foundry glass' },
];

/** how far a track may be squeezed before it stops being a tile */
const MIN = 22;
const MAX = 78;
const settle = { bounce: 0.18, type: 'spring', visualDuration: 0.42 } as const;

const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

/**
 * A grid you subdivide by hand: the layout is whatever the last drag left.
 *
 * Two things are happening, and keeping them apart is the demo:
 *
 *   While a seam is being dragged the columns follow the pointer EXACTLY. No
 *   spring, no easing — a seam that lags behind the finger feels broken rather
 *   than smooth. Every one of those updates is wrapped in
 *   `instantLayoutTransition`, which tells the projection tree to take this
 *   change without animating it.
 *
 *   On release the tracks land on rounded percentages, and that change is NOT
 *   wrapped — so the four tiles, which carry `layout=true` throughout, spring
 *   into the new grid. Same elements, same prop, opposite behaviour, decided
 *   entirely by whether the state change was wrapped.
 *
 * The seams are their own elements, which is why clicking a tile can never
 * start a pan: the gesture is not on the tiles at all.
 */
export class Subdivision extends Component {
  @tracked col = 40;
  @tracked row = 45;
  @tracked selected = 'atlas';
  @tracked live?: 'col' | 'row';
  private frame?: HTMLElement;
  private startAt = 0;

  bind = modifier((element: HTMLElement) => {
    this.frame = element;
    return () => {
      this.frame = undefined;
    };
  });

  get style() {
    return `grid-template-columns:${this.col}% 1fr;grid-template-rows:${this.row}% 1fr`;
  }

  select = (id: string) => {
    this.selected = id;
  };

  isOn = (id: string) => id === this.selected;

  grab = (axis: 'col' | 'row') => {
    this.startAt = axis === 'col' ? this.col : this.row;
    this.live = axis;
  };

  /** live: the seam is under the finger, so nothing is allowed to animate */
  drag = (
    axis: 'col' | 'row',
    _event: unknown,
    info: { offset: { x: number; y: number } },
  ) => {
    const box = this.frame?.getBoundingClientRect();
    if (!box) {
      return;
    }
    const moved =
      axis === 'col'
        ? (info.offset.x / box.width) * 100
        : (info.offset.y / box.height) * 100;
    const next = clamp(this.startAt + moved);
    instantLayoutTransition(() => {
      if (axis === 'col') {
        this.col = next;
      } else {
        this.row = next;
      }
    });
  };

  /**
   * Released: the tiles spring into the rounded grid.
   *
   * An ordinary state change is not enough on its own. A layout animation is
   * the difference between two measurements, and the first one has to be taken
   * BEFORE the change — React's Motion does that for every projecting node on
   * every commit, but here someone has to ask. `<LayoutGroup>`, `<Presence>`,
   * `<Choreo>` and `<ReorderGroup>` ask; this card has none of them, so on its
   * own page the tiles arrived already rounded. `layoutChange` is the ask.
   */
  drop = (axis: 'col' | 'row') => {
    this.live = undefined;
    layoutChange(() => {
      if (axis === 'col') {
        this.col = Math.round(this.col);
      } else {
        this.row = Math.round(this.row);
      }
    });
  };

  even = (axis: 'col' | 'row') => {
    layoutChange(() => {
      if (axis === 'col') {
        this.col = 50;
      } else {
        this.row = 50;
      }
    });
  };

  <template>
    <div class='ex' data-test-subdivision>
      <div class='subdivide' data-test-grid style={{this.style}} {{this.bind}}>
        {{#each tiles as |tile|}}
          <button
            type='button'
            class={{if (this.isOn tile.id) 'sub-tile is-on' 'sub-tile'}}
            data-test-tile={{tile.id}}
            {{motion
              layout=true
              transition=(tuneMotion 'subdivision' settle 'settle')
            }}
            {{on 'click' (fn this.select tile.id)}}
          >
            <b
              {{motion
                layout='position'
                transition=(tuneMotion 'subdivision' settle 'settle')
              }}
            >{{tile.label}}</b>
            <small
              {{motion
                layout='position'
                transition=(tuneMotion 'subdivision' settle 'settle')
              }}
            >
              {{tile.stock}}
            </small>
          </button>
        {{/each}}

        {{! the seams: pan targets, and nothing else. They take no part in the
            grid — they are positioned over it — so dragging one never moves
            the thing being measured. }}
        <span
          {{! a double click evens the split, a pointer shortcut beside the drag }}
          {{! template-lint-disable no-invalid-interactive }}
          class='sub-seam is-col {{if (this.isLive "col") "is-live"}}'
          data-test-seam='col'
          style={{this.colSeam}}
          {{motion
            onPanStart=(fn this.grab 'col')
            onPan=(fn this.drag 'col')
            onPanEnd=(fn this.drop 'col')
          }}
          {{on 'dblclick' (fn this.even 'col')}}
        ></span>
        <span
          {{! a double click evens the split, a pointer shortcut beside the drag }}
          {{! template-lint-disable no-invalid-interactive }}
          class='sub-seam is-row {{if (this.isLive "row") "is-live"}}'
          data-test-seam='row'
          style={{this.rowSeam}}
          {{motion
            onPanStart=(fn this.grab 'row')
            onPan=(fn this.drag 'row')
            onPanEnd=(fn this.drop 'row')
          }}
          {{on 'dblclick' (fn this.even 'row')}}
        ></span>
      </div>

      <p class='sub-hint'>Drag a seam · double-click to even</p>
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

      /* ---- Subdivision ---- */

      .subdivide {
        position: relative;
        display: grid;
        /* the seams centre themselves in this, so it lives in one place */
        --seam-gap: 16px;
        gap: var(--seam-gap);
        width: min(92cqw, 340px);
        height: min(72cqh, 300px);
      }

      .sub-tile {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: flex-end;
        gap: 2px;
        min-width: 0;
        min-height: 0;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--bg-spot);
        color: var(--ink);
        text-align: left;
        cursor: pointer;
        overflow: hidden;
      }

      .sub-tile.is-on {
        border-color: rgba(255, 59, 31, 0.45);
        background: var(--bg-spot);
      }

      .sub-tile b {
        font-family: var(--font-display);
        font-size: 13px;
      }

      .sub-tile small {
        color: var(--ink-dim);
        font-size: 11px;
      }

      /* over the grid, never in it. The hit area is wide; the mark is not. */
      .sub-seam {
        position: absolute;
        z-index: 2;
        background: transparent;
        touch-action: none;
      }

      /* the line */
      .sub-seam::after {
        content: '';
        position: absolute;
        inset: 0;
        margin: auto;
        border-radius: 999px;
        background: var(--line-strong);
        transition: background 120ms ease;
      }

      /* the grip: the part that says "pull me". Placed off-centre along each seam so
         the two can never stack, including at the even 50/50 the hint offers. */
      .sub-seam::before {
        content: '';
        position: absolute;
        border-radius: 999px;
        background: rgb(243 236 227 / 42%);
        border: 1px solid var(--bg-spot);
        box-shadow: 0 2px 8px
          rgba(var(--shadow-rgb), calc(0.55 * var(--shadow-a)));
        transition:
          background 120ms ease,
          scale 140ms ease;
      }

      .sub-seam.is-col {
        top: 0;
        bottom: 0;
        width: 18px;
        translate: -50% 0;
        cursor: col-resize;
      }

      .sub-seam.is-col::after {
        width: 2px;
      }

      .sub-seam.is-col::before {
        top: 28%;
        left: 50%;
        width: 6px;
        height: 34px;
        translate: -50% -50%;
      }

      .sub-seam.is-row {
        left: 0;
        right: 0;
        height: 18px;
        translate: 0 -50%;
        cursor: row-resize;
      }

      .sub-seam.is-row::after {
        height: 2px;
      }

      .sub-seam.is-row::before {
        top: 50%;
        left: 72%;
        width: 34px;
        height: 6px;
        translate: -50% -50%;
      }

      .sub-seam.is-live::after,
      .sub-seam.is-live::before {
        background: var(--ember-hot);
      }

      @media (hover: hover) {
        .sub-seam:hover::after,
        .sub-seam:hover::before {
          background: var(--ember-hot);
        }
      }

      /* while the pointer holds it, the grip is bigger than the seam it rides */
      .sub-seam.is-live::before {
        scale: 1.18;
      }

      .sub-hint {
        margin: 12px 0 0;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .choreo-site:not([data-theme='light']) .sub-tile {
        background: #312c27;
      }

      .choreo-site:not([data-theme='light']) .sub-tile.is-on {
        background: #3d342c;
      }

      .choreo-site:not([data-theme='light']) .sub-seam::before {
        border: 1px solid #312c27;
      }
    </style>
  </template>

  isLive = (axis: 'col' | 'row') => axis === this.live;

  // the track boundary is at N%, but the grid gap opens to the RIGHT of it, so
  // the gutter's centre — where the seam belongs — is half a gap further on
  get colSeam() {
    return `left:calc(${this.col}% + var(--seam-gap) / 2)`;
  }

  get rowSeam() {
    return `top:calc(${this.row}% + var(--seam-gap) / 2)`;
  }
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('subdivision', settle, 'settle');

export class SubdivisionDemo extends GalleryDemo {
  static stage = Subdivision;
  static notes = SubdivisionNotes;
}
