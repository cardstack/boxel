import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { LayoutGroup, motion } from 'glimmer-motion';
import { tuneMotion } from 'test-app/lib/demo-tuning';

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
      <div class="ex">
        <div class="curve-row">
          {{#each names as |name|}}
            <button
              type="button"
              class={{if (isOn name this.curve) "chip is-on" "chip"}}
              {{on "click" (fn this.pick name)}}
            >{{name}}</button>
          {{/each}}
        </div>
        <button type="button" class="replay" {{on "click" this.toggle}}>
          {{if this.grid "List" "Grid"}}
        </button>
        <div class={{if this.grid "shelf is-grid" "shelf is-list"}}>
          {{#each records as |record|}}
            <div
              class="record"
              {{motion
                layout=true
                transition=(tuneMotion "layout" this.transition "transition")
              }}
            >
              <div
                class="record-art"
                {{motion
                  layout=true
                  style=(artStyle record.wash)
                  transition=(tuneMotion "layout" this.transition "transition")
                }}
              ></div>
              <div
                class="record-meta"
                {{motion
                  layout="position"
                  transition=(tuneMotion "layout" this.transition "transition")
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
  </template>
}

function isOn(name: Curve, curve: Curve) {
  return name === curve;
}

function artStyle(wash: string) {
  return { background: wash };
}
