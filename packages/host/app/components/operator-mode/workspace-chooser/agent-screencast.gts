import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

type ChapterId = 'ask' | 'edit' | 'push';
type BeatKind = 'user' | 'agent' | 'tool';

interface Beat {
  chapter: ChapterId;
  kind: BeatKind;
  text: string;
  // A tool beat's detail, set apart on its chip ("+14 −2").
  detail?: string;
}

interface TimedBeat extends Beat {
  start: number;
  end: number;
}

// Typing speed for the request, and the beat each agent step takes to
// land; the loop holds its last frame before starting over.
const TYPE_MS = 38;
const SEND_PAUSE_MS = 600;
const STEP_MS = 900;
const HOLD_MS = 4500;
const TICK_MS = 50;

const CHAPTERS: { id: ChapterId; label: string }[] = [
  { id: 'ask', label: 'Ask' },
  { id: 'edit', label: 'Your agent edits' },
  { id: 'push', label: 'It lands in Boxel' },
];

const SCRIPT: Beat[] = [
  {
    chapter: 'ask',
    kind: 'user',
    text: 'Add a star rating to the Recipe card',
  },
  {
    chapter: 'ask',
    kind: 'agent',
    text: 'On it. I’ll add a rating field and show it on the card.',
  },
  { chapter: 'edit', kind: 'tool', text: 'Read recipe.gts' },
  {
    chapter: 'edit',
    kind: 'tool',
    text: 'Edited recipe.gts',
    detail: '+14 −2',
  },
  { chapter: 'edit', kind: 'tool', text: 'Checked the card', detail: '✓' },
  { chapter: 'push', kind: 'tool', text: 'Pushed to Boxel', detail: 'recipes' },
  {
    chapter: 'push',
    kind: 'agent',
    text: 'Done. Lemon Tart shows its rating in the side panel.',
  },
];

const TIMELINE: TimedBeat[] = (() => {
  let at = 0;
  return SCRIPT.map((beat) => {
    let duration =
      beat.kind === 'user'
        ? beat.text.length * TYPE_MS + SEND_PAUSE_MS
        : STEP_MS;
    let timed = { ...beat, start: at, end: at + duration };
    at += duration;
    return timed;
  });
})();

const TOTAL_MS = TIMELINE[TIMELINE.length - 1]?.end ?? 0;

// The side panel's card takes the change when the push lands.
const PUSHED_AT =
  TIMELINE.find((beat) => beat.text === 'Pushed to Boxel')?.start ?? TOTAL_MS;

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

// Plays only while the player is on screen, so the loop costs nothing
// while the page is scrolled elsewhere.
const whileVisible = modifier(
  (element: HTMLElement, [onChange]: [(visible: boolean) => void]) => {
    let observer = new IntersectionObserver((entries) => {
      onChange(entries.some((entry) => entry.isIntersecting));
    });
    observer.observe(element);
    return () => observer.disconnect();
  },
);

// A screencast of Boxel with a coding agent, drawn in the page rather than
// shipped as a video: a desktop agent app, the kind Claude and Codex both
// are, takes a request in its chat, edits the workspace's card and pushes
// it, while Boxel open in the app's side panel picks the change up. With
// reduced motion it holds the finished frame.
export default class AgentScreencast extends Component {
  @tracked private elapsed = 0;
  @tracked private playing = !prefersReducedMotion();
  @tracked private visible = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    if (!this.playing) {
      this.elapsed = TOTAL_MS;
    }
  }

  willDestroy() {
    super.willDestroy();
    this.stop();
  }

  // The request being typed sits in the composer; once sent, it and every
  // step after it show in the thread.
  private get typing() {
    let ask = TIMELINE[0];
    if (!ask || this.elapsed >= ask.end - SEND_PAUSE_MS) {
      return undefined;
    }
    let chars = Math.floor((this.elapsed - ask.start) / TYPE_MS);
    return ask.text.slice(0, Math.max(chars, 0));
  }

  private get thread() {
    let t = this.elapsed;
    return TIMELINE.filter((beat) =>
      beat.kind === 'user' ? t >= beat.end - SEND_PAUSE_MS : t >= beat.start,
    );
  }

  // The agent is at work between the request and its last reply.
  private get working() {
    let last = TIMELINE[TIMELINE.length - 1];
    return Boolean(
      TIMELINE[0] &&
      last &&
      this.elapsed >= TIMELINE[0].end &&
      this.elapsed < last.start,
    );
  }

  private get chapter(): ChapterId {
    let started = TIMELINE.filter((beat) => beat.start <= this.elapsed);
    return started[started.length - 1]?.chapter ?? 'ask';
  }

  private get cardUpdated() {
    return this.elapsed >= PUSHED_AT;
  }

  private start() {
    if (this.timer || !this.playing || !this.visible) {
      return;
    }
    this.timer = setInterval(() => {
      let next = this.elapsed + TICK_MS;
      this.elapsed = next > TOTAL_MS + HOLD_MS ? 0 : next;
    }, TICK_MS);
  }

  private stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  @action private setVisible(visible: boolean) {
    this.visible = visible;
    if (visible) {
      this.start();
    } else {
      this.stop();
    }
  }

  @action private togglePlay() {
    this.playing = !this.playing;
    if (this.playing) {
      if (this.elapsed >= TOTAL_MS) {
        this.elapsed = 0;
      }
      this.start();
    } else {
      this.stop();
    }
  }

  @action private jumpTo(chapter: ChapterId) {
    let first = TIMELINE.find((beat) => beat.chapter === chapter);
    this.elapsed = first?.start ?? 0;
  }

  <template>
    <figure
      class='screencast'
      aria-label='How Boxel works with your coding agent'
      {{whileVisible this.setVisible}}
      data-test-agent-screencast
    >
      <div class='window' aria-hidden='true'>
        {{! The agent app's own sidebar: its projects and chats. }}
        <div class='sidebar'>
          <span class='traffic'><i></i><i></i><i></i></span>
          <span class='side-label'>Projects</span>
          <span class='side-item is-active'>recipes</span>
          <span class='side-item'>studio</span>
          <span class='side-item'>newsroom</span>
        </div>

        <div class='chat'>
          <div class='chat-head'>recipes</div>
          <div class='thread'>
            {{#each this.thread as |beat|}}
              {{#if (eq beat.kind 'user')}}
                <span class='bubble'>{{beat.text}}</span>
              {{else if (eq beat.kind 'agent')}}
                <span class='reply'>{{beat.text}}</span>
              {{else}}
                <span class='tool'>
                  <i class='tool-dot'></i>
                  <span class='tool-text'>{{beat.text}}</span>
                  {{#if beat.detail}}
                    <span class='tool-detail'>{{beat.detail}}</span>
                  {{/if}}
                </span>
              {{/if}}
            {{/each}}
            {{#if this.working}}
              <span class='working'><i></i><i></i><i></i></span>
            {{/if}}
          </div>
          <div class='composer'>
            {{#if this.typing}}
              <span class='composer-text'>{{this.typing}}</span><i
                class='caret'
              ></i>
            {{else}}
              <span class='composer-hint'>Ask your agent…</span>
            {{/if}}
            <span class='send'>↑</span>
          </div>
        </div>

        {{! Boxel, open in the agent app's side panel. }}
        <div class='panel'>
          <div class='panel-head'>
            <span class='boxel-mark'></span>
            <span class='panel-title'>Boxel</span>
            <span class='panel-path'>recipes / Lemon Tart</span>
          </div>
          <div class='panel-body'>
            <div class='card'>
              <div class='card-head'>
                <span class='card-type'>Recipe</span>
                {{#if this.cardUpdated}}
                  <span class='synced'>Updated</span>
                {{/if}}
              </div>
              <div class='card-art'></div>
              <b class='card-title'>Lemon Tart</b>
              <span class='card-meta'>Serves 6 · 45 min · Dessert</span>
              {{#if this.cardUpdated}}
                <span class='rating' data-test-agent-screencast-rating>
                  <span class='stars'>★★★★★</span>
                  <span class='score'>4.8</span>
                </span>
              {{/if}}
              <span class='card-line'></span>
              <span class='card-line short'></span>
            </div>
          </div>
        </div>
      </div>
      <figcaption class='controls'>
        <button
          type='button'
          class='play'
          aria-label={{if this.playing 'Pause' 'Play'}}
          {{on 'click' this.togglePlay}}
          data-test-agent-screencast-play
        >{{if this.playing '❚❚' '▶'}}</button>
        <span class='chapters' role='group' aria-label='Chapters'>
          {{#each CHAPTERS as |chapter|}}
            <button
              type='button'
              class={{cn 'chapter'}}
              aria-pressed={{if (eq this.chapter chapter.id) 'true' 'false'}}
              {{on 'click' (fn this.jumpTo chapter.id)}}
            >{{chapter.label}}</button>
          {{/each}}
        </span>
      </figcaption>
    </figure>

    <style scoped>
      .screencast {
        --app-bg: color-mix(in oklch, var(--boxel-light) 3%, var(--boxel-dark));
        --app-line: color-mix(in oklch, var(--boxel-light) 10%, transparent);
        --app-muted: color-mix(in oklch, var(--boxel-light) 50%, transparent);
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .window {
        display: grid;
        grid-template-columns: 6.5rem minmax(0, 1.25fr) minmax(0, 1fr);
        /* Fills the height its row gives it (the steps beside it), and
           never less than room for the whole conversation. */
        flex: 1;
        min-height: 19rem;
        overflow: hidden;
        border: 1px solid var(--app-line);
        border-radius: 1rem;
        background-color: var(--app-bg);
        color: var(--boxel-light);
        font-size: 0.75rem;
        box-shadow: 0 1rem 2.5rem
          color-mix(in oklch, var(--boxel-dark) 45%, transparent);
      }

      /* The agent app's sidebar. */
      .sidebar {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-height: 0;
        padding: var(--boxel-sp-xs);
        border-right: 1px solid var(--app-line);
        background-color: color-mix(
          in oklch,
          var(--boxel-dark) 60%,
          transparent
        );
      }
      .traffic {
        display: flex;
        gap: 0.25rem;
        margin-bottom: var(--boxel-sp-xs);
      }
      .traffic i {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 22%,
          transparent
        );
      }
      .side-label {
        font-size: 0.625rem;
        color: var(--app-muted);
      }
      .side-item {
        overflow: hidden;
        padding: 0.25rem 0.375rem;
        border-radius: 0.375rem;
        color: var(--app-muted);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .side-item.is-active {
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 9%,
          transparent
        );
        color: var(--boxel-light);
      }

      /* The chat: the thread, then the composer. */
      .chat {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
      }
      .chat-head {
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-bottom: 1px solid var(--app-line);
        font-weight: 600;
      }
      /* New steps push old ones up, the way a chat scrolls. */
      .thread {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 0.375rem;
        min-height: 0;
        overflow: hidden;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
      .bubble {
        align-self: flex-end;
        max-width: 85%;
        padding: 0.375rem 0.625rem;
        border-radius: 0.75rem 0.75rem 0.25rem 0.75rem;
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 12%,
          transparent
        );
        animation: arrive 0.3s ease-out;
      }
      .reply {
        line-height: 1.4;
        animation: arrive 0.3s ease-out;
      }
      .tool {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        align-self: flex-start;
        max-width: 100%;
        padding: 0.25rem 0.5rem;
        border: 1px solid var(--app-line);
        border-radius: 0.5rem;
        color: var(--app-muted);
        animation: arrive 0.3s ease-out;
      }
      .tool-dot {
        flex: none;
        width: 0.375rem;
        height: 0.375rem;
        border-radius: 50%;
        background-color: var(--boxel-highlight);
      }
      .tool-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tool-detail {
        flex: none;
        font-family: var(--boxel-monospace-font-family);
        color: var(--boxel-highlight);
      }
      .working {
        display: flex;
        gap: 0.2rem;
        padding: 0.25rem 0;
      }
      .working i {
        width: 0.3rem;
        height: 0.3rem;
        border-radius: 50%;
        background-color: var(--app-muted);
        animation: pulse 1s ease-in-out infinite;
      }
      .working i:nth-child(2) {
        animation-delay: 0.15s;
      }
      .working i:nth-child(3) {
        animation-delay: 0.3s;
      }
      .composer {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin: 0 var(--boxel-sp-xs) var(--boxel-sp-xs);
        padding: 0.375rem 0.375rem 0.375rem 0.625rem;
        border: 1px solid var(--app-line);
        border-radius: 0.75rem;
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 4%,
          transparent
        );
      }
      .composer-text {
        overflow: hidden;
        white-space: nowrap;
      }
      .composer-hint {
        flex: 1;
        color: var(--app-muted);
      }
      .caret {
        flex: none;
        width: 1px;
        height: 1em;
        margin-right: auto;
        background-color: var(--boxel-light);
        animation: blink 1s steps(1) infinite;
      }
      .send {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        margin-left: auto;
        border-radius: 50%;
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        font-weight: 700;
      }

      /* Boxel in the side panel. */
      .panel {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        border-left: 1px solid var(--app-line);
        background-color: var(--boxel-700);
      }
      .panel-head {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-bottom: 1px solid var(--app-line);
        white-space: nowrap;
      }
      .boxel-mark {
        flex: none;
        width: 0.875rem;
        height: 0.875rem;
        border-radius: 0.25rem;
        background-color: var(--boxel-highlight);
      }
      .panel-title {
        font-weight: 700;
      }
      .panel-path {
        overflow: hidden;
        color: var(--app-muted);
        text-overflow: ellipsis;
      }
      .panel-body {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 0;
        padding: var(--boxel-sp-sm);
      }
      .card {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        width: 100%;
        max-width: 12rem;
        padding: var(--boxel-sp-sm);
        border-radius: 0.75rem;
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        box-shadow: 0 0.5rem 1.25rem
          color-mix(in oklch, var(--boxel-dark) 40%, transparent);
      }
      .card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .card-type {
        font-family: var(--boxel-monospace-font-family);
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: color-mix(in oklch, var(--boxel-dark) 55%, transparent);
      }
      .synced {
        padding: 0.1rem 0.4rem;
        border-radius: 0.5rem;
        background-color: var(--boxel-highlight);
        font-size: 0.5625rem;
        font-weight: 700;
        animation: arrive 0.5s ease-out;
      }
      .card-art {
        height: 3.75rem;
        border-radius: 0.5rem;
        background:
          radial-gradient(
            circle at 35% 40%,
            color-mix(in oklch, var(--boxel-yellow) 85%, var(--boxel-light)) 0
              1.2rem,
            transparent 1.3rem
          ),
          linear-gradient(
            135deg,
            color-mix(in oklch, var(--boxel-orange) 35%, var(--boxel-light)),
            color-mix(in oklch, var(--boxel-yellow) 40%, var(--boxel-light))
          );
      }
      .card-title {
        font-size: 0.875rem;
      }
      .card-meta {
        font-size: 0.6875rem;
        color: color-mix(in oklch, var(--boxel-dark) 60%, transparent);
      }
      .rating {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.2rem 0.375rem;
        border-radius: 0.375rem;
        background-color: color-mix(
          in oklch,
          var(--boxel-highlight) 22%,
          transparent
        );
        animation: arrive 0.5s ease-out;
      }
      .stars {
        color: var(--boxel-orange);
        letter-spacing: 0.05em;
      }
      .score {
        font-weight: 700;
      }
      .card-line {
        height: 0.375rem;
        border-radius: 0.25rem;
        background-color: color-mix(
          in oklch,
          var(--boxel-dark) 10%,
          transparent
        );
      }
      .card-line.short {
        width: 60%;
      }
      @keyframes arrive {
        from {
          opacity: 0;
          transform: translateY(0.25rem);
        }
      }
      @keyframes blink {
        50% {
          opacity: 0;
        }
      }
      @keyframes pulse {
        50% {
          opacity: 0.25;
        }
      }

      /* Play and the chapters, under the window. */
      .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .play {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border: 1px solid
          color-mix(in oklch, var(--boxel-light) 18%, transparent);
        border-radius: 50%;
        background: none;
        color: var(--boxel-light);
        font-size: 0.625rem;
        cursor: pointer;
      }
      .chapters {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-5xs);
      }
      .chapter {
        height: 1.75rem;
        padding: 0 var(--boxel-sp-xs);
        border: 1px solid transparent;
        border-radius: 0.875rem;
        background: none;
        color: color-mix(in oklch, var(--boxel-light) 55%, transparent);
        font: 500 var(--boxel-font-xs);
        cursor: pointer;
      }
      .chapter:hover {
        color: var(--boxel-light);
      }
      .chapter[aria-pressed='true'] {
        border-color: color-mix(
          in oklch,
          var(--boxel-highlight) 50%,
          transparent
        );
        color: var(--boxel-highlight);
      }
      .play:focus-visible,
      .chapter:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
      }
      /* Narrow: the sidebar goes and the panel sits under the chat. */
      @media (max-width: 40rem) {
        .window {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: 13rem auto;
          height: auto;
        }
        .sidebar {
          display: none;
        }
        .panel {
          border-left: 0;
          border-top: 1px solid var(--app-line);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .bubble,
        .reply,
        .tool,
        .working i,
        .caret,
        .synced,
        .rating {
          animation: none;
        }
      }
    </style>
  </template>
}
