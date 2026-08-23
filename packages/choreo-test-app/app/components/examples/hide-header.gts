import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion, scrollProgress } from 'glimmer-motion';

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

export class HideHeader extends Component {
  scroll = scrollProgress();
  @tracked hidden = false;
  #last = 0;
  #travel = 0;

  // fades as it goes, so the bar reads as leaving rather than as being clipped
  // by the frame it slides behind
  get header() {
    return { opacity: this.hidden ? 0 : 1, y: this.hidden ? -72 : 0 };
  }

  follow = (y: number) => {
    this.#travel += y - this.#last;
    this.#last = y;
    if (y <= 8) {
      this.hidden = false;
      this.#travel = 0;
      return;
    }
    if (this.#travel > 8) {
      this.hidden = true;
      this.#travel = 0;
    } else if (this.#travel < -8) {
      this.hidden = false;
      this.#travel = 0;
    }
  };

  watch = modifier((element: HTMLElement) => {
    const onScroll = () => {
      this.follow(element.scrollTop);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    const unsubscribe = this.scroll.scrollY.on('change', this.follow);
    return () => {
      element.removeEventListener('scroll', onScroll);
      unsubscribe();
    };
  });

  <template>
    <div class="ex">
      <div class="chat-app">
        <header class="chat-bar" {{motion style=this.header transition=tween}}>
          <span class="chat-back" aria-hidden="true"></span>
          <span class="chat-face">
            <span class="chat-avatar">RT</span>
            <span class="chat-pip"></span>
          </span>
          <span class="chat-who">
            <strong>Runtime</strong>
            <em>online</em>
          </span>
          <span class="chat-actions" aria-hidden="true">
            <span class="chat-icon">
              <svg viewBox="0 0 24 24"><path
                  d="M15 8.5v7c0 .8-.7 1.4-1.5 1.3l-4.2-.7c-.5-.1-.8-.5-.8-1V9c0-.5.3-.9.8-1l4.2-.7c.8-.1 1.5.5 1.5 1.2zM16.2 9.2c1.7.8 1.7 4.8 0 5.6"
                /></svg>
            </span>
            <span class="chat-icon">
              <svg viewBox="0 0 24 24"><path
                  d="M7.2 5.8c3.6-.4 6 .4 8.2 2.6 2.2 2.2 3 4.6 2.6 8.2l-2.2-.3c.2-2.6-.3-4.3-2-6s-3.4-2.2-6-2l-.6-2.5zM6 13a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"
                /></svg>
            </span>
          </span>
        </header>
        <div class="chat-scroll" {{this.scroll.container}} {{this.watch}}>
          <div class="thread">
            {{#each thread as |line|}}
              {{#if (isDay line)}}
                <p class="chat-day">{{line.label}}</p>
              {{else if (isClip line)}}
                <article class="clip">
                  <span class="clip-plate"></span>
                  <span class="clip-copy">
                    <b>{{line.title}}</b>
                    <small>{{line.meta}}</small>
                  </span>
                </article>
              {{else}}
                <p class={{if (isMe line) "bubble is-me" "bubble"}}>
                  {{line.text}}
                  {{#if (stamp line)}}
                    <small>{{stamp line}}</small>
                  {{/if}}
                </p>
              {{/if}}
            {{/each}}
          </div>
        </div>
        <footer class="composer">
          <span class="composer-add" aria-hidden="true"></span>
          <span class="composer-field">Message</span>
          <span class="composer-send" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path
                d="M12 4 19 14h-4.2v6H9.2v-6H5L12 4z"
              /></svg>
          </span>
        </footer>
      </div>
    </div>
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
