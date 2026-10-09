import type { ChoreoRun } from '@cardstack/choreo';
import { beacon, Choreo } from '@cardstack/choreo';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneSeconds, tuneSpring } from '../lib/tuning';
import InboxNotes from '../notes/inbox';

const quick = { damping: 24, stiffness: 300 };
const toss = { damping: 22, stiffness: 190 };

const SUBJECTS = [
  ['Marlow', 'Re: the shared header', '2m'],
  ['Devin', 'Frames from the shoot', '18m'],
  ['Pell', 'Invoice 0912', '1h'],
  ['Ozz', 'Lunch?', '3h'],
  ['Wren', 'Spring constants, revisited', 'Yesterday'],
  ['Tam', 'Your package has shipped', 'Mon'],
] as const;

/** avatar background — picked from `from`, not stored, so it never has to
 *  travel with a row */
const HUES = ['ember', 'copper', 'iris', 'steel', 'teal', 'azure'] as const;

function hueOf(from: string): (typeof HUES)[number] {
  let h = 0;
  for (let i = 0; i < from.length; i++) {
    h = (h * 31 + from.charCodeAt(i)) >>> 0;
  }
  return HUES[h % HUES.length]!;
}

function initialOf(from: string): string {
  return from.charAt(0).toUpperCase();
}

let seq = 0;

interface Row {
  from: string;
  id: string;
  subject: string;
  time: string;
}

interface SeekableInboxElement extends HTMLElement {
  seekDemo?: (time: number) => PromiseLike<void> | void;
}

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The case beacons exist for.
 *
 * Compose and Trash live in the chrome, OUTSIDE the region — a real inbox has
 * them in a toolbar while the list lives in an outlet, and they are separate
 * regions on purpose so their changesets stay apart. Neither is a participant:
 * they are never inserted, kept or removed, and moving one never starts a run.
 * They only say where they are.
 *
 * A new row borrows Compose's box as a start it never had; a deleted row
 * borrows Trash's box as an end it never reaches. `layoutId` could not do this
 * — it pairs two real elements and morphs one into the other, so the bin itself
 * would stretch. A beacon is a point, not an identity.
 */
export class Inbox extends Component {
  @tracked rows: Row[] = SUBJECTS.slice(0, 3).map(
    ([from, subject, time], i) => ({
      from,
      id: `seed-${i}`,
      subject,
      time,
    }),
  );
  /** what the bin has swallowed — the only thing the trash chip counts */
  @tracked binned = 0;
  /** a run is in flight; rows in the air must not offer their delete button */
  @tracked busy = false;
  #watch = 0;
  private c: { run: ChoreoRun | null } | null = null;

  /** the yielded context, held so the flag below can read the region's run */
  grab = (c: { run: ChoreoRun | null }) => {
    this.c = c;
    return '';
  };

  /**
   * The flag follows the FLIGHT, not a clock. It used to clear itself on
   * a 700ms timer — "a little longer than the springs" — which was a
   * guess twice over: about the spring, and about the tempo. Under the
   * slow-mo control the flight runs many times longer than any timer,
   * and the delete buttons came back to rows still in the air.
   *
   * The run is the truth. It exists once this action's render has
   * produced its pass (a frame from now), and `run.finished` resolves
   * when the flight actually lands — at any tempo. A second action
   * re-arms the watch with a fresh token; a run replaced mid-air
   * resolves early, so the landing check re-latches whatever run is
   * current before letting the flag go.
   */
  private startRun() {
    this.busy = true;
    const token = ++this.#watch;
    const mine = () => token === this.#watch && !this.isDestroying;
    const settle = (run: ChoreoRun) =>
      void run.finished.then(() => {
        if (!mine()) {
          return;
        }
        const current = this.c?.run;
        if (current && !current.isDone()) {
          settle(current);
        } else {
          this.busy = false;
        }
      });
    let tries = 8;
    const latch = () => {
      if (!mine()) {
        return;
      }
      const run = this.c?.run;
      if (run && !run.isDone()) {
        settle(run);
      } else if (tries-- > 0) {
        requestAnimationFrame(latch);
      } else {
        // nothing took flight (reduced motion): nothing to wait out
        this.busy = false;
      }
    };
    requestAnimationFrame(latch);
  }

  get full() {
    return this.rows.length >= 6;
  }

  compose = () => {
    if (this.full) {
      return;
    }
    const [from, subject] = SUBJECTS[seq++ % SUBJECTS.length]!;
    this.startRun();
    // a message you just sent yourself always says "Now" — the canned time
    // in SUBJECTS is only for the rows the demo starts seeded with
    this.rows = [
      { from, id: `row-${seq}`, subject, time: 'Now' },
      ...this.rows,
    ];
  };

  discard = (id: string) => {
    this.startRun();
    this.rows = this.rows.filter((row) => row.id !== id);
    this.binned += 1;
  };

  register = modifier((el: HTMLElement) => {
    (el as SeekableInboxElement).seekDemo = this.seekDemo;
    return () => {
      delete (el as SeekableInboxElement).seekDemo;
    };
  });

  /** Optional capture handle; it drives this demo's actual Choreo run. */
  seekDemo = async (time: number) => {
    const local = Math.max(0, time - 0.9);
    if (time >= 0.9 && this.rows.length === 3) {
      this.compose();
      await nextFrame();
      await nextFrame();
    }
    const run = this.c?.run;
    if (run) {
      run.pause();
      run.time = Math.min(local, run.duration);
    }
  };

  <template>
    <div class='ex' {{this.register}}>
      <div class='inbox'>
        {{! the chrome — outside the Choreo, and never animated }}
        <header class='inbox-bar'>
          <button
            type='button'
            class='inbox-compose'
            disabled={{this.full}}
            {{beacon 'compose'}}
            {{on 'click' this.compose}}
          >
            <svg
              class='inbox-compose-icon'
              viewBox='0 0 24 24'
              aria-hidden='true'
            ><path d='M12 5v14M5 12h14' /></svg>
            Compose
          </button>

          {{! Not a control — a counter that happens to be a landmark. It is
              the destination every discarded row flies to, and it holds its
              place in the bar whatever the number does: the count is
              tabular and the chip has a floor width, so a row in flight is
              never chasing a target that moved because a digit changed. }}
          <span class='inbox-trash' {{beacon 'trash'}}>
            <svg viewBox='0 0 24 24' aria-hidden='true'><path
                d='M6 8h12l-1 11a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 19L6 8zm3-3h6l.7 2H8.3L9 5zM4.5 7h15'
              /></svg>
            <b>{{this.binned}}</b>
          </span>
        </header>

        <Choreo class={{if this.busy 'inbox-list is-busy' 'inbox-list'}} as |c|>
          {{this.grab c}}
          {{#each this.rows key='id' as |row|}}
            <article class='mail' {{motion id=row.id role='row'}}>
              <span
                class='mail-avatar hue-{{hueOf row.from}}'
                aria-hidden='true'
              >{{initialOf row.from}}</span>
              <span class='mail-copy'>
                <span class='mail-line'>
                  <b>{{row.from}}</b>
                  <time class='mail-time'>{{row.time}}</time>
                </span>
                <small>{{row.subject}}</small>
              </span>
              {{! revealed on hover or focus, so the row itself stays a plain
                  strip and the only click target is the one that deletes }}
              <button
                type='button'
                class='mail-kill'
                aria-label='Delete'
                {{on 'click' (fn this.discard row.id)}}
              >
                <svg viewBox='0 0 24 24' aria-hidden='true'><path
                    d='M6 8h12l-1 11a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 19L6 8zm3-3h6l.7 2H8.3L9 5zM4.5 7h15'
                  /></svg>
              </button>
            </article>
          {{/each}}

          <c.Parallel>
            {{! out of the Compose button, into its seat in the list }}
            <c.Move
              @of={{c.inserted 'row'}}
              @from={{c.beacon 'compose'}}
              @spring={{tuneSpring 'inbox' toss 'toss'}}
            />
            {{! into the bin — the row is orphaned so it can finish the flight
                after its element has left the list }}
            <c.Move
              @of={{c.removed 'row'}}
              @to={{c.beacon 'trash'}}
              @spring={{tuneSpring 'inbox' toss 'toss'}}
            />
            <c.Tween
              @of={{c.removed 'row'}}
              @opacity={{0}}
              @duration={{tuneSeconds 'inbox' 0.38 'Step 1 duration'}}
            />
            {{! everything still in the tray closes up on the same spring }}
            <c.Move
              @of={{c.moved 'row'}}
              @spring={{tuneSpring 'inbox' quick 'quick'}}
              @size={{false}}
            />
          </c.Parallel>
        </Choreo>
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

      /* ---- Inbox: beacons ---- */

      .inbox {
        width: min(440px, 100%);
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .inbox-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 18px;
        /* a color tint rather than a neutral one — the bar is chrome the same way
         the topbar or a card is, and everything else on the page that plays that
         role takes its warmth from the brand rather than from plain white */
        background: rgba(255, 59, 31, 0.05);
        border: 1px solid rgba(255, 59, 31, 0.14);
      }

      .inbox-compose {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 0;
        cursor: pointer;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.01em;
        color: #0b0a09;
        background: linear-gradient(180deg, #ffd9a3, #f7ac52);
        padding: 8px 16px 8px 13px;
        border-radius: 999px;
        box-shadow: 0 5px 14px rgba(247, 172, 82, 0.25);
        transition:
          transform 0.16s var(--ease),
          box-shadow 0.16s var(--ease);
      }

      @media (hover: hover) {
        .inbox-compose:hover {
          transform: translateY(-1px);
          box-shadow: 0 7px 18px rgba(247, 172, 82, 0.34);
        }
      }

      .inbox-compose-icon {
        width: 15px;
        height: 15px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2.2;
        stroke-linecap: round;
      }

      .inbox-compose[disabled] {
        opacity: 0.4;
        cursor: default;
        transform: none;
        box-shadow: none;
      }

      /* the bar is Compose on the left, the bin on the right, and nothing in
       between that can change width — a beacon that shifts is a beacon that
       rows in flight are aiming at the wrong place */

      .inbox-bar > .inbox-compose {
        margin-right: auto;
      }

      /* a landmark, not a control — no background or border of its own, so it
       does not read as a second button sitting next to Compose. It is still a
       real beacon target and still holds a fixed footprint (min-width, height)
       so a row in flight is never chasing a target that moved because a digit
       changed; it just does that without looking like something you could
       press. */

      .inbox-trash {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-width: 66px;
        height: 38px;
        padding: 0 11px;
      }

      .inbox-trash b {
        /* tabular figures so 1 and 7 are the same width, and room for two of them
         reserved up front so the box is identical at 1 and at 10 */
        font-variant-numeric: tabular-nums;
        min-width: 2ch;
        text-align: right;
        font-size: 13px;
        font-weight: 600;
        color: rgba(var(--ink-rgb), 0.72);
      }

      .inbox-trash svg {
        width: 19px;
        height: 19px;
        fill: none;
        stroke: rgba(var(--ink-rgb), 0.5);
        stroke-width: 1.5;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .inbox-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 150px;
      }

      .mail {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        text-align: left;
        font: inherit;
        padding: 10px 13px 10px 10px;
        border-radius: 14px;
        background: rgba(var(--surface-tint-rgb), 0.055);
        border: 1px solid rgba(var(--surface-tint-rgb), 0.08);
        color: inherit;
      }

      .mail {
        position: relative;
      }

      @media (hover: hover) {
        .mail:hover {
          background: rgba(var(--surface-tint-rgb), 0.09);
          border-color: rgba(var(--surface-tint-rgb), 0.14);
        }
      }

      /* one letter, one of six hues picked from the sender's name — the fastest
       way for an eye to tell six rows of small-caps text apart at a glance,
       and every mobile inbox from the last decade agrees */

      .mail-avatar {
        flex: none;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        font-family: var(--font-display);
        font-size: 13px;
        font-weight: 700;
        color: #fff;
      }

      .mail-kill {
        margin-left: auto;
        flex: none;
        width: 26px;
        height: 26px;
        display: grid;
        place-items: center;
        border-radius: 8px;
        border: 1px solid rgba(var(--surface-tint-rgb), 0.12);
        background: rgba(var(--surface-tint-rgb), 0.06);
        color: rgba(var(--ink-rgb), 0.62);
        font: inherit;
        cursor: pointer;
        /* hidden until the row is hovered, but never display:none — the row is a
         Choreo participant and its measured box must not change on hover */
        opacity: 0;
        transition:
          opacity 0.14s ease,
          background 0.14s ease,
          border-color 0.14s ease,
          color 0.14s ease;
      }

      .mail-kill svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .mail-kill:focus-visible {
        opacity: 1;
      }

      @media (hover: hover) {
        .mail:hover .mail-kill {
          opacity: 1;
        }
      }

      /* A row entering from Compose passes straight under the pointer, which would
       light its delete button up mid-flight. The list marks itself busy for the
       length of a run, so nothing offers a control it is still carrying. */

      .inbox-list.is-busy .mail-kill {
        opacity: 0;
        pointer-events: none;
      }

      @media (hover: hover) {
        .mail-kill:hover {
          background: rgba(255, 120, 90, 0.22);
          border-color: rgba(255, 120, 90, 0.4);
          color: #ffd9cf;
        }
      }

      .mail-copy {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        flex: 1 1 auto;
      }

      .mail-line {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }

      .mail-line b {
        font-size: 13.5px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mail-time {
        flex: none;
        font-family: var(--font-mono);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.02em;
        color: rgba(var(--ink-rgb), 0.4);
      }

      .mail-copy small {
        font-size: 12px;
        color: rgba(var(--ink-rgb), 0.5);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      @media (hover: none) {
        .mail-kill {
          opacity: 1;
        }
      }

      .choreo-site:not([data-theme='light']) .inbox-trash b {
        color: rgba(255, 255, 255, 0.72);
      }

      .choreo-site:not([data-theme='light']) .inbox-trash svg {
        stroke: rgba(255, 255, 255, 0.5);
      }

      @media (hover: hover) {
        .choreo-site:not([data-theme='light']) .mail:hover {
          background: rgba(255, 255, 255, 0.085);
        }
      }

      .choreo-site:not([data-theme='light']) .mail-kill {
        color: rgba(255, 255, 255, 0.62);
      }

      .choreo-site:not([data-theme='light']) .mail-copy small {
        color: rgba(255, 255, 255, 0.46);
      }
    </style>
  </template>
}

export class InboxDemo extends GalleryDemo {
  static stage = Inbox;
  static notes = InboxNotes;
}
