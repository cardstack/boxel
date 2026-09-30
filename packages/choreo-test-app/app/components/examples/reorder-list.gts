import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { ReorderGroup, ReorderItem } from 'glimmer-motion';
import { tuneObject } from 'test-app/lib/demo-tuning';
import { preventSelect } from 'test-app/lib/pointer';

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
    <div class="ex no-select" {{on "selectstart" preventSelect}}>
      <button
        type="button"
        class="replay"
        data-tour-reorder
        {{on "click" this.cycle}}
      >Move first to last</button>
      <ReorderGroup
        class="tracks"
        @values={{this.items}}
        @onReorder={{this.setItems}}
        @axis="y"
        as |group|
      >
        {{#each this.items as |track|}}
          <ReorderItem
            class={{if (isOn track.id this.playing) "track is-on" "track"}}
            @group={{group}}
            @value={{track}}
            @transition={{tuneObject "reorder" snap "ReorderItem transition 1"}}
            @whileDrag={{tuneObject
              "reorder"
              whileDrag
              "ReorderItem whileDrag 2"
            }}
            {{! a custom property, through the modifier — Motion owns a motion
                element's inline style, so a bound style= attribute here would
                be wiped by the next transform it writes }}
            @style={{(trackStyle track.hue)}}
          >
            <span class="grip" aria-hidden="true"></span>
            <span class="track-hue" aria-hidden="true"></span>
            <span class="track-copy">
              <strong>{{track.title}}</strong>
              <small>{{track.artist}}</small>
            </span>
            <em>{{track.time}}</em>
          </ReorderItem>
        {{/each}}
      </ReorderGroup>
    </div>
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
