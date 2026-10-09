import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion, Presence } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneMotion } from '../lib/tuning';

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
    <div class='ex'>
      <button
        type='button'
        class='replay'
        {{on 'click' this.replay}}
      >Replay</button>
      <div class='banners'>
        <Presence
          @items={{this.items}}
          @key={{keyOf}}
          @mode='popLayout'
          as |note h|
        >
          <article
            class='banner'
            {{motion
              presence=h
              initial=initial
              animate=animate
              exit=exit
              transition=(tuneMotion
                'enter'
                (bannerTransition note.late)
                'bannerTransition note.late'
              )
            }}
          >
            <span class='banner-mark' aria-hidden='true'></span>
            <div class='banner-copy'>
              <span class='banner-app'>{{note.app}}<em>now</em></span>
              <strong>{{note.title}}</strong>
              <small>{{note.body}}</small>
            </div>
          </article>
        </Presence>
      </div>
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

      .banners {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: min(88%, 320px);
      }

      .banner {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        border-radius: 20px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 50%),
          var(--bg-spot);
        border: 1px solid var(--line-strong);
        box-shadow:
          0 18px 40px rgba(0, 0, 0, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.06);
      }

      .banner-mark {
        width: 44px;
        height: 44px;
        border-radius: 13px;
        background:
          radial-gradient(circle at 30% 25%, #fff7, transparent 40%),
          linear-gradient(160deg, var(--ember-hot), #9a1608);
        box-shadow: 0 8px 20px var(--glow);
        flex: none;
      }

      .banner-copy {
        display: grid;
        gap: 2px;
        min-width: 0;
      }

      .banner-app {
        display: flex;
        justify-content: space-between;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .banner-app em {
        font-style: normal;
        color: var(--ember-hot);
      }

      .banner strong {
        font-family: var(--font-display);
        font-weight: 700;
        letter-spacing: -0.03em;
      }

      .banner small {
        color: var(--ink-dim);
        font-size: 12px;
      }

      @container (max-width: 420px) {
        .banners {
          width: min(92%, 100%);
          max-width: 100%;
        }
      }

      .choreo-site:not([data-theme='light']) .banner {
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 50%),
          #3a342e;
      }
    </style>
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

export class EnterDemo extends GalleryDemo {
  static stage = Enter;
}
