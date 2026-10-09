import type { TOC } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { layoutChange, motion, Presence } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { preventSelect } from '../lib/pointer';
import { tuneMotion, tuneNumber } from '../lib/tuning';
import SheetNotes from '../notes/sheet';

/**
 * Four detents, and the detent IS the mode. How far the sheet is pulled decides
 * what a share target IS: a card in a stack, an icon in a row, a menu line, or
 * a full row in an app.
 */
const DETENTS = { app: 0, icons: 170, rows: 80, sliver: 242 } as const;
type Mode = keyof typeof DETENTS;
const ORDER: Mode[] = ['sliver', 'icons', 'rows', 'app'];

const settle = { bounce: 0.18, type: 'spring', visualDuration: 0.44 } as const;
const fade = { duration: 0.2, ease: 'easeOut' } as const;

/** how far a throw is allowed to carry past the finger, in seconds of travel */
const PROJECTION = 0.16;

const targets = [
  { glyph: 'drop', id: 'drop', label: 'AirDrop', note: 'Nearby' },
  { glyph: 'chat', id: 'chat', label: 'Message', note: 'Runtime' },
  { glyph: 'mail', id: 'mail', label: 'Mail', note: 'Foundry list' },
  { glyph: 'link', id: 'link', label: 'Copy link', note: 'Read only' },
] as const;

const extras = [
  { id: 'x1', label: 'Add to shift log' },
  { id: 'x2', label: 'Export CSV' },
];

const keyOf = (item: { id: string }) => item.id;
/** one array, not a fresh one per read: <Presence> diffs by identity, and a
 *  new [] on every render is a new diff on every render */
const NONE: typeof extras = [];
const enters = { opacity: 0, y: 14 };
const here = { opacity: 1, y: 0 };
const leaves = { opacity: 0, y: 10 };

/**
 * A share sheet where the gesture and the layout are the same story.
 *
 * While the finger is down, `drag="y"` owns `y` and the sheet is exactly where
 * the pointer put it. On release the gesture hands that value back: `animate`
 * is bound to the resting position of whichever detent won, and the spring
 * carries it the rest of the way. Same element, same value, no remount.
 *
 * Which detent wins is not the one nearest where the finger STOPPED — it is the
 * one nearest where the throw was GOING. `onDragEnd` hands you the velocity;
 * project a sixth of a second of it past the release point and pick from there.
 *
 * Everything above the fold is one set of four elements. They are never
 * re-created, only re-laid-out: the mode changes a class, the class changes the
 * CSS, and `layout=true` turns the resulting measurement change into the
 * animation. Stacked deck → row of icons → menu lines → app rows, all of it the
 * same four buttons the whole way.
 */
export class Sheet extends Component {
  @tracked mode: Mode = 'sliver';
  private startedAt: number = DETENTS.sliver;

  /** the detents bound the drag, so the constraint is plain px — no ref needed */
  limits = { bottom: DETENTS.sliver, top: DETENTS.app };
  docked = { y: DETENTS.sliver };

  get pose() {
    return { y: DETENTS[this.mode] };
  }

  get scrim() {
    return { opacity: this.mode === 'app' ? 0.62 : 0 };
  }

  get isApp() {
    return this.mode === 'app';
  }

  get appOnly() {
    return this.isApp ? extras : NONE;
  }

  /**
   * Every mode change is a layout change, and someone has to say so.
   *
   * The tiles travel between modes on `layout=true`, which needs a measurement
   * from BEFORE the class changed. React's Motion takes that snapshot for
   * every projecting node on every commit; here it is asked for, and the
   * things that ask are <LayoutGroup>, <Presence>, <Choreo> and
   * <ReorderGroup>. On its own page this card has none of them above it, so
   * nothing measured the old layout and the tiles arrived already in place. In
   * the gallery there is a <LayoutGroup> around the grid — which is the whole
   * of why the same card tweened there and snapped here.
   */
  private toMode(next: Mode) {
    layoutChange(() => {
      this.mode = next;
    });
  }

  grab = () => {
    this.startedAt = DETENTS[this.mode];
  };

  /** where the throw was going, not where the finger stopped */
  land = (
    _event: unknown,
    info: {
      offset: { x: number; y: number };
      velocity: { x: number; y: number };
    },
  ) => {
    const released = this.startedAt + info.offset.y;
    const projected = released + info.velocity.y * PROJECTION;
    let best: Mode = ORDER[0]!;
    for (const name of ORDER) {
      if (
        Math.abs(DETENTS[name] - projected) <
        Math.abs(DETENTS[best] - projected)
      ) {
        best = name;
      }
    }
    this.toMode(best);
  };

  /** a click is a flick with no distance: it steps to the next mode */
  step = () => {
    const next = ORDER.indexOf(this.mode) + 1;
    this.toMode(ORDER[next % ORDER.length]!);
  };

  close = () => {
    this.toMode('sliver');
  };

  <template>
    <div class='ex no-select' {{on 'selectstart' preventSelect}}>
      <div class='sheet-app'>
        <div class='sheet-behind'>
          <span class='sheet-crumb'>Kiln floor</span>
          <b>Pour log</b>
          <small>18 entries · shift C</small>
        </div>

        <button
          type='button'
          class='sheet-scrim'
          aria-label='Close'
          tabindex={{if this.isApp '0' '-1'}}
          {{motion
            animate=this.scrim
            transition=(tuneMotion 'sheet' fade 'fade')
          }}
          {{on 'click' this.close}}
        ></button>

        <div
          class='sheet is-{{this.mode}}'
          {{motion
            initial=this.docked
            animate=this.pose
            transition=(tuneMotion 'sheet' settle 'settle')
            drag='y'
            dragConstraints=this.limits
            dragElastic=(tuneNumber 'sheet' 0.05 'dragElastic')
            dragMomentum=false
            onDragStart=this.grab
            onDragEnd=this.land
          }}
        >
          <button type='button' class='sheet-grab' {{on 'click' this.step}}>
            <span class='sheet-bar'></span>
          </button>

          <p class='share-title'>Share pour log</p>

          {{! the same four buttons in every mode. Nothing here is conditional —
              the class changes the layout and layout=true animates the
              difference between the two measurements. }}
          <div class='share-tiles'>
            {{#each targets as |t|}}
              <button
                type='button'
                class='share-tile is-{{t.id}}'
                {{motion
                  layout=true
                  transition=(tuneMotion 'sheet' settle 'settle')
                }}
              >
                <span class='share-mark' {{motion layout='position'}}>
                  <Glyph @name={{t.glyph}} />
                </span>
                <span class='share-copy' {{motion layout='position'}}>
                  <b>{{t.label}}</b>
                  <small>{{t.note}}</small>
                </span>
              </button>
            {{/each}}
          </div>

          {{! only the app has these, so they get a real entrance and exit }}
          <div class='share-extras'>
            <Presence
              @items={{this.appOnly}}
              @key={{keyOf}}
              @initial={{false}}
              as |row h|
            >
              <button
                type='button'
                class='share-extra'
                {{motion
                  presence=h
                  initial=enters
                  animate=here
                  exit=leaves
                  transition=(tuneMotion 'sheet' fade 'fade')
                }}
              >{{row.label}}</button>
            </Presence>
          </div>
        </div>
      </div>

      <p class='sheet-hint'>Drag the sheet · flick it · or click the bar</p>
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

      .no-select,
      .no-select * {
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }

      /* column and legend read as one block; the default grid stage would spread
         them to opposite ends of the card */
      .ex:has(.sheet-app) {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 56px 16px 18px;
      }

      /* ---- Sheet ---- */

      .sheet-app {
        position: relative;
        width: min(88cqw, 300px);
        height: min(78cqh, 390px);
        overflow: hidden;
        border: 1px solid var(--line-strong);
        border-radius: 24px;
        background: var(--bg-well);
      }

      .sheet-behind {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 20px 20px 0;
      }

      .sheet-crumb {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .sheet-behind b {
        font-family: var(--font-display);
        font-size: 22px;
      }

      .sheet-behind small {
        font-size: 11px;
        color: var(--ink-dim);
      }

      .sheet-scrim {
        position: absolute;
        inset: 0;
        z-index: 1;
        border: 0;
        padding: 0;
        background: var(--bg);
        opacity: 0;
        cursor: pointer;
      }

      /* one sheet at one height; the detent is how far down it rests */
      .sheet {
        position: absolute;
        z-index: 2;
        left: 0;
        right: 0;
        bottom: 0;
        height: 320px;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--line-strong);
        border-bottom: 0;
        border-radius: 20px 20px 0 0;
        background: var(--bg-spot);
        box-shadow: 0 -14px 40px
          rgba(var(--shadow-rgb), calc(0.55 * var(--shadow-a)));
        touch-action: none;
        cursor: grab;
        overflow: hidden;
      }

      /* --bg-spot is the lightest rung of the ladder — reads as its own elevated
         surface against the darker things around it in dark mode, and as
         featureless white in light mode, where "elevated" needing to mean
         "even brighter than an already-bright page" runs out of room */
      .choreo-site[data-theme='light'] .sheet {
        background: var(--bg);
        border-color: var(--line);
      }

      .sheet:active {
        cursor: grabbing;
      }

      .sheet-grab {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        height: 26px;
        border: 0;
        background: none;
        cursor: inherit;
      }

      .sheet-bar {
        width: 40px;
        height: 4px;
        border-radius: 999px;
        background: var(--line-strong);
      }

      /* the title belongs to every mode that has room for one */
      .share-title {
        flex: none;
        margin: 0 0 8px;
        padding: 0 16px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .sheet.is-sliver .share-title {
        display: none;
      }

      /* ---- the four targets, in four shapes ---- */

      .share-tiles {
        display: flex;
        flex: none;
        padding: 0 14px;
      }

      .share-tile {
        display: flex;
        align-items: center;
        border: 1px solid var(--line);
        background: var(--bg-spot);
        color: var(--ink);
        cursor: pointer;
        overflow: hidden;
      }

      .share-mark {
        display: grid;
        place-items: center;
        flex: none;
      }

      .share-mark :deep(svg) {
        width: 20px;
        height: 20px;
        fill: none;
        stroke: var(--copper);
        stroke-width: 1.6;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .share-copy {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
        text-align: left;
      }

      .share-copy b {
        font-family: var(--font-display);
        font-size: 13px;
        white-space: nowrap;
      }

      .share-copy small {
        font-size: 10px;
        color: var(--ink-dim);
        white-space: nowrap;
      }

      /* sliver: a stacked deck, which reads as one share mark */
      .sheet.is-sliver .share-tiles {
        justify-content: center;
        gap: 0;
      }

      .sheet.is-sliver .share-tile {
        width: 40px;
        height: 40px;
        justify-content: center;
        border-radius: 12px;
        margin-right: -27px;
        box-shadow: 0 4px 14px
          rgba(var(--shadow-rgb), calc(0.6 * var(--shadow-a)));
      }

      .sheet.is-sliver .share-tile:last-child {
        margin-right: 0;
      }

      .sheet.is-sliver .share-tile.is-drop {
        rotate: -9deg;
      }

      .sheet.is-sliver .share-tile.is-chat {
        rotate: -3deg;
      }

      .sheet.is-sliver .share-tile.is-mail {
        rotate: 3deg;
      }

      .sheet.is-sliver .share-tile.is-link {
        rotate: 9deg;
      }

      .sheet.is-sliver .share-copy {
        display: none;
      }

      /* icons: the deck fans out into a row */
      .sheet.is-icons .share-tiles {
        justify-content: space-between;
        gap: 10px;
      }

      .sheet.is-icons .share-tile {
        width: 58px;
        height: 58px;
        justify-content: center;
        border-radius: 16px;
      }

      .sheet.is-icons .share-copy {
        display: none;
      }

      /* rows: the icons become menu lines */
      .sheet.is-rows .share-tiles,
      .sheet.is-app .share-tiles {
        flex-direction: column;
        gap: 6px;
      }

      .sheet.is-rows .share-tile,
      .sheet.is-app .share-tile {
        width: 100%;
        gap: 12px;
        padding: 7px 12px;
        border-radius: 12px;
      }

      .sheet.is-rows .share-mark,
      .sheet.is-app .share-mark {
        width: 22px;
        height: 22px;
        border-radius: 9px;
        background: var(--bg-spot);
      }

      /* app: the same rows, with everything an app has around them */
      .sheet.is-app .share-tile {
        padding: 9px 12px;
      }

      .share-extras {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px 14px 0;
        overflow: hidden;
      }

      .share-extra {
        padding: 7px 12px;
        border: 0;
        border-radius: 10px;
        background: none;
        color: var(--ink-dim);
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        text-align: left;
        cursor: pointer;
      }

      @media (hover: hover) {
        .share-extra:hover {
          color: var(--ink);
          background: var(--bg-spot);
        }
      }

      .sheet-hint {
        margin: 12px 0 0;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }
      @media (max-width: 720px) {
        /* The phone has to BE a phone.
           At the shared 78cqh cap this box came out 272x371 on a handset — a 0.73
           ratio, nearly square — and the expanded detent is a fixed 320px, so the
           sheet swallowed 86% of the screen it was supposedly sliding up inside and
           the content above it was cropped away. Portrait gives the detents
           somewhere to be, which is the entire point of the demo.
           (Must live after the base rule: same specificity, so source order is what
           decides which cap wins.) */
        .sheet-app {
          height: min(96cqh, 560px);
        }
      }

      .choreo-site:not([data-theme='light']) .sheet-app {
        background: #2a2521;
      }

      .choreo-site:not([data-theme='light']) .sheet {
        background: #322c27;
      }

      .choreo-site:not([data-theme='light']) .share-tile {
        background: #312c27;
      }

      .choreo-site:not([data-theme='light']) .sheet.is-rows .share-mark,
      .choreo-site:not([data-theme='light']) .sheet.is-app .share-mark {
        background: #403830;
      }

      @media (hover: hover) {
        .choreo-site:not([data-theme='light']) .share-extra:hover {
          background: #403830;
        }
      }

      .choreo-site:not([data-theme='light']) .sheet-scrim {
        background: #1a1613;
      }
    </style>
  </template>
}

interface GlyphSignature {
  Args: { name: string };
  Element: SVGElement;
}

/** the marks, drawn once and re-laid-out by whichever mode is showing */
const Glyph: TOC<GlyphSignature> = <template>
  {{#if (is @name 'drop')}}
    <svg viewBox='0 0 24 24' aria-hidden='true'><path
        d='M12 15.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM8.5 10a5 5 0 0 1 7 0M5.5 6.8a9.5 9.5 0 0 1 13 0'
      /></svg>
  {{else if (is @name 'chat')}}
    <svg viewBox='0 0 24 24' aria-hidden='true'><path
        d='M5 6.5h14v9H12l-4.5 3.2v-3.2H5v-9z'
      /></svg>
  {{else if (is @name 'mail')}}
    <svg viewBox='0 0 24 24' aria-hidden='true'><path
        d='M4.5 6.5h15v11h-15v-11zm0 .8 7.5 5.6 7.5-5.6'
      /></svg>
  {{else}}
    <svg viewBox='0 0 24 24' aria-hidden='true'><path
        d='M10.2 13.8a3.5 3.5 0 0 0 5 0l2.6-2.6a3.5 3.5 0 0 0-5-5l-.9.9m-1.1 2.1a3.5 3.5 0 0 0-5 0l-2.6 2.6a3.5 3.5 0 0 0 5 5l.9-.9'
      /></svg>
  {{/if}}
</template>;

function is(name: string, wanted: string) {
  return name === wanted;
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('sheet', fade, 'fade');
tuneMotion('sheet', settle, 'settle');
tuneNumber('sheet', 0.05, 'dragElastic');

export class SheetDemo extends GalleryDemo {
  static stage = Sheet;
  static notes = SheetNotes;
}
