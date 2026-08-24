import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { beacon, Choreo, motion } from 'glimmer-motion';

const quick = { damping: 24, stiffness: 300 };
const toss = { damping: 22, stiffness: 190 };

const SUBJECTS = [
  ['Marlow', 'Re: the shared header'],
  ['Devin', 'Frames from the shoot'],
  ['Pell', 'Invoice 0912'],
  ['Ozz', 'Lunch?'],
  ['Wren', 'Spring constants, revisited'],
  ['Tam', 'Your package has shipped'],
] as const;

let seq = 0;

interface Row {
  from: string;
  id: string;
  subject: string;
}

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
  @tracked rows: Row[] = SUBJECTS.slice(0, 3).map(([from, subject], i) => ({
    from,
    id: `seed-${i}`,
    subject,
  }));
  /** what the bin has swallowed — the only thing the trash chip counts */
  @tracked binned = 0;
  /** a run is in flight; rows in the air must not offer their delete button */
  @tracked busy = false;
  #settle?: ReturnType<typeof setTimeout>;

  private startRun() {
    this.busy = true;
    clearTimeout(this.#settle);
    // a little longer than the springs above, so the flag outlives the flight
    this.#settle = setTimeout(() => (this.busy = false), 700);
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
    this.rows = [{ from, id: `row-${seq}`, subject }, ...this.rows];
  };

  discard = (id: string) => {
    this.startRun();
    this.rows = this.rows.filter((row) => row.id !== id);
    this.binned += 1;
  };

  <template>
    <div class="ex">
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
          {{#each this.rows key="id" as |row|}}
            <article class="mail" {{motion id=row.id role="row"}}>
              <span class="mail-dot" aria-hidden="true"></span>
              <span class="mail-copy">
                <b>{{row.from}}</b>
                <small>{{row.subject}}</small>
              </span>
              {{! revealed on hover or focus, so the row itself stays a plain
                  strip and the only click target is the one that deletes }}
              <button
                type="button"
                class="mail-kill"
                aria-label="Delete"
                {{on "click" (fn this.discard row.id)}}
              >×</button>
            </article>
          {{/each}}

          <c.Parallel>
            {{! out of the Compose button, into its seat in the list }}
            <c.Move
              @of={{c.inserted "row"}}
              @from={{c.beacon "compose"}}
              @spring={{toss}}
            />
            {{! into the bin — the row is orphaned so it can finish the flight
                after its element has left the list }}
            <c.Move
              @of={{c.removed "row"}}
              @to={{c.beacon "trash"}}
              @spring={{toss}}
            />
            <c.Tween @of={{c.removed "row"}} @opacity={{0}} @ms={{380}} />
            {{! everything still in the tray closes up on the same spring }}
            <c.Move @of={{c.moved "row"}} @spring={{quick}} @size={{false}} />
          </c.Parallel>
        </Choreo>
      </div>
    </div>
  </template>
}
