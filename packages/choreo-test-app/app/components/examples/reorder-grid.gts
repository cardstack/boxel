import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { ReorderGroup, ReorderItem } from 'glimmer-motion';
import { tuneObject } from 'test-app/lib/demo-tuning';
import { preventSelect } from 'test-app/lib/pointer';

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
    <div class="ex no-select" {{on "selectstart" preventSelect}}>
      <button
        type="button"
        class="replay"
        data-tour-reorder
        {{on "click" this.cycle}}
      >Move first to last</button>
      <ReorderGroup
        class="covers"
        @values={{this.items}}
        @onReorder={{this.setItems}}
        @axis="xy"
        as |group|
      >
        {{#each this.items as |album|}}
          <ReorderItem
            class="cover"
            @group={{group}}
            @value={{album}}
            @style={{tileStyle album.wash}}
            @transition={{tuneObject "grid" snap "ReorderItem transition 1"}}
            @whileDrag={{tuneObject "grid" whileDrag "ReorderItem whileDrag 2"}}
          >
            <b>{{album.label}}</b>
            <small>{{album.year}}</small>
          </ReorderItem>
        {{/each}}
      </ReorderGroup>
    </div>
  </template>
}

function tileStyle(wash: string) {
  return { background: wash };
}

// Declare the demo variables before the first interactive Choreo pass.
tuneObject('grid', snap, 'ReorderItem transition 1');
tuneObject('grid', whileDrag, 'ReorderItem whileDrag 2');
