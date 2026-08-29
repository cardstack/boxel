import { concat, fn, get } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import {
  Choreo,
  type ChoreoContext,
  createArming,
  motion,
  styles,
} from 'glimmer-motion';
import type { Sprite } from 'glimmer-motion';
import {
  DateField,
  EmailField,
  TextField,
} from 'test-app/components/pretui/fields';
import {
  layoutWords,
  type TypeScale,
  typeReady,
} from 'test-app/lib/word-layout';

/**
 * `date` and `email` rather than a component reference, and the template
 * branches on them. A list of component classes reads better right up until
 * you type it: the three differ in their root element — two inputs and a
 * group — so a union of the classes is not invokable, and the cast that
 * would make it invokable is a lie about three genuinely different shapes.
 */
const FIELDS = [
  { date: false, email: false, key: 'name', label: 'Name', role: 'name-value' },
  { date: false, email: true, key: 'email', label: 'Email', role: 'sub-value' },
  {
    date: true,
    email: false,
    key: 'dob',
    label: 'Date of birth',
    role: 'sub-value',
  },
] as const;

type Key = (typeof FIELDS)[number]['key'];

const MOVE = 0.55;

/**
 * Soft in, soft out.
 *
 * The rest of the gallery leaves the line at full speed — `[0.22, 1, 0.36,
 * 1]`, all deceleration — which suits a card being thrown across a stage.
 * Nothing here is thrown. A record turning into a form is a considered act,
 * and type that starts moving instantly reads as a jump cut no matter how
 * gently it lands. This eases in as well as out.
 */
const EASE = [0.4, 0, 0.2, 1] as const;
const BOX = 0.42;

/**
 * The form comes apart faster than it assembles, and the number is not free.
 *
 * The departing control's text and the flight word are the same pixels at
 * the instant of the swap, so they can be crossfaded — but only while they
 * are still in the same place. This is the window in which the word fades up
 * and the form fades out, and it has to close before the word has travelled
 * far enough for the pair to read as two.
 */
const LEAVE = 0.18;
const FADE_IN = [0, 1];
const FADE_OUT = [1, 0];

/* ── the two layers ──────────────────────────────────────────────────────
 *
 * BACKGROUND. Boxes with borders, and they are a containment hierarchy: the
 * white card holds three beige platters, one per field, each in its own lane.
 * The lanes are in the same order in both poses and a platter never leaves
 * its own, so no box ever crosses another — they only grow, shrink and slide
 * along their lane while the card changes height around them. That is the
 * whole rule for this layer, and the reason the layout below is a single
 * column even though the reading view does not look like one.
 *
 * FOREGROUND. The type, and nothing else. It is a layer over the card rather
 * than content inside the platters, so it is not laid out by anything and not
 * clipped by anything, and it is free to cross. That freedom is what lets the
 * reading view put email and date of birth on ONE line while their platters
 * sit in two separate lanes underneath: the words fly diagonally across a
 * lane boundary that the boxes never touch.
 *
 * Which is why the type carries everything itself — position, size, weight,
 * kerning — all of it from pretext, and none of it inherited from a box it
 * is no longer inside.
 */

/** the card's own padding, and the gutter between lanes */
const PAD = 18;
const GAP = 8;

/**
 * Lane heights, in order, per pose. The same five lanes in the same order in
 * both, which is what makes crossing impossible rather than merely unlikely.
 * These must agree with the row templates in the stylesheet; the two tests
 * that pin the type against the real controls and the real reading string
 * are what catch it if they ever drift.
 */
const LANES = {
  edit: { dob: 56, email: 56, head: 36, name: 56, rule: 1 },
  view: { dob: 22, email: 22, head: 88, name: 44, rule: 1 },
} as const;

const ORDER = ['head', 'rule', 'name', 'email', 'dob'] as const;

/** the top of each lane, in the card's padding-box coordinates */
function lanes(pose: 'edit' | 'view') {
  const out = {} as Record<
    (typeof ORDER)[number],
    { height: number; top: number }
  >;
  let top = 0;
  for (const name of ORDER) {
    const height = LANES[pose][name];
    out[name] = { height, top };
    top += height + GAP;
  }
  return out;
}

/** a platter is 40px tall and sits at the bottom of its lane, in the form */
const PLATE_H = 40;

/** 1px of border, then the control's own padding, then the first glyph */
const BORDER = 1;
const INSET = 11;

/**
 * The date field is segmented — day, month, year — so its three controls
 * have three separate text origins rather than one flowed line. These are
 * the widths the stylesheet gives them, and they live here because the
 * flight has to know where "14", "March" and "1986" are going before any of
 * those controls exist.
 */
const SEGMENT = { day: 32, gap: 6, month: 104 };
const DATE_X = [
  0,
  SEGMENT.day + SEGMENT.gap,
  SEGMENT.day + SEGMENT.gap + SEGMENT.month + SEGMENT.gap,
].map((offset) => BORDER + INSET + offset);

/**
 * Where the reading view puts the date: on the SAME line as the email, at
 * this offset from the card's left. The one place the two layers disagree on
 * purpose — the boxes keep their lanes, the type does not.
 */
const SUB_SPLIT = 176;

const FAMILY = 'Archivo';
const WORD_GAP = 0.3;

/**
 * 87.5% of Archivo's width axis, said the one way both the canvas and the
 * stylesheet understand. `font-variation-settings: 'wdth' 88` renders the
 * same face but cannot appear in a font shorthand, so pretext would measure
 * the wide cut while the screen drew the narrow one — about thirty pixels of
 * error on a two-word name, all of it in the gaps between the words.
 */
const STRETCH = 'semi-condensed';

const scale = (size: number, weight: number, tracking: number): TypeScale => ({
  family: FAMILY,
  size,
  stretch: STRETCH,
  tracking,
  weight,
  wordGap: WORD_GAP,
});

/** reading: a large bold name over two quiet values */
const VIEW: Record<Key, TypeScale> = {
  dob: scale(13, 500, -0.01),
  email: scale(13, 500, -0.01),
  name: scale(30, 700, -0.03),
};

/** writing: every field the same, because a form's values are one kind of thing */
const EDIT: Record<Key, TypeScale> = {
  dob: scale(17, 400, -0.01),
  email: scale(17, 400, -0.01),
  name: scale(17, 400, -0.01),
};

interface Word {
  id: string;
  word: string;
  editX: number;
  editY: number;
  viewX: number;
  viewY: number;
}

/** a line's origin — first glyph's left, and the line's centre */
interface Origin {
  x: number;
  y: number;
}

function origins(pose: 'edit' | 'view'): Record<Key, Origin> {
  const lane = lanes(pose);
  if (pose === 'edit') {
    // the platter sits at the bottom of its lane; the text sits in the middle
    // of the platter, one border and one padding in from its left
    const centre = (key: Key) => lane[key].top + lane[key].height - PLATE_H / 2;
    return {
      dob: { x: DATE_X[0]!, y: centre('dob') },
      email: { x: BORDER + INSET, y: centre('email') },
      name: { x: BORDER + INSET, y: centre('name') },
    };
  }
  const middle = (key: Key) => lane[key].top + lane[key].height / 2;
  return {
    // the date shares the email's line, and only the type does
    dob: { x: SUB_SPLIT, y: middle('email') },
    email: { x: 0, y: middle('email') },
    name: { x: 0, y: middle('name') },
  };
}

/**
 * Two layers: boxes that nest, and type that flies.
 *
 * A record card in two states. The reading view is a business card; the form
 * is three REAL fields — a text input, an email input, a segmented date group
 * — copied in from pretui rather than depended on, because pretui's own
 * `Input` wraps boxel-ui and its `KnownDate` is six hundred lines with
 * dependencies of its own.
 *
 * THE BACKGROUND IS A HIERARCHY. The white card holds three beige platters,
 * one per field, each in its own lane. The lanes are in the same order in
 * both poses and a platter never leaves its own, so no box crosses another —
 * they grow, shrink and slide along their lane while the card changes height
 * around them. Everything a field IS lives inside its platter: the control,
 * the outline, the fill. The outline cannot escape the platter's bounds for
 * the simple reason that it is the platter's own border.
 *
 * THE FOREGROUND IS TYPE, and it is a layer over the card rather than
 * content inside the platters. Nothing lays it out and nothing clips it, so
 * it is free to cross — which is what lets the reading view put email and
 * date of birth on one line while their platters sit in two separate lanes
 * underneath. The words fly diagonally over a boundary the boxes never touch.
 *
 * That freedom costs the type its inheritance: out of the box, it has to
 * carry position, size, weight and kerning itself. All four come from
 * pretext, which measures text with the browser's own font engine through
 * canvas and lays it out as pure arithmetic — no DOM, no reflow, and no
 * requirement that the pose being measured is the one on screen. Which is
 * the point: the form does not exist while the reading view is up, and in
 * the general case it is not even the same author's component.
 *
 * NO ELEMENT IS IN BOTH POSES, and none can be: a `<span>` in flow and the
 * value of an `<input>` cannot be the same node. So the type hands off —
 * real DOM, then a flight, then real DOM again — and the flight is the only
 * copy of a value for as long as it lasts.
 */
export class InlineEdit extends Component {
  @tracked editing = false;
  @tracked record: Record<Key, string> = {
    dob: '14 March 1986',
    email: 'm.villanueva@kiln.studio',
    name: 'Marguerite Villanueva',
  };

  /**
   * Bumped when the fonts resolve. Canvas measurement is only as good as the
   * face the browser has: ask before Archivo has arrived and every width
   * comes back in the fallback's metrics, which is a whole line of error
   * that never corrects itself.
   */
  @tracked private generation = 0;

  fields = FIELDS;

  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    void typeReady([...Object.values(VIEW), ...Object.values(EDIT)]).then(
      () => {
        this.generation++;
      }
    );
  }

  get initials() {
    return this.record.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('');
  }

  update = (key: Key, value: string) => {
    this.record = { ...this.record, [key]: value };
  };

  /* — the plan: every word, in both poses, neither of them rendered — */

  get plan(): Map<Key, Word[]> {
    // read the generation so a font arriving re-measures everything
    this.generation;
    const view = origins('view');
    const edit = origins('edit');
    const plan = new Map<Key, Word[]>();
    for (const { key } of FIELDS) {
      const words = this.record[key].split(/\s+/).filter(Boolean);
      const viewX = layoutWords(words, VIEW[key], view[key].x).map((b) => b.x);
      // the date's three words go to three controls, not to one flowed line
      const editX =
        key === 'dob'
          ? words.map((_, i) => DATE_X[i] ?? DATE_X[0]!)
          : layoutWords(words, EDIT[key], edit[key].x).map((b) => b.x);
      plan.set(
        key,
        words.map((word, index) => ({
          editX: editX[index] ?? edit[key].x,
          editY: edit[key].y,
          id: `${key}-g${this.generation}-w${index}`,
          viewX: viewX[index] ?? view[key].x,
          viewY: view[key].y,
          word,
        }))
      );
    }
    return plan;
  }

  words = (key: Key) => this.plan.get(key) ?? [];

  /**
   * The reading view's own strings, at the origins the plan computed.
   *
   * Placed by a plain inline style rather than by the motion modifier, and
   * carrying no motion id at all: these are not participants. A participant
   * would be orphaned and crossfaded on its way out, which is a second copy
   * of a value the flight is already drawing. They simply unmount, under a
   * word that is at the same pixels when they do.
   */
  get strings() {
    const view = origins('view');
    return FIELDS.map(({ key }) => ({
      key,
      place: htmlSafe(`left:${view[key].x}px;top:${view[key].y}px`),
      value: this.record[key],
    }));
  }

  /* — what animates, and when — */

  /**
   * Is a mode change actually in flight? A PLAIN field, never tracked.
   *
   * Every kept step states both ends as a keyframe array, because the rest
   * poses live in CSS and a step given one target finds the element already
   * there. The cost is that a keyframe array is not idempotent: any later
   * pass replays it from a pose the card has left, and a later pass is not
   * hypothetical — one arrives as the run settles. So each prop is a
   * function, evaluated per pass, and outside the crossing it answers with
   * the one value the card is currently at.
   *
   * Tracked state would not do: `arming.active()` re-renders the component,
   * and a render inside the region is itself a pass.
   */
  private moving = false;

  private tween =
    <T,>(view: T, edit: T) =>
    () =>
      this.moving
        ? this.editing
          ? [view, edit]
          : [edit, view]
        : this.editing
          ? edit
          : view;

  private find(id: string | null) {
    for (const words of this.plan.values()) {
      const found = words.find((word) => word.id === id);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /**
   * One step, one journey per SPRITE. A step property may be a function of
   * the sprite it is applied to, which is what lets a single `<c.Tween>`
   * give every word its own path: the plan already knows where each id
   * belongs in both poses, so this is a lookup, not a measurement.
   */
  wordX = (sprite: Sprite) => {
    const word = this.find(sprite.id);
    return word ? this.tween(word.viewX, word.editX)() : 0;
  };

  wordY = (sprite: Sprite) => {
    const word = this.find(sprite.id);
    return word ? this.tween(word.viewY, word.editY)() : 0;
  };

  /**
   * The word fades up ONLY when there is something to fade against.
   *
   * Leaving the form, the departing control still holds the value at full
   * strength while the word has begun to move off it — additive, and you see
   * the same text twice a few pixels apart. Fading the word up over the same
   * short window makes that a crossfade, and the two are the same pixels
   * while it lasts. Entering, there is no such partner: the reading string
   * is not a participant, it simply unmounts, and a word ramping from zero
   * against nothing is the value going missing for a fifth of a second.
   */
  wordFade = () => (this.moving && !this.editing ? [0, 1, 1, 1] : 1);

  get nameSize() {
    return this.tween(`${VIEW.name.size}px`, `${EDIT.name.size}px`);
  }

  get nameWeight() {
    return this.tween(VIEW.name.weight, EDIT.name.weight);
  }

  /**
   * Tracking is tweened, not left to the stylesheet, and it has to be. The
   * reading view sets the name at -0.03em and everything else at -0.01em,
   * and pretext measured every word against exactly those numbers. Wearing
   * the shared -0.01em instead, the flight's first letter landed on the
   * pixel and every letter after it drifted.
   */
  get nameTracking() {
    return this.tween(`${VIEW.name.tracking}em`, `${EDIT.name.tracking}em`);
  }

  get subSize() {
    return this.tween(`${VIEW.dob.size}px`, `${EDIT.dob.size}px`);
  }

  get subWeight() {
    return this.tween(VIEW.dob.weight, EDIT.dob.weight);
  }

  get subTracking() {
    return this.tween(`${VIEW.dob.tracking}em`, `${EDIT.dob.tracking}em`);
  }

  get initialSize() {
    return this.tween('28px', '14px');
  }

  get avatarRadius() {
    return this.tween('36px', '10px');
  }

  get plateRadius() {
    return this.tween('3px', '9px');
  }

  /* — the region, and the flag that says a pass is under way — */

  private arming = createArming();
  private region?: ChoreoContext;
  private root?: HTMLElement;

  grab = (context: ChoreoContext) => {
    this.region = context;
    return '';
  };

  hold = modifier((el: HTMLElement) => {
    this.root = el;
    return () => (this.root = undefined);
  });

  /**
   * `data-flying` is written by HAND. `arming.active()` is tracked, so
   * reading it in the template re-renders this component when the arming
   * stands down — and a render inside the region is a pass, and a pass is a
   * crossing. `settled()` is the same arming read as a promise instead: all
   * four of its subtleties, none of its renders.
   */
  toggle = () => {
    this.moving = true;
    this.root?.setAttribute('data-flying', 'true');
    if (this.region) {
      this.arming.begin(this.region);
      void this.arming.settled().then(() => {
        this.moving = false;
        this.root?.removeAttribute('data-flying');
      });
    }
    this.editing = !this.editing;
  };

  <template>
    {{! `data-flying` is set on this element by hand — see `toggle`. }}
    <div class="ex ie" {{this.hold}}>
      <Choreo
        class="ie-card"
        data-mode={{if this.editing "edit" "view"}}
        as |c|
      >
        {{this.grab c}}

        {{! ── BACKGROUND: boxes that nest and never cross ────────────── }}
        <div class="ie-head">
          <span
            class="ie-avatar"
            data-test-avatar
            {{motion id="avatar" role="avatar"}}
          >
            <b
              class="ie-initials"
              {{motion id="initials" role="initials" pack="content"}}
            >{{this.initials}}</b>
          </span>

          <span class="ie-kicker" {{motion id="kicker" role="type"}}>
            {{if this.editing "Editing record" "Customer"}}
          </span>
        </div>

        <span class="ie-rule" {{motion id="rule" role="rule"}}></span>

        {{#each this.fields as |field|}}
          {{#if this.editing}}
            <span
              class="ie-label"
              data-label={{field.key}}
              {{motion id=(concat field.key "-label") role="label"}}
            >{{field.label}}</span>
          {{/if}}

          {{! The platter IS the field: its own lane, its own border, and
              everything the field consists of inside it. It carries no text
              of its own in the reading view, which is why it can be empty
              there without looking like an empty box — it is invisible. }}
          <div
            class="ie-plate"
            data-field={{field.key}}
            data-test-field={{field.key}}
            {{motion id=(concat field.key "-plate") role="plate"}}
          >
            {{#if this.editing}}
              {{#if field.date}}
                <DateField
                  @id={{concat "ie-" field.key}}
                  @label={{field.label}}
                  @value={{get this.record field.key}}
                  @onChange={{fn this.update field.key}}
                  {{motion id=(concat field.key "-control") role="control"}}
                />
              {{else if field.email}}
                <EmailField
                  @id={{concat "ie-" field.key}}
                  @label={{field.label}}
                  @value={{get this.record field.key}}
                  @onChange={{fn this.update field.key}}
                  {{motion id=(concat field.key "-control") role="control"}}
                />
              {{else}}
                <TextField
                  @id={{concat "ie-" field.key}}
                  @label={{field.label}}
                  @value={{get this.record field.key}}
                  @onChange={{fn this.update field.key}}
                  {{motion id=(concat field.key "-control") role="control"}}
                />
              {{/if}}
            {{/if}}
          </div>
        {{/each}}

        {{! ── FOREGROUND: type, over the card and laid out by nobody ─────
            Not inside a platter, so nothing clips it and nothing lays it
            out; free to cross, which is how the reading view puts email and
            date of birth on one line while their platters keep two separate
            lanes. Everything it needs — where, how big, how heavy, how
            tightly set — it carries itself, from pretext. }}
        <div class="ie-type">
          {{#unless this.editing}}
            {{#each this.strings as |line|}}
              <span
                class="ie-value"
                data-value={{line.key}}
                style={{line.place}}
              >{{line.value}}</span>
            {{/each}}
          {{/unless}}

          {{#each this.fields as |field|}}
            {{#each (this.words field.key) key="id" as |part|}}
              <span
                class="ie-word"
                data-field={{field.key}}
                aria-hidden="true"
                {{motion
                  id=part.id
                  role=field.role
                  style=(styles
                    x=(if this.editing part.editX part.viewX)
                    y=(if this.editing part.editY part.viewY)
                  )
                }}
              >{{part.word}}</span>
            {{/each}}
          {{/each}}
        </div>

        <c.Parallel>
          <c.Crossing
            @duration={{MOVE}}
            @ease={{EASE}}
            @leave={{0.14}}
            @arrive={{0.28}}
            @overlap={{0.42}}
          />

          {{! The background moves as boxes: real geometry, along its lane. }}
          <c.Move @of={{c.moved "plate"}} @duration={{MOVE}} @ease={{EASE}} />
          <c.Move @of={{c.moved "avatar"}} @duration={{MOVE}} @ease={{EASE}} />
          <c.Move @of={{c.moved "rule"}} @duration={{MOVE}} @ease={{EASE}} />

          {{! and its corners ride alongside, because a corner carried by a
              crop-scale is a corner that smears }}
          <c.Tween
            @of={{c.kept "plate"}}
            @borderRadius={{this.plateRadius}}
            @duration={{MOVE}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.kept "avatar"}}
            @borderRadius={{this.avatarRadius}}
            @duration={{BOX}}
            @ease={{EASE}}
          />

          {{! The foreground moves as TYPE: every property of it at once, and
              all of it from the plan rather than from a box. }}
          <c.Tween
            @of={{c.kept "name-value"}}
            @x={{this.wordX}}
            @y={{this.wordY}}
            @fontSize={{this.nameSize}}
            @fontWeight={{this.nameWeight}}
            @letterSpacing={{this.nameTracking}}
            @opacity={{this.wordFade}}
            @duration={{MOVE}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.kept "sub-value"}}
            @x={{this.wordX}}
            @y={{this.wordY}}
            @fontSize={{this.subSize}}
            @fontWeight={{this.subWeight}}
            @letterSpacing={{this.subTracking}}
            @opacity={{this.wordFade}}
            @duration={{MOVE}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.kept "initials"}}
            @fontSize={{this.initialSize}}
            @duration={{MOVE}}
            @ease={{EASE}}
          />

          {{! Claimed by nobody, so nothing was fading them: the reading view
              has no counterpart for a form field, which is the point. }}
          <c.Tween
            @of={{c.removed "control"}}
            @opacity={{FADE_OUT}}
            @duration={{LEAVE}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.inserted "label"}}
            @opacity={{FADE_IN}}
            @duration={{BOX}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.removed "label"}}
            @opacity={{FADE_OUT}}
            @duration={{LEAVE}}
            @ease={{EASE}}
          />
        </c.Parallel>
      </Choreo>

      <button
        type="button"
        class="ie-toggle"
        data-test-toggle
        {{on "click" this.toggle}}
      >{{if this.editing "Done" "Edit"}}</button>
    </div>
  </template>
}
