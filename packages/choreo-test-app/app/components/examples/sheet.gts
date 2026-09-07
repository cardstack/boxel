import type { TOC } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { layoutChange, motion, Presence } from 'glimmer-motion';
import { tuneMotion, tuneNumber } from 'test-app/lib/demo-tuning';
import { preventSelect } from 'test-app/lib/pointer';

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
    }
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
    <div class="ex no-select" {{on "selectstart" preventSelect}}>
      <div class="sheet-app">
        <div class="sheet-behind">
          <span class="sheet-crumb">Kiln floor</span>
          <b>Pour log</b>
          <small>18 entries · shift C</small>
        </div>

        <button
          type="button"
          class="sheet-scrim"
          aria-label="Close"
          tabindex={{if this.isApp "0" "-1"}}
          {{motion
            animate=this.scrim
            transition=(tuneMotion "sheet" fade "fade")
          }}
          {{on "click" this.close}}
        ></button>

        <div
          class="sheet is-{{this.mode}}"
          {{motion
            initial=this.docked
            animate=this.pose
            transition=(tuneMotion "sheet" settle "settle")
            drag="y"
            dragConstraints=this.limits
            dragElastic=(tuneNumber "sheet" 0.05 "dragElastic")
            dragMomentum=false
            onDragStart=this.grab
            onDragEnd=this.land
          }}
        >
          <button type="button" class="sheet-grab" {{on "click" this.step}}>
            <span class="sheet-bar"></span>
          </button>

          <p class="share-title">Share pour log</p>

          {{! the same four buttons in every mode. Nothing here is conditional —
              the class changes the layout and layout=true animates the
              difference between the two measurements. }}
          <div class="share-tiles">
            {{#each targets as |t|}}
              <button
                type="button"
                class="share-tile is-{{t.id}}"
                {{motion
                  layout=true
                  transition=(tuneMotion "sheet" settle "settle")
                }}
              >
                <span class="share-mark" {{motion layout="position"}}>
                  <Glyph @name={{t.glyph}} />
                </span>
                <span class="share-copy" {{motion layout="position"}}>
                  <b>{{t.label}}</b>
                  <small>{{t.note}}</small>
                </span>
              </button>
            {{/each}}
          </div>

          {{! only the app has these, so they get a real entrance and exit }}
          <div class="share-extras">
            <Presence
              @items={{this.appOnly}}
              @key={{keyOf}}
              @initial={{false}}
              as |row h|
            >
              <button
                type="button"
                class="share-extra"
                {{motion
                  presence=h
                  initial=enters
                  animate=here
                  exit=leaves
                  transition=(tuneMotion "sheet" fade "fade")
                }}
              >{{row.label}}</button>
            </Presence>
          </div>
        </div>
      </div>

      <p class="sheet-hint">Drag the sheet · flick it · or click the bar</p>
    </div>
  </template>
}

interface GlyphSignature {
  Args: { name: string };
  Element: SVGElement;
}

/** the marks, drawn once and re-laid-out by whichever mode is showing */
const Glyph: TOC<GlyphSignature> = <template>
  {{#if (is @name "drop")}}
    <svg viewBox="0 0 24 24" aria-hidden="true"><path
        d="M12 15.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM8.5 10a5 5 0 0 1 7 0M5.5 6.8a9.5 9.5 0 0 1 13 0"
      /></svg>
  {{else if (is @name "chat")}}
    <svg viewBox="0 0 24 24" aria-hidden="true"><path
        d="M5 6.5h14v9H12l-4.5 3.2v-3.2H5v-9z"
      /></svg>
  {{else if (is @name "mail")}}
    <svg viewBox="0 0 24 24" aria-hidden="true"><path
        d="M4.5 6.5h15v11h-15v-11zm0 .8 7.5 5.6 7.5-5.6"
      /></svg>
  {{else}}
    <svg viewBox="0 0 24 24" aria-hidden="true"><path
        d="M10.2 13.8a3.5 3.5 0 0 0 5 0l2.6-2.6a3.5 3.5 0 0 0-5-5l-.9.9m-1.1 2.1a3.5 3.5 0 0 0-5 0l-2.6 2.6a3.5 3.5 0 0 0 5 5l.9-.9"
      /></svg>
  {{/if}}
</template>;

function is(name: string, wanted: string) {
  return name === wanted;
}
