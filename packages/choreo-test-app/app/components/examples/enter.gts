import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion, Presence } from 'glimmer-motion';

const keyOf = (item: { id: string }) => item.id;

const notes = [
  {
    app: 'Forge',
    body: 'main · 12 files · 1m 08s',
    id: 'ship',
    title: 'Build 1842 passed',
  },
  {
    app: 'Layout',
    body: 'Shared header snapped in 16ms',
    id: 'layout',
    title: 'Projection settled',
  },
] as const;

const initial = { opacity: 0, scale: 0.55, y: 56 };
const animate = { opacity: 1, scale: 1, y: 0 };
const exit = { opacity: 0, scale: 0.9, y: -20 };
const transition = {
  opacity: { duration: 0.16 },
  scale: { bounce: 0.48, type: 'spring', visualDuration: 0.42 },
  y: { bounce: 0.38, type: 'spring', visualDuration: 0.42 },
} as const;

export class Enter extends Component {
  @tracked generation = 0;

  get items() {
    return notes.map((note) => ({
      ...note,
      id: `${note.id}-${this.generation}`,
    }));
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
      <div class="banners">
        <Presence
          @items={{this.items}}
          @key={{keyOf}}
          @mode="popLayout"
          as |note h|
        >
          <article
            class="banner"
            {{motion
              presence=h
              initial=initial
              animate=animate
              exit=exit
              transition=(bannerTransition note.id)
            }}
          >
            <span class="banner-mark" aria-hidden="true"></span>
            <div class="banner-copy">
              <span class="banner-app">{{note.app}}<em>now</em></span>
              <strong>{{note.title}}</strong>
              <small>{{note.body}}</small>
            </div>
          </article>
        </Presence>
      </div>
    </div>
  </template>
}

function bannerTransition(id: string) {
  const late = id.startsWith('layout');
  return {
    ...transition,
    delay: late ? 0.1 : 0,
  };
}
