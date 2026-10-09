import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { ReorderGroup, ReorderItem } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { preventSelect } from '../lib/pointer';
import { tuneObject } from '../lib/tuning';

/**
 * Six covers, six hues. The rest of the gallery is one ember palette on black,
 * which is fine when a stage has two or three things in it and useless here:
 * reordering is only legible if you can tell at a glance WHICH tile moved, and
 * six shades of the same orange cannot do that.
 */
const albums = [
  {
    id: 'atlas',
    label: 'Atlas',
    year: '24',
    wash: 'linear-gradient(160deg, #ff7a45, #7a1408)',
  },
  {
    id: 'ember',
    label: 'Ember',
    year: '24',
    wash: 'linear-gradient(160deg, #6fd6c4, #0d3f42)',
  },
  {
    id: 'flux',
    label: 'Flux',
    year: '23',
    wash: 'linear-gradient(160deg, #8ba6ff, #1b1f52)',
  },
  {
    id: 'halo',
    label: 'Halo',
    year: '23',
    wash: 'linear-gradient(160deg, #f3ece3, #9c6b3c)',
  },
  {
    id: 'ion',
    label: 'Ion',
    year: '22',
    wash: 'linear-gradient(160deg, #c78bff, #341250)',
  },
  {
    id: 'ore',
    label: 'Ore',
    year: '22',
    wash: 'linear-gradient(160deg, #b6d15a, #29380f)',
  },
];

const whileDrag = {
  boxShadow: '0 22px 44px rgba(0, 0, 0, 0.5)',
  rotate: 3,
  scale: 1.1,
};
const snap = { bounce: 0.1, type: 'spring', visualDuration: 0.2 } as const;

export class ReorderGrid extends Component {
  @tracked items = albums;

  setItems = (items: typeof albums) => {
    this.items = items;
  };

  cycle = () => {
    this.setItems([...this.items.slice(1), this.items[0]!]);
  };

  <template>
    <div class='ex no-select' {{on 'selectstart' preventSelect}}>
      <button
        type='button'
        class='replay'
        data-tour-reorder
        {{on 'click' this.cycle}}
      >Move first to last</button>
      <ReorderGroup
        class='covers'
        @values={{this.items}}
        @onReorder={{this.setItems}}
        @axis='xy'
        as |group|
      >
        {{#each this.items as |album|}}
          <ReorderItem
            class='cover'
            @group={{group}}
            @value={{album}}
            @style={{tileStyle album.wash}}
            @transition={{tuneObject 'grid' snap 'ReorderItem transition 1'}}
            @whileDrag={{tuneObject 'grid' whileDrag 'ReorderItem whileDrag 2'}}
          >
            <b>{{album.label}}</b>
            <small>{{album.year}}</small>
          </ReorderItem>
        {{/each}}
      </ReorderGroup>
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
           The block padding was missing for a long time and it showed on any stage
           tall enough to fill the platter: the content sat flush against the top and
           bottom of the recess while keeping its 16px at the sides, which reads as
           content that has overflowed rather than content that has been placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      .no-select,
      .no-select * {
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
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

      .covers {
        list-style: none;
        margin: 0;
        padding: 0;
        touch-action: none;
      }

      .covers {
        width: min(88%, 300px);
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
      }

      .cover {
        position: relative;
        aspect-ratio: 0.86;
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        padding: 10px;
        color: #fff;
        cursor: grab;
        touch-action: none;
        box-shadow: 0 10px 22px
          rgba(var(--shadow-rgb), calc(0.32 * var(--shadow-a)));
      }

      /* a grip appears on hover: these rearrange, and nothing said so before you
         happened to try dragging one */
      .cover::after {
        content: '';
        position: absolute;
        top: 8px;
        right: 8px;
        width: 14px;
        height: 10px;
        opacity: 0;
        transform: translateY(-2px);
        transition:
          opacity 0.18s var(--ease),
          transform 0.18s var(--ease);
        background-image: radial-gradient(
          currentColor 1.1px,
          transparent 1.2px
        );
        background-size: 5px 5px;
        color: rgba(255, 255, 255, 0.85);
        filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.5));
        pointer-events: none;
      }

      @media (hover: hover) {
        .covers:hover .cover::after {
          opacity: 0.45;
          transform: translateY(0);
        }
      }

      @media (hover: hover) {
        .cover:hover::after {
          opacity: 1;
        }
      }

      @media (hover: hover) {
        .cover:hover {
          box-shadow: 0 14px 30px
            rgba(var(--shadow-rgb), calc(0.42 * var(--shadow-a)));
        }
      }

      .cover:active {
        cursor: grabbing;
      }

      .cover b {
        font-family: var(--font-display);
        font-size: 13px;
        letter-spacing: -0.03em;
      }

      .cover small {
        opacity: 0.7;
        font-size: 10px;
      }

      @container (max-width: 420px) {
        .covers {
          width: min(92%, 100%);
          max-width: 100%;
        }
      }

      @container (max-width: 280px) {
        .covers {
          gap: 6px;
        }
      }
    </style>
  </template>
}

function tileStyle(wash: string) {
  return { background: wash };
}

// Declare the demo variables before the first interactive Choreo pass.
tuneObject('grid', snap, 'ReorderItem transition 1');
tuneObject('grid', whileDrag, 'ReorderItem whileDrag 2');

export class ReorderGridDemo extends GalleryDemo {
  static stage = ReorderGrid;
}
