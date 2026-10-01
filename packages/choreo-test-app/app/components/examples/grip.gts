import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type { DragControls } from 'glimmer-motion';
import { createDragControls, motion } from 'glimmer-motion';
import { tuneMotion, tuneObject } from 'test-app/lib/demo-tuning';

/**
 * Seat twelve people. Drag them by the corner, because the card is also a form.
 *
 * This stage was a grey card with a grip, a "pin", and a scrolling log of
 * pointer events, under the instruction "Hover the card. Press it. Then lift it
 * by the grip." It demonstrated the same API it demonstrates now and it failed
 * the plainest test there is: freeze every frame and nothing is lost, because
 * `dragSnapToOrigin` meant the drag had no consequence. The card ended where it
 * started, every time, on purpose. A demo of a gesture that cannot do anything
 * is a demo of decoration.
 *
 * A seating plan gives every part of the cluster a job it cannot be stripped
 * of:
 *
 * - **`dragListener=false` is a requirement, not a nicety.** Each guest card
 *   carries a note field and a phone number. With `drag=true` you cannot put a
 *   caret in that field or select that number — the element's own pointerdown
 *   opens a drag and swallows the gesture. Turning the card's listener off and
 *   starting the session from the corner tab is the ONLY way a draggable thing
 *   can also be a form. That is the whole reason the controls object exists.
 * - **`onPanSessionStart` arms the tables.** It fires at pointerdown, BEFORE
 *   the threshold that decides this is a drag, so every table with a free chair
 *   lights the instant you take hold of someone — while you are still deciding
 *   whether to move them. Nothing else in the drag surface fires that early,
 *   and a demo that logs it to a list rather than doing something with it is
 *   not showing you what it is for.
 * - **`dragSnapToOrigin` is the refusal.** Drop a guest on a full table, or on
 *   nothing, and they fly back to the rail. The snap-back is the only "no" this
 *   interface gives, and the flight is what makes it legible: frozen, a refused
 *   drop and an untouched card are the same picture.
 * - **`onTap` and `onTapCancel` are the two ways a press ends.** Released on
 *   the card, it opens the guest's details. Pressed, twitched and released off
 *   it, nothing happens — which is the distinction a press handler has to make
 *   by hand, doing an actual job rather than printing its own name.
 *
 * And there is a rule, so that the plan can be wrong: two of the guests do not
 * speak to each other. Seat them together and the table says so. That is the
 * difference between a board you filled in and a board you got right.
 */

/**
 * The ride home. There are no coordinates to return to on a hit — a seated
 * guest leaves the rail entirely — so this spring is only ever seen on a
 * refusal, and it is tuned to read as one: quick, and slightly overshot, the
 * way something handed back is.
 */
const RETURN = {
  bounceDamping: 34,
  bounceStiffness: 520,
  power: 0.18,
  timeConstant: 210,
} as const;

const SEAT_IN = { opacity: 0, scale: 0.86 };
const SEAT_HERE = { opacity: 1, scale: 1 };
const SEAT_SPRING = {
  bounce: 0.28,
  type: 'spring',
  visualDuration: 0.32,
} as const;

interface Guest {
  /** ticked dietary pills, by id */
  diets: string[];
  id: string;
  name: string;
  /** anything the pills do not cover */
  note: string;
  phone: string;
  /** where they are sitting, or null for still on the rail */
  table: string | null;
}

/**
 * The pills. Checkboxes, drawn as chips, and the point of them is that they
 * are CLICKABLE on a card that also drags — under `drag=true` a press on one of
 * these opens a drag session instead of ticking anything.
 */
const DIETS = [
  { id: 'shellfish', label: 'no shellfish' },
  { id: 'veg', label: 'vegetarian' },
  { id: 'nuts', label: 'nut allergy' },
  { id: 'gluten', label: 'gluten free' },
  { id: 'dairy', label: 'no dairy' },
  { id: 'pork', label: 'no pork' },
] as const;

const LABELS = new Map<string, string>(DIETS.map((d) => [d.id, d.label]));

const TABLES = [
  { id: 't1', name: 'Table one' },
  { id: 't2', name: 'Table two' },
  { id: 't3', name: 'Table three' },
];

/** four chairs each, twelve guests, so a full plan uses every seat */
const SEATS = 4;

/** the two who do not speak. A plan can be complete and still be wrong */
const FEUD = ['nadia', 'raj'] as const;

const PEOPLE: Array<[string, string, string[], string]> = [
  ['nadia', 'Nadia Osei', ['shellfish'], '07700 900 118'],
  ['raj', 'Raj Chandra', ['veg'], '07700 900 214'],
  ['mira', 'Mira Halvorsen', [], '07700 900 337'],
  ['tom', 'Tom Beckett', ['nuts'], '07700 900 402'],
  ['ines', 'Inés Marchetti', [], '07700 900 551'],
  ['ola', 'Ola Adeyemi', ['dairy'], '07700 900 673'],
  ['fen', 'Fen Lightbody', [], '07700 900 719'],
  ['sam', 'Sam Okonkwo', ['gluten'], '07700 900 884'],
  ['bea', 'Bea Whitlock', [], '07700 900 905'],
  ['jun', 'Jun Watanabe', ['pork'], '07700 900 143'],
  ['edda', 'Edda Sørensen', [], '07700 900 266'],
  ['cal', 'Cal Brennan', ['gluten', 'dairy'], '07700 900 390'],
];

const START: Guest[] = PEOPLE.map(([id, name, diets, phone]) => ({
  diets,
  id,
  name,
  note: '',
  phone,
  table: null,
}));

export class Grip extends Component {
  tables = TABLES;
  seats = SEATS;

  diets = DIETS;

  @tracked guests: Guest[] = START.map((g) => ({ ...g, diets: [...g.diets] }));
  /** a hand is on somebody: every table with room says so */
  @tracked armed = false;
  /**
   * The zone the pointer is actually over, updated per drag frame.
   *
   * `armed` says where a guest COULD go; this says where they WOULD go. A
   * board that only shows the first makes you drop and find out — which is
   * fine once and tiresome twelve times, and it is the difference between a
   * drop target and a drop target you can aim at.
   */
  @tracked over: string | null = null;
  /** whose details are open, from a tap that landed */
  @tracked open: string | null = null;
  @tracked note =
    'take someone by the corner tab — the free tables will say so';

  /**
   * One controls object per card, made on demand and kept.
   *
   * `createDragControls()` is a handle to ONE element's gesture, so a shared
   * one would start whichever card happened to register last. Keyed by guest
   * because the rail is a changing list and an index is not an identity.
   */
  private controls = new Map<string, DragControls>();

  controlsFor = (id: string) => {
    let c = this.controls.get(id);
    if (!c) {
      c = createDragControls();
      this.controls.set(id, c);
    }
    return c;
  };

  private tableEls = new Map<string, HTMLElement>();
  private railEl: HTMLElement | null = null;

  bindRail = modifier((el: HTMLElement) => {
    this.railEl = el;
    return () => {
      this.railEl = null;
    };
  });

  bindTable = modifier((el: HTMLElement, [id]: [string]) => {
    this.tableEls.set(id, el);
    return () => {
      this.tableEls.delete(id);
    };
  });

  get unseated() {
    return this.guests.filter((g) => g.table === null);
  }

  get left() {
    return this.unseated.length;
  }

  seatedAt = (table: string) => this.guests.filter((g) => g.table === table);

  roomAt = (table: string) => this.seatedAt(table).length < SEATS;

  /** both halves of the feud at one table is a plan that is finished and wrong */
  feudAt = (table: string) =>
    FEUD.every((id) =>
      this.guests.some((g) => g.id === id && g.table === table)
    );

  get anyFeud() {
    return TABLES.some((t) => this.feudAt(t.id));
  }

  get done() {
    return this.left === 0 && !this.anyFeud;
  }

  get tally() {
    if (this.done) {
      return 'everyone seated';
    }
    return this.left === 0 ? 'everyone seated, but…' : `${this.left} to seat`;
  }

  /**
   * Three things at once, in a fixed order of importance: where you ARE, where
   * you COULD go, and what is already wrong.
   *
   * The hover state comes first because it answers the question being asked
   * right now. A table that is both a legal target and the one under the
   * pointer should look like the one under the pointer — otherwise every table
   * looks the same at the moment the difference matters.
   */
  tableClass = (table: string) => {
    const classes = ['tp-table'];
    if (this.over === table) {
      classes.push(this.roomAt(table) ? 'is-over' : 'is-no');
    } else if (this.armed && this.roomAt(table)) {
      classes.push('is-live');
    }
    if (!this.roomAt(table)) {
      classes.push('is-full');
    }
    if (this.feudAt(table)) {
      classes.push('is-wrong');
    }
    return classes.join(' ');
  };

  cardClass = (id: string) =>
    this.open === id ? 'tp-card is-open' : 'tp-card';

  /**
   * A card in flight has to ride OVER the tables. The rail and the tables are
   * siblings in a grid, so without this the card slides underneath the thing
   * it is being carried to and disappears at the moment the drop matters most.
   * Set on the drag rather than always, so a resting rail does not sit above
   * everything for no reason.
   */
  liftClass = (id: string) => (this.carrying === id ? 'tp-lift' : '');

  /** the chair a guest is sitting in, and whether it is the one in flight */
  seatClass = (id: string) =>
    this.carrying === id ? 'tp-seat tp-lift' : 'tp-seat';

  /**
   * A getter, not a method. `class={{this.railClass}}` on a zero-argument
   * method renders the FUNCTION — Glimmer only invokes a value that is a
   * helper — and the attribute comes out as junk rather than as nothing, so the
   * element quietly stops matching its own selector. It cost a test that could
   * not find `.tp-rail` on a page that plainly had one.
   */
  get railClass() {
    if (this.over === 'rail') {
      return 'tp-rail is-over';
    }
    return this.armed && this.carrying ? 'tp-rail is-live' : 'tp-rail';
  }

  @tracked private carrying: string | null = null;

  hoist = (id: string) => {
    this.carrying = id;
    // stale from the last drag; re-measured on the first frame of this one,
    // by which point the card has already shrunk
    this.zones = null;
  };

  /**
   * The corner tab is not the draggable element — it is a button that starts
   * the draggable element's gesture, and the event is forwarded because the
   * session needs the real pointer that opened it rather than a synthetic one.
   */
  lift = (id: string, event: PointerEvent) => {
    this.controlsFor(id).start(event);
  };

  /** pointerdown, before the threshold: light every table with a chair free */
  session = () => {
    this.armed = true;
    this.note = 'the lit tables have room — the others are full';
  };

  /**
   * The last live pointer position, in VIEWPORT coordinates, kept per frame.
   *
   * Two wrong answers preceded this one and both are worth keeping, because
   * each looks obviously right until it is measured.
   *
   * The first read `info.point` in `onDragEnd` and tested it against each
   * table's rect. `point` is built from `pageX/pageY` and a rect is viewport
   * coordinates, so the two need reconciling — and the reconciliation is only a
   * scroll offset while nothing between them is transformed. Under a scaled
   * ancestor, which is what this stage sits inside during a crossing, they
   * differ by a factor as well, and the drop silently never lands.
   *
   * The second asked the CARD where it was at drag end, which is the better
   * question and the wrong moment: `dragSnapToOrigin` starts the return in the
   * same breath as `onDragEnd`, so the box being measured is already on its way
   * home. In the fixture it had travelled a third of the way back before the
   * handler read it.
   *
   * `clientX/clientY` off the last drag frame is in the same space as every
   * rect, needs no conversion, and is captured while the gesture is still the
   * truth rather than after it has been undone.
   */
  private lastAt: { x: number; y: number } | null = null;

  /**
   * The zones' boxes, measured ONCE per drag.
   *
   * Both halves of this matter and the stage was doing neither. Measuring four
   * elements on every drag frame interleaves layout reads with the drag's own
   * transform writes, which is the classic thrash: each read forces the style
   * the previous write invalidated. And assigning `over` unconditionally made
   * it a tracked write per frame, so the whole board — twelve cards, six pills
   * each, three tables — re-rendered sixty times a second to answer a question
   * whose answer changes perhaps four times in a drag.
   *
   * Together they cost about a frame a second. The design was right and the
   * implementation was a loop; this is the same design with the loop taken out.
   *
   * Once is enough because the board does not move while a card is being
   * carried: the columns are fixed proportions of the grid, so shrinking a card
   * in the rail cannot shift a table.
   */
  private zones: Array<{ id: string; rect: DOMRect }> | null = null;

  private measureZones() {
    const out: Array<{ id: string; rect: DOMRect }> = [];
    for (const t of TABLES) {
      const el = this.tableEls.get(t.id);
      if (el) {
        out.push({ id: t.id, rect: el.getBoundingClientRect() });
      }
    }
    if (this.railEl) {
      out.push({ id: 'rail', rect: this.railEl.getBoundingClientRect() });
    }
    this.zones = out;
  }

  track = (event: MouseEvent | PointerEvent | TouchEvent) => {
    const at = event as { clientX?: number; clientY?: number };
    if (typeof at.clientX !== 'number' || typeof at.clientY !== 'number') {
      return;
    }
    this.lastAt = { x: at.clientX, y: at.clientY };
    const next = this.zoneUnder(this.lastAt);
    // the guard is the whole fix: a tracked write per frame is a render per
    // frame, and this answer changes a handful of times in an entire drag
    if (next !== this.over) {
      this.over = next;
    }
  };

  /**
   * Which zone the pointer is over: a table, the list, or nothing.
   *
   * The list is a drop target too, and that is the interaction the first cut
   * was missing. Without it the only way to change your mind about a seated
   * guest is a small × on their chair, which is a different gesture for the
   * same idea — put this person somewhere else. Everything you can do by
   * dragging should be undoable by dragging.
   */
  private zoneUnder(at: { x: number; y: number } | null): string | null {
    if (!at) {
      return null;
    }
    if (!this.zones) {
      this.measureZones();
    }
    for (const z of this.zones ?? []) {
      const r = z.rect;
      if (
        at.x >= r.left &&
        at.x <= r.right &&
        at.y >= r.top &&
        at.y <= r.bottom
      ) {
        return z.id;
      }
    }
    return null;
  }

  drop = (guest: Guest, event?: MouseEvent | PointerEvent | TouchEvent) => {
    this.armed = false;
    this.carrying = null;
    const end = event as { clientX?: number; clientY?: number } | undefined;
    const at =
      typeof end?.clientX === 'number' && typeof end.clientY === 'number'
        ? { x: end.clientX, y: end.clientY }
        : this.lastAt;
    const zone = this.zoneUnder(at);
    this.lastAt = null;
    this.over = null;
    this.zones = null;

    if (!zone) {
      this.note = `${guest.name} came back — that was not a table`;
      return;
    }

    if (zone === 'rail') {
      if (guest.table === null) {
        this.note = `${guest.name} is still on the list`;
        return;
      }
      this.seat(guest, null);
      this.note = `${guest.name} is back on the list`;
      return;
    }

    const table = TABLES.find((t) => t.id === zone)!;
    if (guest.table === table.id) {
      this.note = `${guest.name} is already at ${table.name.toLowerCase()}`;
      return;
    }
    if (!this.roomAt(table.id)) {
      this.note = `${table.name} is full — ${guest.name} came back`;
      return;
    }
    this.seat(guest, table.id);
    this.note = this.feudAt(table.id)
      ? `${table.name}: those two do not speak`
      : `${guest.name} is at ${table.name.toLowerCase()}`;
  };

  private seat(guest: Guest, table: string | null) {
    this.guests = this.guests.map((g) =>
      g.id === guest.id ? { ...g, table } : g
    );
  }

  /**
   * Released ON the card: open their details. It only ever OPENS.
   *
   * A tap that also closed would be a trap, because every control inside the
   * flap — six pills, a field — sits on the card, so clicking one of them also
   * registers a tap on the card and the panel would shut under your finger the
   * moment you used it. Closing is the button's job, and the button says so.
   */
  press = (guest: Guest) => {
    this.open = guest.id;
  };

  /**
   * Pressed, twitched, released OFF it. Nothing happens, and that is the whole
   * value of having the two callbacks: somebody who started a press on a card
   * and slid off it was beginning a drag and thought better of it. Opening an
   * editor at them would be answering a question they withdrew.
   */
  pressCancel = () => {};

  /** the explicit affordance for the same thing, because a tap is invisible */
  toggleEdit = (guest: Guest) => {
    this.open = this.open === guest.id ? null : guest.id;
  };

  /**
   * Keep a control's pointer away from the card's press gesture.
   *
   * `done` did not work, and the reason is the whole hazard of putting
   * interactive things inside a pressable thing. The button's click closed the
   * flap; the card's `onTap` then fired a frame later — taps resolve on the
   * frameloop, not in the handler — saw a closed card, and opened it again.
   * Every press of `done` was a close followed instantly by an open, which
   * looks exactly like a dead button.
   *
   * Stopping the gesture at pointerDOWN rather than at click is what matters:
   * by the time a click exists the press has already been registered. This is
   * on the button rather than solved in `press`, because the honest statement
   * is that a control is not part of the card's press surface — not that the
   * card should try to guess which of its own taps were meant for it.
   */
  swallow = (event: Event) => {
    event.stopPropagation();
  };

  toggleDiet = (guest: Guest, diet: string) => {
    this.guests = this.guests.map((g) =>
      g.id === guest.id
        ? {
            ...g,
            diets: g.diets.includes(diet)
              ? g.diets.filter((d) => d !== diet)
              : [...g.diets, diet],
          }
        : g
    );
  };

  hasDiet = (guest: Guest, diet: string) => guest.diets.includes(diet);

  dietClass = (guest: Guest, diet: string) =>
    guest.diets.includes(diet) ? 'tp-pill is-on' : 'tp-pill';

  /** what the card says at rest: the ticked pills, then anything typed */
  summaryOf = (guest: Guest) => {
    const ticked = guest.diets.map((d) => LABELS.get(d) ?? d);
    if (guest.note.trim()) {
      ticked.push(guest.note.trim());
    }
    return ticked.join(' · ');
  };

  editLabel = (id: string) => (this.open === id ? 'done' : 'edit');

  setNote = (guest: Guest, event: Event) => {
    const note = (event.target as HTMLInputElement).value;
    this.guests = this.guests.map((g) =>
      g.id === guest.id ? { ...g, note } : g
    );
  };

  isOpen = (id: string) => this.open === id;

  freeAt = (table: string) => {
    const free = SEATS - this.seatedAt(table).length;
    return free === 0 ? 'full' : `${free} free`;
  };

  reset = () => {
    this.guests = START.map((g) => ({ ...g, diets: [...g.diets] }));
    this.open = null;
    this.armed = false;
    this.note = 'take someone by the corner tab — the free tables will say so';
  };

  <template>
    <div class="ex tp-ex">
      <header class="tp-head">
        <b class="tp-tally {{if this.done 'is-done' ''}}">{{this.tally}}</b>
        <span class="tp-note">{{this.note}}</span>
        <button type="button" class="chip" {{on "click" this.reset}}>start over</button>
      </header>

      <div class="tp-board">
        {{! The list is a drop target too. Everything you can do by dragging is
            undone by dragging: a seated guest carried back here goes on the
            list again, which is why there is no × on a chair. }}
        <ol
          class={{this.railClass}}
          aria-label="Guests to seat"
          {{this.bindRail}}
        >
          {{#each this.unseated key="id" as |guest|}}
            <li>
              {{! The card's OWN pointerdown is off. Everything inside it — the
                  note field, the number — is ordinary content again, and the
                  corner tab is the only thing that can lift it. }}
              <article
                class="{{this.cardClass guest.id}} {{this.liftClass guest.id}}"
                {{motion
                  drag=true
                  dragControls=(this.controlsFor guest.id)
                  dragListener=false
                  dragSnapToOrigin=true
                  dragTransition=(tuneObject "grip" RETURN "dragTransition")
                  onPanSessionStart=this.session
                  onDragStart=(fn this.hoist guest.id)
                  onDrag=this.track
                  onDragEnd=(fn this.drop guest)
                  onTap=(fn this.press guest)
                  onTapCancel=this.pressCancel
                }}
              >
                {{! The grip, with a rule down its right-hand side. It is a
                    different KIND of thing from everything beside it — the one
                    place a press means "carry me" rather than "use me" — and
                    six dots pressed against a name do not say that on their
                    own. }}
                <button
                  type="button"
                  class="tp-grip"
                  aria-label="Move {{guest.name}}"
                  {{on "pointerdown" (fn this.lift guest.id)}}
                >
                  <span class="tp-dots" aria-hidden="true">
                    <i></i><i></i><i></i><i></i><i></i><i></i>
                  </span>
                </button>

                <div class="tp-main">
                  <div class="tp-who">
                    <b>{{guest.name}}</b>
                    <span class="tp-diet">{{this.summaryOf guest}}</span>
                    <button
                      type="button"
                      class="tp-edit"
                      {{on "pointerdown" this.swallow}}
                      {{on "click" (fn this.toggleEdit guest)}}
                    >{{this.editLabel guest.id}}</button>
                  </div>

                  {{#if (this.isOpen guest.id)}}
                    {{! Every control in here is the argument. Six checkboxes
                        and a text field on a card that also drags: with
                        `drag=true` a press on a pill opens a drag session
                        instead of ticking it, and the field never sees a
                        caret. `dragListener=false` is what hands the pointer
                        back to them. }}
                    <div class="tp-flap">
                      <div class="tp-pills">
                        {{#each this.diets key="id" as |diet|}}
                          <button
                            type="button"
                            class={{this.dietClass guest diet.id}}
                            role="checkbox"
                            aria-checked={{if
                              (this.hasDiet guest diet.id)
                              "true"
                              "false"
                            }}
                            {{on "pointerdown" this.swallow}}
                            {{on "click" (fn this.toggleDiet guest diet.id)}}
                          >{{diet.label}}</button>
                        {{/each}}
                      </div>

                      <div class="tp-line">
                        <input
                          class="tp-field"
                          placeholder="anything else"
                          value={{guest.note}}
                          aria-label="Other notes for {{guest.name}}"
                          {{on "pointerdown" this.swallow}}
                          {{on "input" (fn this.setNote guest)}}
                        />
                        <span class="tp-phone">{{guest.phone}}</span>
                      </div>
                    </div>
                  {{/if}}
                </div>
              </article>
            </li>
          {{else}}
            <li class="tp-empty">nobody left on the list</li>
          {{/each}}
        </ol>

        <div class="tp-tables">
          {{#each this.tables key="id" as |table|}}
            <section
              class={{this.tableClass table.id}}
              {{this.bindTable table.id}}
            >
              <div class="tp-table-head">
                <span>{{table.name}}</span>
                <small>{{this.freeAt table.id}}</small>
              </div>

              <ul class="tp-seats">
                {{#each (this.seatedAt table.id) key="id" as |guest|}}
                  {{! A chair is draggable too, and it is the whole pill rather
                      than a tab on it — there is no form in here to protect, so
                      there is nothing to take the pointer back from. The same
                      element being a drag handle when it has no content of its
                      own, and needing a separate one when it does, is the
                      clearest way to say what `dragListener` is for. }}
                  <li
                    class={{this.seatClass guest.id}}
                    {{motion
                      drag=true
                      dragSnapToOrigin=true
                      dragTransition=(tuneObject "grip" RETURN "dragTransition")
                      initial=SEAT_IN
                      animate=SEAT_HERE
                      transition=(tuneMotion "grip" SEAT_SPRING "SEAT_SPRING")
                      onPanSessionStart=this.session
                      onDragStart=(fn this.hoist guest.id)
                      onDrag=this.track
                      onDragEnd=(fn this.drop guest)
                    }}
                  >
                    <span>{{guest.name}}</span>
                  </li>
                {{/each}}
              </ul>

              {{#if (this.feudAt table.id)}}
                <p class="tp-wrong">Nadia and Raj do not speak.</p>
              {{/if}}
            </section>
          {{/each}}
        </div>
      </div>
    </div>
  </template>
}

export default Grip;

// Declare the demo variables before the first interactive Choreo pass.
tuneObject('grip', RETURN, 'dragTransition');
tuneMotion('grip', SEAT_SPRING, 'SEAT_SPRING');
