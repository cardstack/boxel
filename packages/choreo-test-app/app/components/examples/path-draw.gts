import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion, Presence } from 'glimmer-motion';
import { tuneMotion } from 'test-app/lib/demo-tuning';

const keyOf = (item: { id: string }) => item.id;
const draw = { opacity: 1, pathLength: 1 };
const hide = { opacity: 0 };
const sparkIn = { opacity: 1, pathLength: 0 };
const ringIn = { opacity: 0.7, pathLength: 0 };
const spark = { duration: 0.62, ease: [0.22, 1, 0.36, 1] } as const;
const ring = { delay: 0.06, duration: 0.72, ease: [0.22, 1, 0.36, 1] } as const;
const sparkPath =
  'M50 10C53 32 60 40 82 42C60 46 55 58 58 84C50 62 38 54 14 52C38 46 46 32 50 10Z';

export class PathDraw extends Component {
  @tracked generation = 0;

  get items() {
    return [{ id: `path-${this.generation}` }];
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
      <Presence @items={{this.items}} @key={{keyOf}} @mode="wait" as |_item h|>
        <svg class="spark-svg" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient id="spark-stroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#ffb36a" />
              <stop offset="100%" stop-color="#ff3b1f" />
            </linearGradient>
          </defs>
          <circle
            cx="50"
            cy="50"
            r="38"
            {{motion
              presence=h
              initial=ringIn
              animate=draw
              exit=hide
              transition=(tuneMotion "path" ring "ring")
            }}
          />
          <path
            d={{sparkPath}}
            {{motion
              presence=h
              initial=sparkIn
              animate=draw
              exit=hide
              transition=(tuneMotion "path" spark "spark")
            }}
          />
        </svg>
      </Presence>
    </div>
  </template>
}
