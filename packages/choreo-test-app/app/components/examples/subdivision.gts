import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { instantLayoutTransition, layoutChange, motion } from 'glimmer-motion';

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
    info: { offset: { x: number; y: number } }
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
    <div class="ex" data-test-subdivision>
      <div class="subdivide" data-test-grid style={{this.style}} {{this.bind}}>
        {{#each tiles as |tile|}}
          <button
            type="button"
            class={{if (this.isOn tile.id) "sub-tile is-on" "sub-tile"}}
            data-test-tile={{tile.id}}
            {{motion layout=true transition=settle}}
            {{on "click" (fn this.select tile.id)}}
          >
            <b {{motion layout="position" transition=settle}}>{{tile.label}}</b>
            <small {{motion layout="position" transition=settle}}>
              {{tile.stock}}
            </small>
          </button>
        {{/each}}

        {{! the seams: pan targets, and nothing else. They take no part in the
            grid — they are positioned over it — so dragging one never moves
            the thing being measured. }}
        <span
          class="sub-seam is-col {{if (this.isLive 'col') 'is-live'}}"
          data-test-seam="col"
          style={{this.colSeam}}
          {{motion
            onPanStart=(fn this.grab "col")
            onPan=(fn this.drag "col")
            onPanEnd=(fn this.drop "col")
          }}
          {{on "dblclick" (fn this.even "col")}}
        ></span>
        <span
          class="sub-seam is-row {{if (this.isLive 'row') 'is-live'}}"
          data-test-seam="row"
          style={{this.rowSeam}}
          {{motion
            onPanStart=(fn this.grab "row")
            onPan=(fn this.drag "row")
            onPanEnd=(fn this.drop "row")
          }}
          {{on "dblclick" (fn this.even "row")}}
        ></span>
      </div>

      <p class="sub-hint">Drag a seam · double-click to even</p>
    </div>
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
