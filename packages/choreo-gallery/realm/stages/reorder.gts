import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { ReorderGroup, ReorderItem } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { preventSelect } from '../lib/pointer';
import { tuneObject } from '../lib/tuning';

/**
 * A colour per track, for the same reason the grid has one: a row you are
 * dragging past four near-identical rows is hard to follow, and the hue is
 * what your eye actually tracks while the order changes underneath it.
 */
const tracks = [
  {
    artist: 'Night shift',
    hue: '#ff7a45',
    id: 'atlas',
    time: '3:41',
    title: 'Atlas',
  },
  {
    artist: 'Kiln floor',
    hue: '#6fd6c4',
    id: 'ember',
    time: '4:02',
    title: 'Ember',
  },
  {
    artist: 'Cooling rack',
    hue: '#8ba6ff',
    id: 'flux',
    time: '2:58',
    title: 'Flux',
  },
  {
    artist: 'Foundry glass',
    hue: '#c78bff',
    id: 'halo',
    time: '3:17',
    title: 'Halo',
  },
  {
    artist: 'Late heat',
    hue: '#b6d15a',
    id: 'ore',
    time: '5:04',
    title: 'Ore',
  },
];

const whileDrag = {
  boxShadow: '0 18px 40px rgba(0, 0, 0, 0.45)',
  scale: 1.04,
};
const snap = { bounce: 0.1, type: 'spring', visualDuration: 0.2 } as const;

export class ReorderList extends Component {
  @tracked items = tracks;

  get playing() {
    return this.items[0]?.id;
  }

  setItems = (items: typeof tracks) => {
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
        class='tracks'
        @values={{this.items}}
        @onReorder={{this.setItems}}
        @axis='y'
        as |group|
      >
        {{#each this.items as |track|}}
          <ReorderItem
            class={{if (isOn track.id this.playing) 'track is-on' 'track'}}
            @group={{group}}
            @value={{track}}
            @transition={{tuneObject 'reorder' snap 'ReorderItem transition 1'}}
            @whileDrag={{tuneObject
              'reorder'
              whileDrag
              'ReorderItem whileDrag 2'
            }}
            {{! a custom property, through the modifier — Motion owns a motion
                element's inline style, so a bound style= attribute here would
                be wiped by the next transform it writes }}
            @style={{trackStyle track.hue}}
          >
            <span class='grip' aria-hidden='true'></span>
            <span class='track-hue' aria-hidden='true'></span>
            <span class='track-copy'>
              <strong>{{track.title}}</strong>
              <small>{{track.artist}}</small>
            </span>
            <em>{{track.time}}</em>
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

      .tracks {
        list-style: none;
        margin: 0;
        padding: 0;
        touch-action: none;
      }

      .tracks {
        width: min(90%, 320px);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .track {
        display: flex;
        align-items: center;
        gap: 10px;
        border-radius: 16px;
        background: var(--bg-spot);
        border: 1px solid var(--line);
        padding: 10px 12px;
        cursor: grab;
        touch-action: none;
      }

      .track:active {
        cursor: grabbing;
      }

      .track.is-on {
        border-color: rgba(255, 59, 31, 0.35);
        box-shadow: inset 0 0 0 1px rgba(255, 59, 31, 0.18);
      }

      .track-hue {
        width: 4px;
        align-self: stretch;
        min-height: 22px;
        border-radius: 2px;
        background: var(--hue, var(--ember));
        flex: none;
      }

      .track-copy {
        flex: 1;
        min-width: 0;
      }

      .grip {
        width: 10px;
        height: 16px;
        background: radial-gradient(
            circle,
            var(--ink-faint) 1.1px,
            transparent 1.3px
          )
          0 0 / 5px 6px;
        opacity: 0.7;
        flex: none;
      }

      .track strong {
        display: block;
        font-size: 13px;
        letter-spacing: -0.02em;
      }

      .track small,
      .track em {
        color: var(--ink-dim);
        font-size: 11px;
      }

      .track em {
        font-style: normal;
        font-family: var(--font-mono);
        font-size: 10px;
      }

      @container (max-width: 420px) {
        .tracks {
          width: min(92%, 100%);
          max-width: 100%;
        }
      }

      .choreo-site:not([data-theme='light']) .track {
        background: #322c27;
      }
    </style>
  </template>
}

function isOn(id: string, playing?: string) {
  return id === playing;
}

function trackStyle(hue: string) {
  return { '--hue': hue };
}

// Declare the demo variables before the first interactive Choreo pass.
tuneObject('reorder', snap, 'ReorderItem transition 1');
tuneObject('reorder', whileDrag, 'ReorderItem whileDrag 2');

export class ReorderListDemo extends GalleryDemo {
  static stage = ReorderList;
}
