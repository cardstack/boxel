import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion, scrollProgress } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneMotion } from '../lib/tuning';

const tween = { duration: 0.24, ease: [0.22, 1, 0.36, 1] } as const;

const thread = [
  { kind: 'day', label: 'Today' },
  {
    from: 'them',
    kind: 'msg',
    text: 'Did the shared header snap after commit?',
    time: '9:41',
  },
  { from: 'me', kind: 'msg', text: 'Yes — 16ms. No jump.' },
  { from: 'them', kind: 'msg', text: 'Show me the exit freeze.' },
  {
    from: 'them',
    kind: 'msg',
    text: 'Last time it flashed the unstyled tree.',
  },
  { from: 'me', kind: 'msg', text: 'Held the last props. Clean handoff.' },
  {
    from: 'them',
    kind: 'clip',
    meta: '0:16 · layout',
    title: 'shared-header',
  },
  { from: 'them', kind: 'msg', text: 'Stagger from sibling order?' },
  { from: 'me', kind: 'msg', text: 'Index is layout, not the array.' },
  { from: 'them', kind: 'msg', text: 'Then we ship the binding tonight.' },
  { from: 'me', kind: 'msg', text: 'Already on main. Pull and run /header.' },
  { from: 'them', kind: 'msg', text: 'On it — scrolling the thread now.' },
  { from: 'me', kind: 'msg', text: 'Watch the bar. Direction, not distance.' },
  { from: 'them', kind: 'msg', text: 'Down hides it. Up brings it back.' },
  { from: 'me', kind: 'msg', text: 'Keep going — the composer stays.' },
  { from: 'them', kind: 'msg', text: 'Same scroll value. Sign is the switch.' },
  { from: 'me', kind: 'msg', text: 'Don’t wait for a threshold in pixels.' },
  { from: 'them', kind: 'msg', text: 'Flip the wheel. The bar should return.' },
] as const;

type Line = (typeof thread)[number];

/** how much sustained travel in one direction flips the bar */
const FLIP = 24;
/** near either end the bar holds still: that is where the rubber band lives */
const EDGE = 24;

export class HideHeader extends Component {
  scroll = scrollProgress();
  @tracked hidden = false;
  #last = 0;
  #travel = 0;
  #column?: HTMLElement;

  // fades as it goes, so the bar reads as leaving rather than as being clipped
  // by the frame it slides behind
  get header() {
    return { opacity: this.hidden ? 0 : 1, y: this.hidden ? -72 : 0 };
  }

  follow = (y: number) => {
    const el = this.#column;
    const max = el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0;
    // An overscroll is not a scroll. The rubber band reports positions outside
    // the range and then recoils back into it, and that recoil reads as a flick
    // in the opposite direction — which is how a hard flick to the top used to
    // end with the bar hidden. Clamp to the range that actually exists.
    const at = Math.min(Math.max(y, 0), max);
    const delta = at - this.#last;
    this.#last = at;
    if (at <= EDGE) {
      // at the top the bar is always shown, whatever the last delta said
      this.hidden = false;
      this.#travel = 0;
      return;
    }
    if (at >= max - EDGE) {
      // and at the bottom it holds, so the bounce cannot flip it either
      this.#travel = 0;
      return;
    }
    // direction, not distance: a reversal starts the count over rather than
    // paying down the travel already banked in the other direction
    if (delta > 0 !== this.#travel > 0) {
      this.#travel = 0;
    }
    this.#travel += delta;
    if (this.#travel > FLIP) {
      this.hidden = true;
      this.#travel = 0;
    } else if (this.#travel < -FLIP) {
      this.hidden = false;
      this.#travel = 0;
    }
  };

  watch = modifier((element: HTMLElement) => {
    this.#column = element;
    this.#last = element.scrollTop;
    const unsubscribe = this.scroll.scrollY.on('change', this.follow);
    return () => {
      unsubscribe();
      this.#column = undefined;
    };
  });

  <template>
    <div class='ex'>
      <div class='chat-app'>
        {{! animate, not style: a plain number handed to style is SET, not
            animated, and the transition beside it would never be consulted }}
        <header
          class='chat-bar'
          {{motion
            animate=this.header
            transition=(tuneMotion 'header' tween 'tween')
          }}
        >
          <span class='chat-back' aria-hidden='true'></span>
          <span class='chat-face'>
            <span class='chat-avatar'>RT</span>
            <span class='chat-pip'></span>
          </span>
          <span class='chat-who'>
            <strong>Runtime</strong>
            <em>online</em>
          </span>
          <span class='chat-actions' aria-hidden='true'>
            <span class='chat-icon'>
              <svg viewBox='0 0 24 24'><path
                  d='M15 8.5v7c0 .8-.7 1.4-1.5 1.3l-4.2-.7c-.5-.1-.8-.5-.8-1V9c0-.5.3-.9.8-1l4.2-.7c.8-.1 1.5.5 1.5 1.2zM16.2 9.2c1.7.8 1.7 4.8 0 5.6'
                /></svg>
            </span>
            <span class='chat-icon'>
              <svg viewBox='0 0 24 24'><path
                  d='M7.2 5.8c3.6-.4 6 .4 8.2 2.6 2.2 2.2 3 4.6 2.6 8.2l-2.2-.3c.2-2.6-.3-4.3-2-6s-3.4-2.2-6-2l-.6-2.5zM6 13a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'
                /></svg>
            </span>
          </span>
        </header>
        <div class='chat-scroll' {{this.scroll.container}} {{this.watch}}>
          <div class='thread'>
            {{#each thread as |line|}}
              {{#if (isDay line)}}
                <p class='chat-day'>{{line.label}}</p>
              {{else if (isClip line)}}
                <article class='clip'>
                  <span class='clip-plate'></span>
                  <span class='clip-copy'>
                    <b>{{line.title}}</b>
                    <small>{{line.meta}}</small>
                  </span>
                </article>
              {{else}}
                <p class={{if (isMe line) 'bubble is-me' 'bubble'}}>
                  {{line.text}}
                  {{#if (stamp line)}}
                    <small>{{stamp line}}</small>
                  {{/if}}
                </p>
              {{/if}}
            {{/each}}
          </div>
        </div>
        <footer class='composer'>
          <span class='composer-add' aria-hidden='true'></span>
          <span class='composer-field'>Message</span>
          <span class='composer-send' aria-hidden='true'>
            <svg viewBox='0 0 24 24'><path
                d='M12 4 19 14h-4.2v6H9.2v-6H5L12 4z'
              /></svg>
          </span>
        </footer>
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

      .chat-app {
        position: absolute;
        inset: 20px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-radius: 26px;
        background:
          radial-gradient(
            80% 50% at 50% 0%,
            rgba(255, 59, 31, 0.08),
            transparent 55%
          ),
          var(--bg-well);
        border: 1px solid var(--line-strong);
        box-shadow: 0 22px 50px
          rgba(var(--shadow-rgb), calc(0.4 * var(--shadow-a)));
      }

      .chat-scroll {
        position: relative;
        flex: 1;
        min-height: 0;
        overflow: auto;
        container-type: size;
      }

      .chat-bar {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 3;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 10px;
        height: 68px;
        padding: 0 12px;
        background: rgba(var(--bg-rgb), 0.82);
        /* its own corners, because the frame's cannot reach it: a backdrop-filter
           makes this its own containing block, and an ancestor's overflow:hidden
           stops clipping it — so the bar sat square inside a 26px radius. One less
           than the frame's, which is what the frame's 1px border leaves inside. */
        border-radius: 25px 25px 0 0;
        /* a blurred backdrop is re-composited on every frame of the slide; promoting
           the layer keeps the fade from stuttering against it */
        will-change: transform, opacity;
        backdrop-filter: blur(18px);
        border-bottom: 1px solid var(--line);
      }

      .chat-back {
        width: 18px;
        height: 18px;
        flex: none;
        border-left: 2px solid var(--ink);
        border-bottom: 2px solid var(--ink);
        transform: rotate(45deg);
        margin: 0 4px 0 6px;
        opacity: 0.85;
      }

      .chat-face {
        position: relative;
        flex: none;
      }

      .chat-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 11px;
        font-weight: 700;
        color: #140c0a;
        background:
          radial-gradient(circle at 30% 25%, #fff6, transparent 42%),
          linear-gradient(160deg, var(--ember-hot), var(--ember));
      }

      .chat-pip {
        position: absolute;
        right: -1px;
        bottom: -1px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #3dd68c;
        box-shadow: 0 0 0 2px var(--bg-spot);
      }

      .chat-who {
        display: grid;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }

      .chat-who strong {
        font-family: var(--font-display);
        letter-spacing: -0.03em;
        line-height: 1.1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .chat-who em {
        font-style: normal;
        font-size: 11px;
        color: #3dd68c;
      }

      .chat-actions {
        display: flex;
        gap: 8px;
        flex: none;
      }

      .chat-icon {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--bg-spot);
        border: 1px solid var(--line);
        display: grid;
        place-items: center;
      }

      .chat-icon svg {
        width: 15px;
        height: 15px;
        fill: var(--ink-dim);
      }

      .thread {
        display: flex;
        flex-direction: column;
        gap: 6px;
        box-sizing: border-box;
        min-height: calc(100cqh + 560px);
        padding: 80px 14px 20px;
      }

      .chat-day {
        align-self: center;
        margin: 6px 0 10px;
        padding: 4px 10px;
        border-radius: 999px;
        background: var(--bg-spot);
        border: 1px solid var(--line);
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .bubble {
        max-width: 78%;
        margin: 0;
        padding: 9px 12px;
        border-radius: 18px 18px 18px 6px;
        background: var(--bg-spot);
        border: 1px solid var(--line);
        font-size: 13.5px;
        line-height: 1.4;
      }

      .bubble small {
        display: block;
        margin-top: 4px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.06em;
        color: var(--ink-faint);
      }

      .bubble.is-me {
        align-self: flex-end;
        border-radius: 18px 18px 6px 18px;
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--ember) 20%, var(--bg-spot)),
          color-mix(in srgb, var(--ember) 10%, var(--bg-well))
        );
        border-color: rgba(255, 59, 31, 0.28);
      }

      .bubble.is-me small {
        color: rgba(var(--ink-rgb), 0.45);
        text-align: right;
      }

      .clip {
        display: flex;
        align-items: center;
        gap: 10px;
        width: min(78%, 220px);
        padding: 8px;
        border-radius: 16px;
        background: var(--bg-spot);
        border: 1px solid var(--line);
      }

      .clip-plate {
        width: 52px;
        height: 52px;
        border-radius: 12px;
        flex: none;
        background:
          radial-gradient(circle at 30% 25%, #fff5, transparent 36%),
          linear-gradient(160deg, #ffb36a, var(--ember));
      }

      .clip-copy {
        display: grid;
        gap: 2px;
        min-width: 0;
      }

      .clip-copy b {
        font-size: 13px;
        letter-spacing: -0.02em;
      }

      .clip-copy small {
        color: var(--ink-dim);
        font-size: 11px;
      }

      .composer {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: none;
        padding: 10px 12px 12px;
        background: rgba(var(--bg-rgb), 0.94);
        border-top: 1px solid var(--line);
      }

      .composer-add,
      .composer-send {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        flex: none;
        position: relative;
        background: var(--bg-spot);
        border: 1px solid var(--line);
      }

      .composer-add::before,
      .composer-add::after {
        content: '';
        position: absolute;
        background: var(--ink-dim);
      }

      .composer-add::before {
        width: 12px;
        height: 1.5px;
        left: 9px;
        top: 15px;
      }

      .composer-add::after {
        width: 1.5px;
        height: 12px;
        left: 15px;
        top: 10px;
      }

      .composer-field {
        flex: 1;
        height: 36px;
        border-radius: 999px;
        padding: 0 14px;
        display: flex;
        align-items: center;
        color: var(--ink-faint);
        background: var(--bg-well);
        border: 1px solid var(--line);
        font-size: 13px;
      }

      .composer-send {
        display: grid;
        place-items: center;
        background: var(--ember);
        border-color: transparent;
      }

      .composer-send svg {
        width: 14px;
        height: 14px;
        fill: #140c0a;
      }

      @container (max-width: 420px) {
        .chat-app {
          inset: 10px;
        }

        .chat-actions {
          display: none;
        }
      }

      @container (max-width: 280px) {
        .chat-back {
          display: none;
        }
      }

      .choreo-site:not([data-theme='light']) .chat-app {
        background:
          radial-gradient(
            80% 50% at 50% 0%,
            rgba(255, 59, 31, 0.08),
            transparent 55%
          ),
          #2a2521;
      }

      .choreo-site:not([data-theme='light']) .chat-pip {
        box-shadow: 0 0 0 2px #2a2521;
      }

      .choreo-site:not([data-theme='light']) .chat-icon {
        background: #3a342e;
      }

      .choreo-site:not([data-theme='light']) .chat-day {
        background: #322c27;
      }

      .choreo-site:not([data-theme='light']) .bubble {
        background: #3a342e;
      }

      .choreo-site:not([data-theme='light']) .bubble.is-me {
        background: linear-gradient(180deg, #4a241c, #2e1612);
      }

      .choreo-site:not([data-theme='light']) .clip {
        background: #3a342e;
      }

      .choreo-site:not([data-theme='light']) .composer-add,
      .choreo-site:not([data-theme='light']) .composer-send {
        background: #3a342e;
      }

      .choreo-site:not([data-theme='light']) .composer-field {
        background: #221e1a;
      }

      .choreo-site:not([data-theme='light']) .chat-bar {
        background: rgba(42, 37, 33, 0.82);
      }

      .choreo-site:not([data-theme='light']) .composer {
        background: rgba(42, 37, 33, 0.94);
      }
    </style>
  </template>
}

function isDay(line: Line): line is Extract<Line, { kind: 'day' }> {
  return line.kind === 'day';
}

function isClip(line: Line): line is Extract<Line, { kind: 'clip' }> {
  return line.kind === 'clip';
}

function isMe(line: Line) {
  return line.kind === 'msg' && line.from === 'me';
}

function stamp(line: Line) {
  return line.kind === 'msg' && 'time' in line ? line.time : undefined;
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('header', tween, 'tween');

export class HideHeaderDemo extends GalleryDemo {
  static stage = HideHeader;
}
