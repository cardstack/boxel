import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion } from 'glimmer-motion';

/**
 * A fake "Notes" screen for the phone mockup. Fills a 390 x 844 screen box
 * that the caller already owns; this component only paints the inside.
 *
 * Both interactions move every card below the one you touched — opening a
 * note pushes its neighbours down, pinning one lifts it out of the middle of
 * the list — so the list is a <Choreo> region and the cards are its
 * participants. One `c.Move` on `c.moved "card"` carries whichever cards
 * changed seats, whatever caused it; the body of the opened note fades in
 * over the same span.
 *
 * Hue 140 is the Notes app's slot on the mockup home screen's colour wheel.
 */
interface Note {
  body: string[];
  date: string;
  id: string;
  snippet: string;
  title: string;
}

/** the cards only ever change seats, so this is a short, tight spring */
const seat = { damping: 26, stiffness: 320 };

const NOTES: Note[] = [
  {
    body: [
      'Open on the folder list, not the last note. The list is the map; the note is the destination.',
      'Pinned rows keep their own order. Promotion is a move, never a re-sort of everything.',
      'Long titles truncate at one line. Two-line titles make the list breathe wrong.',
    ],
    date: 'Yesterday',
    id: 'shape',
    snippet: 'Open on the folder list, not the last note. The list is the map…',
    title: 'Shape of the list',
  },
  {
    body: [
      'Sourdough at 8am, second rise until noon.',
      'Ask Dana to bring the flat bread and the good olives.',
      'Six chairs, seven people — the piano bench counts.',
    ],
    date: 'Yesterday',
    id: 'dinner',
    snippet: 'Sourdough at 8am, second rise until noon. Ask Dana to bring…',
    title: 'Dinner, Saturday',
  },
  {
    body: [
      'The measure happens before paint, so a read after a write costs a whole frame.',
      'Batch the reads. Then batch the writes. Never interleave.',
      'If it stutters on a 120Hz panel it is a layout thrash, not a slow curve.',
    ],
    date: 'Tue',
    id: 'frames',
    snippet: 'The measure happens before paint, so a read after a write costs…',
    title: 'Frames and reads',
  },
  {
    body: [
      'Ferry at 7:40, the early one, otherwise the harbour road is closed.',
      'Two nights at the blue house. Key is with the neighbour.',
      'Bring the wide lens and nothing else.',
    ],
    date: 'Mon',
    id: 'trip',
    snippet: 'Ferry at 7:40, the early one, otherwise the harbour road is…',
    title: 'North coast trip',
  },
  {
    body: [
      'Rent, utilities, the boring standing orders — all first of the month.',
      'Cancel the storage unit. It has been empty since March.',
      'Move the rest into the joint account on payday.',
    ],
    date: 'Aug 21',
    id: 'money',
    snippet: 'Rent, utilities, the boring standing orders — all first of the…',
    title: 'Standing orders',
  },
  {
    body: [
      'Warm grey walls, one wall in the deep green, trim left white.',
      'The shelf goes on the short wall so the window keeps its light.',
      'Order the long screws. The short ones were a mistake twice.',
    ],
    date: 'Aug 18',
    id: 'room',
    snippet: 'Warm grey walls, one wall in the deep green, trim left white…',
    title: 'Back room, paint',
  },
];

interface NotesAppSignature {
  Element: HTMLDivElement;
}

export class NotesApp extends Component<NotesAppSignature> {
  /** id of the one open card, or null when the list is all collapsed */
  @tracked openId: string | null = null;
  /** ids of pinned notes; reassigned rather than mutated so tracking fires */
  @tracked pinnedIds: string[] = ['frames'];

  /** pinned rows ride at the top, each group otherwise keeping source order */
  get ordered(): Note[] {
    const pinned = NOTES.filter((note) => this.pinnedIds.includes(note.id));
    const rest = NOTES.filter((note) => !this.pinnedIds.includes(note.id));
    return [...pinned, ...rest];
  }

  get countLabel(): string {
    const pins = this.pinnedIds.length;
    if (pins === 0) {
      return `${NOTES.length} notes`;
    }
    return `${NOTES.length} notes · ${pins} pinned`;
  }

  /** accordion: opening one closes whatever else was open */
  toggleOpen = (id: string): void => {
    this.openId = this.openId === id ? null : id;
  };

  togglePin = (id: string, event: MouseEvent): void => {
    // the pin is a sibling of the card's own button, not nested inside it —
    // stop here anyway so a fat-fingered tap cannot do both things at once
    event.stopPropagation();
    if (this.pinnedIds.includes(id)) {
      this.pinnedIds = this.pinnedIds.filter((pinned) => pinned !== id);
    } else {
      this.pinnedIds = [...this.pinnedIds, id];
    }
  };

  <template>
    <div class="notes-app" ...attributes>
      <div class="notes-status">
        <span class="notes-status-time">9:41</span>
        <span class="notes-status-right">
          <span class="notes-status-bar notes-status-bar-a"></span>
          <span class="notes-status-bar notes-status-bar-b"></span>
          <span class="notes-status-bar notes-status-bar-c"></span>
          <span class="notes-status-battery"></span>
        </span>
      </div>

      <div class="notes-head">
        <div class="notes-crumb">All iCloud</div>
        <h1 class="notes-title">Notes</h1>
        <div class="notes-count">{{this.countLabel}}</div>
      </div>

      <Choreo class="notes-list" as |c|>
        {{#each this.ordered key="id" as |note|}}
          <div
            class="notes-card {{cardState note.id this.openId this.pinnedIds}}"
            {{motion id=note.id role="card"}}
          >
            <button
              type="button"
              class="notes-card-main"
              {{on "click" (fn this.toggleOpen note.id)}}
            >
              <span class="notes-card-title">{{note.title}}</span>
              <span class="notes-card-meta">
                <span class="notes-card-date">{{note.date}}</span>
                <span class="notes-card-snippet">{{note.snippet}}</span>
              </span>
            </button>

            <button
              type="button"
              class="notes-pin"
              {{on "click" (fn this.togglePin note.id)}}
            >
              <span class="notes-pin-glyph"></span>
            </button>

            {{#if (isOpen note.id this.openId)}}
              <div
                class="notes-body"
                {{motion id=(bodyId note.id) role="body"}}
              >
                {{#each note.body key="@index" as |line|}}
                  <p class="notes-body-line">{{line}}</p>
                {{/each}}
              </div>
            {{/if}}
          </div>
        {{/each}}

        {{! One pass, two causes. Opening a note grows its card and pushes the
            rest down; pinning one lifts it past its neighbours. Either way the
            changeset is the same shape — some kept cards changed seats — so a
            single Move covers both, and the body fades in while they travel. }}
        <c.Parallel>
          {{!-- @size={{false}}: the opened card takes its new height at once and
          only the travel is animated. Scaling the box instead would smear the
          title and the body text for the length of the spring. --}}
          <c.Move @of={{c.moved "card"}} @spring={{seat}} @size={{false}} />
          <c.Tween
            @of={{c.inserted "body"}}
            @opacity={{array 0 1}}
            @delay={{0.05}}
            @duration={{0.26}}
          />
        </c.Parallel>
      </Choreo>

      <div class="notes-bar">
        <span class="notes-bar-note">{{this.countLabel}}</span>
        <span class="notes-bar-new"></span>
      </div>

      <div class="notes-home"></div>
    </div>

    <style>
      .notes-app {
        position: absolute;
        inset: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        background:
          radial-gradient(
            120% 60% at 50% 0%,
            hsl(140 30% 14%) 0%,
            hsl(140 22% 8%) 60%,
            hsl(140 20% 6%) 100%
          ),
          hsl(140 20% 6%);
        color: hsl(140 12% 95%);
        font-family:
          ui-sans-serif,
          -apple-system,
          "SF Pro Text",
          system-ui,
          sans-serif;
        -webkit-font-smoothing: antialiased;
        user-select: none;
        -webkit-user-select: none;
      }

      .notes-status {
        flex: none;
        height: 54px;
        padding: 16px 30px 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .notes-status-time {
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.2px;
        color: hsl(140 12% 96%);
      }

      .notes-status-right {
        display: flex;
        align-items: flex-end;
        gap: 3px;
      }

      .notes-status-bar {
        width: 3px;
        border-radius: 1px;
        background: hsl(140 12% 90%);
      }

      .notes-status-bar-a {
        height: 5px;
      }

      .notes-status-bar-b {
        height: 8px;
      }

      .notes-status-bar-c {
        height: 11px;
      }

      .notes-status-battery {
        width: 22px;
        height: 11px;
        margin-left: 5px;
        border-radius: 3px;
        border: 1px solid hsl(140 10% 70%);
        background: linear-gradient(
          to right,
          hsl(140 12% 90%) 0 70%,
          transparent 70% 100%
        );
      }

      .notes-head {
        flex: none;
        padding: 6px 22px 12px;
      }

      .notes-crumb {
        font-size: 13px;
        font-weight: 500;
        color: hsl(140 45% 60%);
        letter-spacing: 0.1px;
      }

      .notes-title {
        margin: 4px 0 0;
        font-size: 30px;
        line-height: 34px;
        font-weight: 700;
        letter-spacing: -0.6px;
        color: hsl(140 10% 97%);
      }

      .notes-count {
        margin-top: 3px;
        font-size: 13px;
        color: hsl(140 8% 55%);
      }

      .notes-list {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 2px 16px 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        scrollbar-width: none;
      }

      .notes-list::-webkit-scrollbar {
        display: none;
      }

      .notes-card {
        position: relative;
        flex: none;
        border-radius: 14px;
        background: hsl(140 16% 12%);
        border: 1px solid hsl(140 16% 18%);
        transition:
          background 180ms ease,
          border-color 180ms ease;
      }

      .notes-card-pinned {
        background: hsl(140 20% 14%);
        border-color: hsl(140 30% 26%);
      }

      .notes-card-open {
        background: hsl(140 22% 16%);
        border-color: hsl(140 40% 34%);
      }

      .notes-card-main {
        display: block;
        width: 100%;
        margin: 0;
        padding: 13px 46px 13px 15px;
        border: 0;
        background: transparent;
        text-align: left;
        font: inherit;
        color: inherit;
        cursor: pointer;
        appearance: none;
      }

      .notes-card-title {
        display: block;
        font-size: 17px;
        line-height: 21px;
        font-weight: 600;
        letter-spacing: -0.2px;
        color: hsl(140 10% 96%);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .notes-card-meta {
        display: flex;
        align-items: baseline;
        gap: 7px;
        margin-top: 3px;
      }

      .notes-card-date {
        flex: none;
        font-size: 14px;
        line-height: 18px;
        color: hsl(140 8% 52%);
      }

      .notes-card-snippet {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 14px;
        line-height: 18px;
        color: hsl(140 7% 62%);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .notes-pin {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 28px;
        height: 28px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        border: 1px solid hsl(140 14% 24%);
        background: hsl(140 14% 16%);
        cursor: pointer;
        appearance: none;
        transition:
          background 160ms ease,
          border-color 160ms ease;
      }

      .notes-card-pinned .notes-pin {
        background: hsl(140 55% 42%);
        border-color: hsl(140 60% 52%);
      }

      .notes-pin-glyph {
        width: 9px;
        height: 9px;
        border-radius: 2px 2px 2px 6px;
        transform: rotate(45deg);
        background: hsl(140 10% 55%);
        transition: background 160ms ease;
      }

      .notes-card-pinned .notes-pin-glyph {
        background: hsl(140 30% 12%);
      }

      .notes-body {
        margin: 0 15px;
        padding: 0 0 14px;
        border-top: 1px solid hsl(140 20% 22%);
      }

      .notes-body-line {
        margin: 10px 0 0;
        font-size: 14px;
        line-height: 20px;
        color: hsl(140 8% 74%);
      }

      .notes-bar {
        flex: none;
        height: 52px;
        padding: 0 22px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-top: 1px solid hsl(140 18% 14%);
        background: hsl(140 22% 9%);
      }

      .notes-bar-note {
        font-size: 12px;
        color: hsl(140 8% 50%);
      }

      .notes-bar-new {
        width: 26px;
        height: 26px;
        border-radius: 8px;
        background: hsl(140 55% 45%);
        box-shadow: 0 0 0 4px hsl(140 40% 20% / 0.5);
      }

      .notes-home {
        flex: none;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: hsl(140 22% 9%);
      }

      .notes-home::after {
        content: "";
        width: 134px;
        height: 5px;
        border-radius: 3px;
        background: hsl(140 10% 78%);
      }
    </style>
  </template>
}

function isOpen(id: string, openId: string | null): boolean {
  return id === openId;
}

/** the two state classes in one string, so the template stays one attribute */
function cardState(
  id: string,
  openId: string | null,
  pinned: string[]
): string {
  const parts: string[] = [];
  if (id === openId) {
    parts.push('notes-card-open');
  }
  if (pinned.includes(id)) {
    parts.push('notes-card-pinned');
  }
  return parts.join(' ');
}

/** the body carries its own Choreo identity so a step can select it alone */
function bodyId(id: string): string {
  return `${id}-body`;
}

export default NotesApp;
