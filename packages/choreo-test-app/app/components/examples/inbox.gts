import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type { ChoreoRun } from 'glimmer-motion';
import { beacon, Choreo, motion } from 'glimmer-motion';
import { tuneSeconds, tuneSpring } from 'test-app/lib/demo-tuning';

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
    })
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

  private root?: HTMLElement;

  register = modifier((el: HTMLElement) => {
    this.root = el;
    (el as SeekableInboxElement).seekDemo = this.seekDemo;
    return () => {
      delete (el as SeekableInboxElement).seekDemo;
      this.root = undefined;
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
    <div class="ex" {{this.register}}>
      <div class="inbox">
        {{! the chrome — outside the Choreo, and never animated }}
        <header class="inbox-bar">
          <button
            type="button"
            class="inbox-compose"
            disabled={{this.full}}
            {{beacon "compose"}}
            {{on "click" this.compose}}
          >
            <svg
              class="inbox-compose-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            ><path d="M12 5v14M5 12h14" /></svg>
            Compose
          </button>

          {{! Not a control — a counter that happens to be a landmark. It is
              the destination every discarded row flies to, and it holds its
              place in the bar whatever the number does: the count is
              tabular and the chip has a floor width, so a row in flight is
              never chasing a target that moved because a digit changed. }}
          <span class="inbox-trash" {{beacon "trash"}}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path
                d="M6 8h12l-1 11a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 19L6 8zm3-3h6l.7 2H8.3L9 5zM4.5 7h15"
              /></svg>
            <b>{{this.binned}}</b>
          </span>
        </header>

        <Choreo class={{if this.busy "inbox-list is-busy" "inbox-list"}} as |c|>
          {{this.grab c}}
          {{#each this.rows key="id" as |row|}}
            <article class="mail" {{motion id=row.id role="row"}}>
              <span
                class="mail-avatar hue-{{hueOf row.from}}"
                aria-hidden="true"
              >{{initialOf row.from}}</span>
              <span class="mail-copy">
                <span class="mail-line">
                  <b>{{row.from}}</b>
                  <time class="mail-time">{{row.time}}</time>
                </span>
                <small>{{row.subject}}</small>
              </span>
              {{! revealed on hover or focus, so the row itself stays a plain
                  strip and the only click target is the one that deletes }}
              <button
                type="button"
                class="mail-kill"
                aria-label="Delete"
                {{on "click" (fn this.discard row.id)}}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path
                    d="M6 8h12l-1 11a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 19L6 8zm3-3h6l.7 2H8.3L9 5zM4.5 7h15"
                  /></svg>
              </button>
            </article>
          {{/each}}

          <c.Parallel>
            {{! out of the Compose button, into its seat in the list }}
            <c.Move
              @of={{c.inserted "row"}}
              @from={{c.beacon "compose"}}
              @spring={{tuneSpring "inbox" toss "toss"}}
            />
            {{! into the bin — the row is orphaned so it can finish the flight
                after its element has left the list }}
            <c.Move
              @of={{c.removed "row"}}
              @to={{c.beacon "trash"}}
              @spring={{tuneSpring "inbox" toss "toss"}}
            />
            <c.Tween
              @of={{c.removed "row"}}
              @opacity={{0}}
              @duration={{tuneSeconds "inbox" 0.38 "Step 1 duration"}}
            />
            {{! everything still in the tray closes up on the same spring }}
            <c.Move
              @of={{c.moved "row"}}
              @spring={{tuneSpring "inbox" quick "quick"}}
              @size={{false}}
            />
          </c.Parallel>
        </Choreo>
      </div>
    </div>
  </template>
}
