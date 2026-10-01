import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion, Presence } from 'glimmer-motion';
import { tuneMotion } from 'test-app/lib/demo-tuning';

const keyOf = (item: { id: string }) => item.id;

/**
 * Two notices, a beat apart.
 *
 * Deliberately from the same world as the rest of the gallery — the kiln
 * floor of the Sheet demo, the names in Beacons — rather than another build
 * log. Presence already runs "Build passed" a few cards away, and two demos
 * showing the same notification teaches the reader that the CONTENT is the
 * point when the arrival is. Concrete copy also gives the eye somewhere to
 * land while the spring settles: a number that changes, a name it knows.
 */
const notes = [
  {
    app: 'Kiln',
    body: 'Shift C · 18 entries · 4m 12s',
    id: 'pour',
    late: false,
    title: 'Pour 42 complete',
  },
  {
    app: 'Studio',
    body: 'Halo — three new swatches',
    id: 'glaze',
    late: true,
    title: 'Marlow shared a glaze',
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
              transition=(tuneMotion
                "enter"
                (bannerTransition note.late)
                "bannerTransition note.late"
              )
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

/* the second notice trails the first, so they arrive as a pair rather than a
   block. Read off the note itself now — it used to sniff the id for the
   prefix "layout", which quietly tied the timing to the copy. */
function bannerTransition(late: boolean) {
  return {
    ...transition,
    delay: late ? 0.1 : 0,
  };
}
