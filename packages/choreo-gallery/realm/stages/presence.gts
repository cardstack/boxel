import type { TOC } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { LayoutGroup, motion, Presence } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneMotion } from '../lib/tuning';
import PresenceNotes from '../notes/presence';

const keyOf = (item: { id: string }) => item.id;

const notices = [
  {
    detail: 'main · 12 files',
    id: 'pass',
    title: 'Build passed',
    tone: 'pass',
  },
  { detail: '3 assertions', id: 'fail', title: 'Tests failed', tone: 'fail' },
] as const;

const initial = { opacity: 0, y: 14 };
const animate = { opacity: 1, y: 0 };
/**
 * The leaver's exit is short on purpose, and shorter than it looks like it
 * needs to be.
 *
 * `Presence` unmounts a leaver when its exit finishes — the LONGEST of the
 * properties in it. With `y` on a 0.4s spring and opacity on a 0.28s tween,
 * the notice went fully invisible and then went on holding its slot in flow
 * for the rest of the spring. In `sync` that gap is not free: the newcomer is
 * laid out below it, so what you saw was the whole column shoved down by the
 * height of something that was no longer there, and shoved back when it
 * finally unmounted.
 *
 * Stacking IS sync — the newcomer belongs below a leaver that is still in
 * flow, and that is the entire difference between this mode and popLayout.
 * The invisible half of it was not. So `y` now lands with the fade.
 */
const exit = { opacity: 0, y: -18 };
const transition = {
  opacity: { duration: 0.24 },
  y: { bounce: 0.1, type: 'spring', visualDuration: 0.26 },
} as const;
const restMove = {
  bounce: 0.12,
  type: 'spring',
  visualDuration: 0.28,
} as const;

const modes = [
  { hint: 'Both at once', id: 'sync' },
  { hint: 'Exit first', id: 'wait' },
  { hint: 'Space collapses', id: 'popLayout' },
] as const;

type Mode = (typeof modes)[number]['id'];
type Notice = (typeof notices)[number];

export class PresenceModes extends Component {
  @tracked index = 0;

  get items(): Notice[] {
    return [notices[this.index]!];
  }

  swap = () => {
    this.index = this.index === 0 ? 1 : 0;
  };

  <template>
    <div class='ex'>
      <button
        type='button'
        class='replay'
        {{on 'click' this.swap}}
      >Switch</button>
      <div class='modes'>
        {{#each modes as |mode|}}
          <ModeColumn
            @mode={{mode.id}}
            @hint={{mode.hint}}
            @items={{this.items}}
          />
        {{/each}}
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

      /* Sized in CONTAINER units, not a pixel cap.
       *
       * `.ex` is a size container and most of the gallery scales with it, but this
       * grid was min(94%, 620px) — so it filled 91% of a gallery tile and only 53%
       * of the full-width stage. The Magic Move between the two stretches both
       * snapshots into one box and crosses them, and two copies of the same three
       * panels at wildly different fractions is exactly the doubled, almost-aligned
       * ghosting you see mid-flight. Holding one fraction at both sizes is what
       * makes the crossfade land on itself. cqh keeps it from going absurdly wide
       * on a short, wide stage. */
      .modes {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: clamp(8px, 2cqw, 18px);
        width: min(92cqw, 260cqh);
      }
      @container (max-width: 560px) {
        .modes {
          gap: 8px;
          width: 96%;
        }
      }

      @container (max-width: 420px) {
        .modes {
          width: min(94%, 100%);
          gap: 6px;
        }
      }

      @container (max-width: 280px) {
        .modes {
          gap: 4px;
        }
      }

      @media (max-width: 720px) {
        .modes {
          width: min(94%, 100%);
          gap: 6px;
        }
      }
    </style>
  </template>
}

const ModeColumn = <template>
  <div class='mode'>
    <LayoutGroup>
      <div class='mode-slot'>
        <Presence
          @items={{@items}}
          @key={{keyOf}}
          @mode={{@mode}}
          @initial={{false}}
          as |notice h|
        >
          {{! layout=true matters most in `sync`. There, the leaver stays in
              flow for its whole exit, so the newcomer is laid out BELOW it and
              then has to get to the top once the leaver goes — without this it
              snaps that whole distance in a single frame. With it, the rise is
              animated, which is also what makes the three modes legible side
              by side: sync travels, wait does not move at all, and popLayout
              is already home because its leaver left flow immediately. }}
          <article
            class={{if (isFail notice) 'toast is-fail' 'toast is-pass'}}
            {{motion
              presence=h
              layout=true
              initial=initial
              animate=animate
              exit=exit
              transition=(tuneMotion 'presence' transition 'transition')
            }}
          >
            <span class='toast-mark' aria-hidden='true'></span>
            <span class='toast-copy'>
              <b>{{notice.title}}</b>
              <span>{{notice.detail}}</span>
            </span>
          </article>
        </Presence>
        <div
          class='mode-rest'
          {{motion
            layout=true
            transition=(tuneMotion 'presence' restMove 'restMove')
          }}
        >
          Up next
        </div>
      </div>
    </LayoutGroup>
    <span class='mode-name'>{{@mode}}</span>
    <span class='mode-hint'>{{@hint}}</span>
  </div>
  <style scoped>
    .mode {
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: stretch;
    }

    .mode-slot {
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      gap: 8px;
      /* Fixed, not min-height. `sync` briefly holds BOTH notices in flow and grows
         to ~192px while the other two stay at ~123px — so the three frames would
         shift against each other and you could not tell which difference was the
         mode and which was the reflow. The frame is frozen at the tallest case;
         what still moves inside it is exactly the thing being demonstrated. */
      height: 196px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: linear-gradient(180deg, var(--bg-spot), var(--bg-well));
      overflow: visible;
    }

    .toast {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px;
      border-radius: 16px;
      background: var(--bg-spot);
      border: 1px solid var(--line-strong);
      box-shadow: 0 14px 30px
        rgba(var(--shadow-rgb), calc(0.45 * var(--shadow-a)));
    }

    .toast.is-fail {
      background: color-mix(in srgb, var(--steel) 14%, var(--bg-spot));
      border-color: rgba(139, 150, 156, 0.28);
    }

    .toast.is-fail .toast-mark {
      background:
        radial-gradient(circle at 30% 25%, #fff4, transparent 42%),
        linear-gradient(160deg, var(--steel), var(--bg-spot));
      box-shadow: none;
    }

    .mode-rest {
      /* Pinned to the floor of the slot, which is a fixed height already.
         It used to sit immediately under the notices, so `sync` — the one mode
         that briefly holds TWO — swung it 63px down and 63px back on every
         switch. That excursion was the mode's layout being honest, and it read
         as the panel lurching. Reserving the space instead means the only thing
         that moves is the notice, which is the thing the mode is about: the
         newcomer still enters BELOW the leaver and still rises as it unmounts. */
      margin-top: auto;
      padding: 8px 12px;
      border-radius: 12px;
      background: var(--bg-spot);
      border: 1px dashed var(--line);
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ink-faint);
    }

    .toast-mark {
      /* scaled with the stage like the type: at a gallery card's width the mark is
         the one thing competing with the title for room, and the colour reads just
         as well small */
      width: clamp(10px, 3.4cqw, 28px);
      height: clamp(10px, 3.4cqw, 28px);
      border-radius: clamp(3px, 1cqw, 8px);
      background:
        radial-gradient(circle at 30% 25%, #fff6, transparent 42%),
        linear-gradient(160deg, var(--ember-hot), var(--ember));
      box-shadow: 0 0 12px var(--glow);
      flex: none;
    }

    /* The stage is a container (`.ex` sets container-type), so the type tracks the
       width it actually has rather than stepping at a breakpoint. Three columns in
       a gallery card are ~80px wide and the same three on the demo page are ~200px;
       one fixed size cannot serve both, and a title that overflows a fixed-height
       frame spills over whatever is beneath it. */
    .toast-copy b {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-size: clamp(10px, calc(6px + 1.6cqw), 13px);
      line-height: 1.25;
      letter-spacing: -0.02em;
    }

    .toast-copy span {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      color: var(--ink-dim);
      font-size: clamp(9px, calc(5px + 1.2cqw), 11px);
      line-height: 1.35;
    }

    .mode-name {
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--ink-dim);
      text-align: center;
    }

    .mode-hint {
      margin-top: -6px;
      font-size: 11px;
      color: var(--ink-faint);
      text-align: center;
    }
    @container (max-width: 560px) {
      .mode-slot {
        /* recomputed for the compact toast: sync still has to hold two of them
           plus 'Up next' without the frame changing size */
        height: 132px;
        padding: 8px;
        border-radius: 14px;
        gap: 6px;
      }

      .toast {
        padding: 7px 8px;
        border-radius: 11px;
        gap: 6px;
      }

      /* the detail line is the one thing that carries nothing the mode comparison
         needs, so it is what goes */
      .toast-copy span,
      .mode-hint {
        display: none;
      }

      /* the title may wrap to the two lines the slot was measured for; the clamp
         on the base rule is what stops a third line spilling out of the frame */
      .toast-copy {
        min-width: 0;
      }

      .mode-rest {
        padding: 6px 8px;
        font-size: 9px;
        letter-spacing: 0.06em;
      }

      .mode-name {
        font-size: 9px;
        letter-spacing: 0.08em;
      }
    }

    @container (max-width: 420px) {
      .mode-slot {
        padding: 8px;
        gap: 6px;
      }

      .mode-name {
        letter-spacing: 0.04em;
        font-size: 9px;
      }

      .mode-hint {
        display: none;
      }

      .toast {
        padding: 8px;
        gap: 8px;
      }

      .toast-copy span {
        display: none;
      }
    }

    @container (max-width: 280px) {
      .toast-mark {
        display: none;
      }
    }

    .choreo-site:not([data-theme='light']) .mode-slot {
      background: linear-gradient(180deg, #2e2925, #221e1a);
    }

    .choreo-site:not([data-theme='light']) .toast {
      background: #403830;
    }

    .choreo-site:not([data-theme='light']) .toast.is-fail {
      background: #2e3134;
    }

    .choreo-site:not([data-theme='light']) .toast.is-fail .toast-mark {
      background:
        radial-gradient(circle at 30% 25%, #fff4, transparent 42%),
        linear-gradient(160deg, #8b969c, #3a322c);
    }

    .choreo-site:not([data-theme='light']) .mode-rest {
      background: #312c27;
    }
  </style>
</template> satisfies TOC<{
  Args: { hint: string; items: Notice[]; mode: Mode };
}>;

function isFail(notice: Notice) {
  return notice.tone === 'fail';
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('presence', transition, 'transition');
tuneMotion('presence', restMove, 'restMove');

export class PresenceModesDemo extends GalleryDemo {
  static stage = PresenceModes;
  static notes = PresenceNotes;
}
