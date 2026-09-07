import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion, Presence } from 'glimmer-motion';
import { tuneMotion } from 'test-app/lib/demo-tuning';

const path = ['Kiln', 'Floor', 'Atlas', 'Night'] as const;

const keyOf = (item: { id: string }) => item.id;
const initial = { opacity: 0, x: -12 };
const animate = { opacity: 1, x: 0 };
// out the way it came in: a popped crumb retreats to the left, back down the
// path, rather than drifting off the end of it
const exit = { opacity: 0, scale: 0.92, x: -14 };
const spring = { bounce: 0.16, type: 'spring', visualDuration: 0.32 } as const;

type Step = { id: string; label: string; tip: boolean };

export class Trail extends Component {
  @tracked depth = 2;

  get items(): Step[] {
    return path.slice(0, this.depth).map((label, index) => ({
      id: label,
      label,
      tip: index === this.depth - 1,
    }));
  }

  push = () => {
    if (this.depth < path.length) {
      this.depth += 1;
    }
  };

  popTo = (index: number) => {
    this.depth = index + 1;
  };

  <template>
    <div class="ex">
      <button
        type="button"
        class={{if (atEnd this.depth) "replay is-off" "replay"}}
        {{on "click" this.push}}
      >Push</button>
      <nav class="trail" aria-label="Path">
        <Presence
          @items={{this.items}}
          @key={{keyOf}}
          @mode="popLayout"
          @initial={{false}}
          as |step h|
        >
          <span
            class="crumb"
            {{motion
              presence=h
              layout=true
              initial=initial
              animate=animate
              exit=exit
              transition=(tuneMotion "trail" spring "spring")
            }}
          >
            {{#if (hasSep step.id)}}
              <span class="crumb-sep" aria-hidden="true">›</span>
            {{/if}}
            <button
              type="button"
              class={{if step.tip "crumb-btn is-tip" "crumb-btn"}}
              disabled={{step.tip}}
              {{on "click" (fn this.popTo (indexOf step.id))}}
            >{{step.label}}</button>
          </span>
        </Presence>
      </nav>
      <p class="trail-hint">Click a crumb to pop back.</p>
    </div>
  </template>
}

function atEnd(depth: number) {
  return depth >= path.length;
}

function hasSep(id: string) {
  return id !== path[0];
}

function indexOf(id: string) {
  return path.indexOf(id as (typeof path)[number]);
}
