import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion, Presence } from 'glimmer-motion';
import type { Variants } from 'motion-dom';
import { tuneVariants } from 'test-app/lib/demo-tuning';

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
    <div class="ex">
      <button
        type="button"
        class="replay"
        {{on "click" this.replay}}
      >Replay</button>
      <Presence @items={{this.items}} @key={{keyOf}} @mode="wait" as |_dock h|>
        <div
          class="apps"
          {{motion
            presence=h
            variants=(tuneVariants "stagger" grid "grid")
            initial="hidden"
            animate="show"
          }}
        >
          {{#each apps as |app|}}
            <div
              class="app-tile"
              {{motion variants=(tuneVariants "stagger" tile "tile")}}
            >
              <span class="app-icon" style={{iconWash app.hue}}></span>
              <small>{{app.name}}</small>
            </div>
          {{/each}}
        </div>
      </Presence>
    </div>
  </template>
}

function iconWash(hue: string) {
  return htmlSafe(
    `background: radial-gradient(circle at 32% 28%, #fff7, transparent 36%), linear-gradient(160deg, ${hue}, #1a100c)`
  );
}

// Declare the demo variables before the first interactive Choreo pass.
tuneVariants('stagger', grid, 'grid');
tuneVariants('stagger', tile, 'tile');
