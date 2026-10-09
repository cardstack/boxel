import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion, Presence } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneMotion } from '../lib/tuning';
import TrailNotes from '../notes/trail';

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
    <div class='ex'>
      <button
        type='button'
        class={{if (atEnd this.depth) 'replay is-off' 'replay'}}
        {{on 'click' this.push}}
      >Push</button>
      <nav class='trail' aria-label='Path'>
        <Presence
          @items={{this.items}}
          @key={{keyOf}}
          @mode='popLayout'
          @initial={{false}}
          as |step h|
        >
          <span
            class='crumb'
            {{motion
              presence=h
              layout=true
              initial=initial
              animate=animate
              exit=exit
              transition=(tuneMotion 'trail' spring 'spring')
            }}
          >
            {{#if (hasSep step.id)}}
              <span class='crumb-sep' aria-hidden='true'>›</span>
            {{/if}}
            <button
              type='button'
              class={{if step.tip 'crumb-btn is-tip' 'crumb-btn'}}
              disabled={{step.tip}}
              {{on 'click' (fn this.popTo (indexOf step.id))}}
            >{{step.label}}</button>
          </span>
        </Presence>
      </nav>
      <p class='trail-hint'>Click a crumb to pop back.</p>
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
           The block padding matters as much as the inline: on a stage tall
           enough to fill the platter, content flush against the top and bottom
           of the recess reads as overflowed rather than placed. */
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

      .replay.is-off {
        opacity: 0.35;
        pointer-events: none;
      }

      .trail {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0;
        width: min(88%, 320px);
        min-height: 48px;
        padding: 8px 12px;
        border: 1px solid var(--line-strong);
        border-radius: 16px;
        background: var(--bg-spot);
      }

      .crumb {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .crumb-sep {
        color: var(--ink-faint);
        font-size: 14px;
      }

      .crumb-btn {
        border: 0;
        padding: 4px 2px;
        background: transparent;
        color: var(--ember-hot);
        font-family: var(--font-display);
        font-size: 1.05rem;
        letter-spacing: -0.03em;
      }

      .crumb-btn.is-tip {
        color: var(--ink);
        pointer-events: none;
      }

      .trail-hint {
        position: absolute;
        bottom: 18px;
        margin: 0;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      @container (max-width: 420px) {
        .trail {
          width: min(92%, 100%);
          max-width: 100%;
        }
      }

      /* ---- dark: the surfaces the light-mode sweep flattened ----
       *
       * Adding light mode introduced --bg-well (#070605) and pointed a lot of demo
       * surfaces at it. It is darker than --bg itself, and darker than every literal
       * it replaced (#0a0908, #100e0c, #0d0b0a, #16130f …), so demos that used to sit
       * a shade ABOVE the page became holes cut into it — and neighbouring tones that
       * were deliberately different (.sub-tile vs .sub-tile.is-on) collapsed onto one
       * value.
       *
       * These restore each surface's own pre-light-mode tone, for dark only. The
       * tokenised rule above stays as written and is what light mode uses, so this
       * block cannot affect it: `:not([data-theme='light'])` matches dark and the
       * unstamped default, never light.
       */

      .choreo-site:not([data-theme='light']) .trail {
        background: #2e2925;
      }
    </style>
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

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('trail', spring, 'spring');

export class TrailDemo extends GalleryDemo {
  static stage = Trail;
  static notes = TrailNotes;
}
