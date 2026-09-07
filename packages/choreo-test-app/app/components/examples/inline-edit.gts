import { concat, fn, get } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type { Sprite } from 'glimmer-motion';
import {
  Choreo,
  type ChoreoContext,
  createArming,
  motion,
  styles,
} from 'glimmer-motion';
import {
  DateField,
  EmailField,
  MONTHS,
  TextField,
} from 'test-app/components/pretui/fields';
import { tuneSeconds } from 'test-app/lib/demo-tuning';
import {
  layoutWords,
  measureText,
  typeReady,
  type TypeScale,
} from 'test-app/lib/word-layout';

/**
 * `date` and `email` rather than a component reference, and the template
 * branches on them. A list of component classes reads better right up until
 * you type it: the three differ in their root element — two inputs and a
 * group — so a union of the classes is not invokable, and the cast that
 * would make it invokable is a lie about three genuinely different shapes.
 */
const FIELDS = [
  { date: false, email: false, key: 'name', label: 'Name' },
  { date: false, email: false, key: 'title', label: 'Job title' },
  { date: false, email: true, key: 'email', label: 'Email' },
  { date: true, email: false, key: 'dob', label: 'Date of birth' },
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

/**
 * ONE duration and ONE curve, for every box and every letter on the card.
 *
 * The header had its own for a while — shorter and sharper, to stop the
 * avatar and the eyebrow crowding each other as one shrank into the other's
 * space. It fixed the crowding and broke the ensemble: the header arrived
 * while the fields under it were still travelling, and a card whose parts
 * finish at different times does not read as one thing changing state. The
 * crowding is a spacing problem and belongs to the layout, not to the
 * clock.
 *
 * The only exception below is `LEAVE`, and it is not a second taste — it is
 * a constraint. The departing control's text and the flight word are the
 * same pixels at the instant of the swap, so they can be crossfaded, but
 * only while they are still in the same place.
 */
const LEAVE = 0.18;
const FADE_IN = [0, 1];
const FADE_OUT = [1, 0];

/**
 * A label arrives from under the field it names.
 *
 * It starts low enough to be behind its own platter, which is painted over
 * it, and rises into the gap above — so it does not appear, it emerges. The
 * distance is the label's own line and a little: far enough that the slide
 * is legible, near enough that it is out from under before the fade is done.
 */
const LABEL_IN = [16, 0];
const LABEL_OUT = [0, 16];

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

/** the card's own padding. There is no grid gap: see `LANES`. */
const PAD = 18;

/**
 * The avatar's size in each pose, and the gutter between it and the eyebrow.
 *
 * Here rather than in the stylesheet because the header is positioned from
 * these numbers rather than aligned by them, and it has to be. A box that is
 * CENTRED — by `align-self`, or by `top: 50%` with a percentage translate —
 * is positioned against its own size, and `c.Move` overrides an element's
 * size while it plays. So the avatar slid out from under its own FLIP by
 * half the change in its height, taking the initials with it, and the MV
 * jumped nineteen pixels on the first frame of every pass. Positioned by its
 * TOP EDGE, from a number, nothing it does to its own height can move it.
 */
const AVATAR = { edit: 34, view: 72 } as const;
const GUTTER = 11;

/**
 * Lane heights, in order, per pose. The same five lanes in the same order in
 * both, which is what makes crossing impossible rather than merely unlikely.
 * These must agree with the row templates in the stylesheet; the two tests
 * that pin the type against the real controls and the real reading string
 * are what catch it if they ever drift.
 */
const LANES = {
  edit: {
    dob: 40,
    'dob-label': 22,
    email: 40,
    'email-label': 22,
    head: 40,
    name: 40,
    'name-label': 22,
    rule: 9,
    title: 40,
    'title-label': 22,
  },
  view: {
    dob: 26,
    'dob-label': 0,
    email: 26,
    'email-label': 0,
    head: 96,
    name: 48,
    'name-label': 0,
    rule: 9,
    title: 30,
    'title-label': 0,
  },
} as const;

/**
 * The lanes, in order — DERIVED from the form rather than restated, and TWO
 * per field: the label's own, and the platter's.
 *
 * They were one lane each, with the label pinned to its top and the platter
 * to its bottom, and that was a real bug rather than a tidiness question. A
 * moved element's FLIP transform is computed against where the layout puts
 * it, and `c.Move` overrides its height while it plays — so an element held
 * to the BOTTOM of a lane moves when its height is overridden, out from
 * under the transform that was supposed to hold it still. The platter
 * arrived eighteen pixels high and animated the remainder, which is what put
 * the date outside its own boundary on the way back. A platter that fills
 * its lane cannot be shifted by its own height.
 *
 * And no grid gap, for the same reason a lane is explicit: a gap is spacing
 * you cannot see in the numbers. Each lane carries its own.
 */
const ORDER = [
  'head',
  'rule',
  ...FIELDS.flatMap((field) => [`${field.key}-label`, field.key] as const),
] as const;

type Lane = (typeof ORDER)[number];

/** the top of each lane, in the card's padding-box coordinates */
function lanes(pose: 'edit' | 'view') {
  const out = {} as Record<Lane, { height: number; top: number }>;
  let top = 0;
  for (const name of ORDER) {
    const height = LANES[pose][name];
    out[name] = { height, top };
    top += height;
  }
  return out;
}

/** 1px of border, then the control's own padding, then the first glyph */
const BORDER = 1;
const INSET = 11;

/**
 * The line box everything type sits in — the flight's words, the reading
 * view's strings, and the real controls — declared once here and handed to
 * the stylesheet. It is the platter's content box: 40px of platter less its
 * border at each end. A line box that disagrees with the one the real text
 * gets is a baseline that jumps on handover.
 */
const LINE = 38;

/**
 * The date field is segmented — day, month, year — so its three controls
 * have three separate text origins rather than one flowed line. These are
 * the widths the stylesheet gives them, and they live here because the
 * flight has to know where "14", "March" and "1986" are going before any of
 * those controls exist.
 */
/**
 * The date's three segments are a FLEX row whose widths are MEASURED, not
 * declared. Each is its own chip: a little padding, the widest value it will
 * ever have to hold, and room for a caret.
 *
 * Measured because the two things that have to agree are the width the
 * browser lays the chip out at and the x pretext tells a word to land on,
 * and there is one way to be sure of that: derive both from the same
 * measurement. A hardcoded 104 is a number that was right for "September" in
 * one face at one size and silently wrong the moment any of those changed.
 *
 * The WIDEST value rather than the current one, so a chip does not resize
 * under its own value when the month changes.
 */
const SEGMENT = { caret: 18, gap: 6, pad: 8 };
const WIDEST = [['28'], MONTHS, ['1986']];

const chip = (widest: readonly string[]) =>
  SEGMENT.pad +
  Math.ceil(Math.max(...widest.map((text) => measureText(text, EDIT.dob)))) +
  SEGMENT.caret;

/**
 * Where the reading view puts the date: on the SAME line as the email, at
 * this offset from the card's left. The one place the two layers disagree on
 * purpose — the boxes keep their lanes, the type does not.
 */
const SUB_SPLIT = 176;

const FAMILY = 'Archivo';

/**
 * 87.5% of Archivo's width axis, said the one way both the canvas and the
 * stylesheet understand. `font-variation-settings: 'wdth' 88` renders the
 * same face but cannot appear in a font shorthand, so pretext would measure
 * the wide cut while the screen drew the narrow one — about thirty pixels of
 * error on a two-word name, all of it in the gaps between the words.
 */
const STRETCH = 'semi-condensed';

/* ── TEMPORARY: a bisect switch for the Safari slowness ──────────────────
 *
 * `?off=clip,size` disables one suspect at a time so a browser that is slow
 * can be watched with each candidate removed. This exists because the last
 * performance fix here was a guess that cost a user-agent sniff and a
 * doubled DOM and bought nothing; the next one gets measured first.
 *
 *   clip      the rounded `overflow: hidden` on every platter — a rounded
 *             clip against a box that resizes every frame is a known WebKit
 *             hotspot, and it is what keeps a field inside its platter
 *   radius    the corner tweens on the platters and the avatar
 *   size      `font-size` on every word — the one that re-shapes every glyph
 *   weight    `font-weight` — already tested, already innocent, kept for
 *             completeness so the set can be bisected as a whole
 *   tracking  `letter-spacing`
 *   color     the ink tween
 *   shade     the form's shadow layer
 *   boxes     the card's and the platters' geometry moves
 *   focus     the caret going into the first field when the form lands
 *   controls  the real inputs and selects, replaced by plain text
 *   score     the WHOLE choreography — no crossing, no moves, no tweens.
 *             The card still swaps poses; it just snaps. If this is still
 *             slow then the animation is not what is slow, and the next
 *             question is whether any other page in the gallery is fast.
 *
 * And two groups, for splitting the space quickly:
 *
 *   text      size + weight + tracking + color — everything the foreground
 *             layer animates except where a word is
 *   all       every suspect at once. If `all` is still slow, nothing on this
 *             list is the cause and the next place to look is outside it.
 *
 * A switched-off property is REMOVED from its step rather than given a
 * single target — a lone target is still a target, and the engine animates
 * to it just the same. Which means the card looks wrong with a suspect
 * disabled: that value simply stops being written. You are watching
 * smoothness, not correctness.
 *
 * DELETE THIS, and everything that reads `OFF`, once the cause is known.
 */
const OFF_GROUPS: Record<string, string[]> = {
  all: [
    'focus',
    'controls',
    'clip',
    'radius',
    'size',
    'weight',
    'tracking',
    'color',
    'shade',
    'boxes',
  ],
  text: ['size', 'weight', 'tracking', 'color'],
};

const isOff = (name: string) => OFF.has(name);

const OFF = new Set<string>(
  (typeof location === 'undefined'
    ? []
    : (new URLSearchParams(location.search).get('off') ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
  ).flatMap((name) => OFF_GROUPS[name] ?? [name])
);

const scale = (size: number, weight: number, tracking: number): TypeScale => ({
  family: FAMILY,
  size,
  stretch: STRETCH,
  tracking,
  weight,
});

/**
 * Reading: an employee's name at the top of its own hierarchy, the job title
 * directly under it in the second voice, and the contact metadata quiet
 * below a rule. Three sizes rather than two, because a record with a title
 * has three ranks in it and flattening the middle one is what makes an
 * intranet profile read as a list of fields instead of as a person.
 */
const VIEW: Record<Key, TypeScale> = {
  dob: scale(13, 500, -0.01),
  email: scale(13, 500, -0.01),
  name: scale(30, 700, -0.03),
  title: scale(15, 500, -0.01),
};

/**
 * The three ranks are three INKS as well as three sizes, and the ink is part
 * of the journey: a contact line that is grey in the reading view and full
 * strength in the form has to get there, or it pops at the handover like any
 * other property that was left out.
 *
 * Tokens rather than literals, resolved against the live document — the
 * gallery has a dark mode, and a hex baked in here would be the light
 * theme's grey travelling across a dark card.
 */
const INK: Record<Key, { edit: string; view: string }> = {
  dob: { edit: '--ink', view: '--ink-faint' },
  email: { edit: '--ink', view: '--ink-faint' },
  name: { edit: '--ink', view: '--ink' },
  title: { edit: '--ink', view: '--ink-dim' },
};

/** writing: every field the same, because a form's values are one kind of thing */
const EDIT: Record<Key, TypeScale> = {
  dob: scale(17, 400, -0.01),
  email: scale(17, 400, -0.01),
  name: scale(17, 400, -0.01),
  title: scale(17, 400, -0.01),
};

/**
 * One word, and everything about it in both poses.
 *
 * Position, size, weight and tracking all live here rather than in a getter
 * per role, because the foreground layer inherits nothing from a box: a word
 * out of flow has to be told all four, and the number of distinct type
 * scales on the card is a design decision, not a shape the score should have
 * to know. One step covers every word; the plan tells each one apart.
 */
interface Pose {
  color: string;
  size: string;
  tracking: string;
  weight: number;
  x: number;
  y: number;
}

interface Word {
  edit: Pose;
  id: string;
  view: Pose;
  word: string;
}

/** a line's origin — first glyph's left, and the line's centre */
interface Origin {
  x: number;
  y: number;
}

function origins(pose: 'edit' | 'view'): Record<Key, Origin> {
  const lane = lanes(pose);
  if (pose === 'edit') {
    // the platter fills its lane, so its middle is the lane's middle; the
    // text sits there, one border and one padding in from its left
    const centre = (key: Key) => lane[key].top + lane[key].height / 2;
    return {
      dob: { x: BORDER + INSET + SEGMENT.pad, y: centre('dob') },
      email: { x: BORDER + INSET, y: centre('email') },
      name: { x: BORDER + INSET, y: centre('name') },
      title: { x: BORDER + INSET, y: centre('title') },
    };
  }
  const middle = (key: Key) => lane[key].top + lane[key].height / 2;
  /**
   * The contact line sits on the FLOOR of its lane rather than in the middle
   * of it. A 13px value in a 22px lane centred looks like it is floating in
   * a space it was given rather than sitting at the bottom of the card, and
   * the two secondary values are the last thing on a profile: they should
   * read as a footer, not as another row.
   */
  /**
   * The line's box sits flush on the FLOOR of the content area — its bottom
   * edge on the top edge of the card's bottom padding, so the padding around
   * the card is the same on all four sides. Derived, not dialled in: the
   * lane's bottom less half the line box everything type is set in.
   */
  const floor = (key: Key) => lane[key].top + lane[key].height - LINE / 2;
  return {
    // Both secondary values share one line, and it is the floor of the LAST
    // lane rather than of either of theirs: they are the footer of a profile,
    // so they dock to the bottom of the card instead of sitting in the middle
    // of a lane with an empty one beneath them.
    dob: { x: SUB_SPLIT, y: floor('dob') },
    email: { x: 0, y: floor('dob') },
    name: { x: 0, y: middle('name') },
    title: { x: 0, y: middle('title') },
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
    title: 'Principal Engineer',
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
    void this.generation;
    const view = origins('view');
    const edit = origins('edit');
    const plan = new Map<Key, Word[]>();
    for (const { key } of FIELDS) {
      const words = this.record[key].split(/\s+/).filter(Boolean);
      const viewX = layoutWords(words, VIEW[key], view[key].x).map((b) => b.x);
      // the date's three words go to three controls, not to one flowed line
      const editX =
        key === 'dob'
          ? words.map((_, i) => this.dateX[i] ?? this.dateX[0]!)
          : layoutWords(words, EDIT[key], edit[key].x).map((b) => b.x);
      const pose = (
        at: TypeScale,
        token: string,
        x: number,
        y: number
      ): Pose => ({
        color: this.ink.get(token) ?? 'currentColor',
        size: `${at.size}px`,
        tracking: `${at.tracking}em`,
        weight: at.weight,
        x,
        y,
      });
      plan.set(
        key,
        words.map((word, index) => ({
          edit: pose(
            EDIT[key],
            INK[key].edit,
            editX[index] ?? edit[key].x,
            edit[key].y
          ),
          id: `${key}-g${this.generation}-w${index}`,
          view: pose(
            VIEW[key],
            INK[key].view,
            viewX[index] ?? view[key].x,
            view[key].y
          ),
          word,
        }))
      );
    }
    return plan;
  }

  words = (key: Key) => this.plan.get(key) ?? [];

  /**
   * The date's chip widths, measured once per generation, and the three text
   * origins that follow from them. One measurement, used by the stylesheet
   * through custom properties and by the plan through `dateX` — so the chip
   * the browser lays out and the mark the word flies to cannot disagree.
   */
  get chips() {
    // read the generation so a font arriving re-measures everything
    void this.generation;
    return WIDEST.map(chip);
  }

  get dateX() {
    const [day = 0, month = 0] = this.chips;
    return [0, day + SEGMENT.gap, day + SEGMENT.gap + month + SEGMENT.gap].map(
      (offset) => BORDER + INSET + offset + SEGMENT.pad
    );
  }

  /**
   * Everything the stylesheet needs and cannot know: the lane order, and BOTH
   * poses' row heights and card heights, and the measured chip widths.
   *
   * Both poses, and that is the whole point of the shape. These are inline on
   * the wrapper, which is OUTSIDE the region — and a wrapper whose style
   * changed when the mode did changed the card's layout before the region
   * had taken its before-picture, so every platter measured the same box
   * twice, `c.moved` selected nothing, and the platters snapped to their new
   * lane while the type flew. It looked like the move had been forgotten.
   *
   * Nothing here depends on the mode. The card picks a pose with its own
   * `[data-mode]`, which changes inside the region, where a change is a pass.
   */
  get metrics() {
    const [day = 0, month = 0, year = 0] = this.chips;
    const rows = (pose: 'edit' | 'view') => {
      const lane = lanes(pose);
      const last = lane[ORDER[ORDER.length - 1]!];
      return [
        `--ie-rows-${pose}:${ORDER.map((n) => `${lane[n].height}px`).join(' ')}`,
        `--ie-height-${pose}:${PAD * 2 + last.top + last.height}px`,
      ];
    };
    return htmlSafe(
      [
        `--ie-areas:${ORDER.map((name) => `'${name}'`).join(' ')}`,
        `--ie-line:${LINE}px`,
        // the one padding, spent by the card, the type layer and the toggle
        `--ie-pad:${PAD}px`,
        ...(['view', 'edit'] as const).flatMap((pose) => [
          `--ie-avatar-${pose}:${AVATAR[pose]}px`,
          // its top edge, so that its own height cannot move it
          `--ie-avatar-top-${pose}:${(LANES[pose].head - AVATAR[pose]) / 2}px`,
          `--ie-kicker-${pose}:${AVATAR[pose] + GUTTER}px`,
        ]),
        ...rows('view'),
        ...rows('edit'),
        `--pt-day:${day}px`,
        `--pt-month:${month}px`,
        `--pt-year:${year}px`,
        `--pt-seg-gap:${SEGMENT.gap}px`,
        `--pt-seg-pad:${SEGMENT.pad}px`,
        `--pt-caret:${SEGMENT.caret}px`,
      ].join(';')
    );
  }

  /** each row's own lane, so no stylesheet has to name the fields */
  area = (key: string) => htmlSafe(`grid-area:${key}`);

  labelArea = (key: Key) => this.area(`${key}-label`);

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

  /**
   * The real controls are DISPLAYED only once the flight has landed.
   *
   * They used to be painted throughout it, with their text transparent so
   * the flight could draw it — which meant five native form controls sitting
   * inside four boxes whose geometry animated every frame, and WebKit
   * re-renders a native control when its box changes. Measured by removing
   * them: the pass goes from a hitch in its last stretch to smooth.
   *
   * `display: none` rather than unmounting, and driven by an ATTRIBUTE
   * rather than by tracked state. Unmounting them is a render inside the
   * region, and a render inside the region is a pass — mounting them at the
   * settle kicked off a second crossing, which was a worse flicker than the
   * one it fixed, in every browser. Two attribute writes a frame apart do
   * the same job and the region never hears about it.
   */
  private tween =
    <T,>(view: T, edit: T, off?: string) =>
    () => {
      if (off && OFF.has(off)) {
        // removed from the step entirely: a step skips an undefined prop
        return undefined as never;
      }
      return this.moving
        ? this.editing
          ? [view, edit]
          : [edit, view]
        : this.editing
          ? edit
          : view;
    };

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
  /**
   * One step, one journey per SPRITE, for every property at once.
   *
   * A step property may be a function of the sprite it is applied to, which
   * is what lets a single `<c.Tween>` give every word on the card its own
   * position, size, weight and kerning — three type scales across four
   * fields, out of one step. The plan already knows where each id belongs in
   * both poses, so each of these is a lookup rather than a measurement.
   */
  /**
   * A property whose two ends are equal is not animated — it is left out of
   * the step entirely, so the engine never writes it and the stylesheet's
   * rest pose governs.
   *
   * Three of the four fields have the same tracking in both poses, and the
   * name has the same ink; tweening those is pure per-frame cost for a value
   * that does not change. Eleven words times four properties is forty-four
   * animated values a frame, and this is the cheapest possible way to cut it
   * — by not asking for the ones nobody wanted.
   */
  private of =
    <K extends keyof Pose>(key: K, off?: string) =>
    (sprite: Sprite) => {
      const word = this.find(sprite.id);
      if (!word) {
        return 0;
      }
      if (word.view[key] === word.edit[key]) {
        return undefined as never;
      }
      return this.tween(word.view[key], word.edit[key], off)();
    };

  wordX = this.of('x');
  wordY = this.of('y');
  wordSize = this.of('size', 'size');
  wordWeight = this.of('weight', 'weight');
  wordTracking = this.of('tracking', 'tracking');
  wordColor = this.of('color', 'color');

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

  get initialSize() {
    return this.tween('28px', '14px');
  }

  get avatarRadius() {
    return this.tween('36px', '10px', 'radius');
  }

  get plateRadius() {
    return this.tween('3px', '9px', 'radius');
  }

  /** TEMPORARY, see `OFF` */
  get off() {
    return OFF.size ? [...OFF].join(' ') : undefined;
  }

  boxesMove = !OFF.has('boxes');
  scored = !OFF.has('score');
  realControls = !OFF.has('controls');

  /** the form is lifted off the page; the reading card lies flat on it */
  get shade() {
    return this.tween(0, 1);
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
    this.readInk(el);
    // the gallery's theme switch rewrites the tokens under us, and a colour
    // the plan resolved against the old theme is a colour that travels wrong
    const watch = new MutationObserver(() => {
      this.readInk(el);
      this.generation++;
    });
    watch.observe(document.documentElement, {
      attributeFilter: ['class', 'data-theme'],
      attributes: true,
    });
    return () => {
      watch.disconnect();
      this.root = undefined;
    };
  });

  /** the resolved value of every ink token the plan needs, this theme */
  private ink = new Map<string, string>();

  private readInk(el: HTMLElement) {
    const style = getComputedStyle(el);
    for (const token of ['--ink', '--ink-dim', '--ink-faint']) {
      this.ink.set(
        token,
        style.getPropertyValue(token).trim() || 'currentColor'
      );
    }
  }

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
    this.root?.removeAttribute('data-landed');
    if (this.region) {
      this.arming.begin(this.region);
      void this.arming.settled().then(() => {
        this.moving = false;
        // The controls take their layout now, still with transparent text
        // and the flight still drawing the value. A frame later they are
        // laid out and painted, and the handover is a colour and a
        // visibility in one paint with no layout in it — do both in the same
        // breath and there is a frame with the real text not yet laid out
        // and the flight text already gone, which is the flicker.
        this.root?.setAttribute('data-landed', 'true');
        requestAnimationFrame(() => {
          this.root?.removeAttribute('data-flying');
          if (this.editing && !OFF.has('focus')) {
            this.root?.querySelector<HTMLElement>('.ie-plate input')?.focus();
          }
        });
      });
    }
    this.editing = !this.editing;
  };

  <template>
    {{! `data-flying` is set on this element by hand — see `toggle`. }}
    <div
      class="ex ie"
      style={{this.metrics}}
      data-off={{this.off}}
      {{this.hold}}
    >
      <Choreo class="ie-stage" as |c|>
        {{this.grab c}}

        {{! DEPTH, and the cheap kind. A shadow is not a composited property
            — every frame that changes one re-rasterises the box it is on —
            so this is not the card's shadow. It is a layer of its own, at a
            FIXED size and never moved, carrying a stack of four shadows
            painted once at full strength. The only thing that animates is
            its opacity, which is the one channel that composites, and the
            card grows into it as it fades up. }}
        <span class="ie-shade" {{motion id="shade" role="shade"}}></span>

        {{! The white card is a PARTICIPANT, not the region itself. A region
            is the frame a crossing is measured IN; it is not one of the
            things measured, so a card that WAS the region had no before and
            after of its own and snapped between its two heights while
            everything inside it flew. One element in, and it is FLIPped like
            any other box on the card. }}
        <div
          class="ie-card"
          data-mode={{if this.editing "edit" "view"}}
          {{motion id="card" role="card"}}
        >

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

            <span class="ie-kicker" {{motion id="kicker" role="kicker"}}>
              {{if this.editing "Editing profile" "Kiln Engineering"}}
            </span>
          </div>

          <span class="ie-rule" {{motion id="rule" role="rule"}}></span>

          {{#each this.fields as |field|}}
            {{#if this.editing}}
              <span
                class="ie-label"
                data-label={{field.key}}
                style={{this.labelArea field.key}}
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
              style={{this.area field.key}}
              {{motion id=(concat field.key "-plate") role="plate"}}
            >
              {{#if this.editing}}
                {{#if (isOff "controls")}}
                  {{! the probe's stand-in wears the control's own dress, so
                      what it removes is the native control and not the
                      layout as well }}
                  <span class="pt-input pt-plain">{{get
                      this.record
                      field.key
                    }}</span>
                {{else if field.date}}
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
                    role="value"
                    style=(styles
                      x=(if this.editing part.edit.x part.view.x)
                      y=(if this.editing part.edit.y part.view.y)
                    )
                  }}
                >{{part.word}}</span>
              {{/each}}
            {{/each}}
          </div>

          {{! Top right of the CARD, the way a phone puts Edit and Done — a
              direct child of it, because the header is positioned in its own
              right and an absolute box takes the nearest positioned
              ancestor, which put this one eighteen pixels in from the header
              instead of from the card.

              LAST in the card, and that is about the keyboard rather than
              the paint: it is placed in the corner by position, so its
              document order is free to be the one the tab key wants. After
              the year, so a person filling the form in from the top reaches
              Done by carrying on. }}
          <button
            type="button"
            class="ie-toggle"
            data-test-toggle
            {{on "click" this.toggle}}
          >{{if this.editing "Done" "Edit"}}</button>
        </div>

        {{#if this.scored}}
          <c.Parallel>
            <c.Crossing
              @duration={{tuneSeconds "inline-edit" MOVE "Crossing duration 1"}}
              @ease={{EASE}}
              @leave={{0.14}}
              @arrive={{0.28}}
              @overlap={{0.42}}
            />

            {{! The background moves as boxes: real geometry, along its lane. }}
            <c.Move
              @of={{c.moved "card"}}
              @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
              @ease={{EASE}}
            />
            {{#if this.boxesMove}}
              <c.Move
                @of={{c.moved "card"}}
                @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
                @ease={{EASE}}
              />
              <c.Move
                @of={{c.moved "plate"}}
                @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
                @ease={{EASE}}
              />
            {{/if}}
            {{! the eyebrow moves because the avatar beside it shrinks and the
              lane under it gets shorter — two reasons, neither of them its
              own, and without a Move of its own it simply jumped }}
            <c.Move
              @of={{c.moved "avatar"}}
              @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
              @ease={{EASE}}
            />
            <c.Move
              @of={{c.moved "kicker"}}
              @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
              @ease={{EASE}}
            />
            <c.Move
              @of={{c.moved "rule"}}
              @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
              @ease={{EASE}}
            />

            {{! and its corners ride alongside, because a corner carried by a
              crop-scale is a corner that smears }}
            <c.Tween
              @of={{c.kept "plate"}}
              @borderRadius={{this.plateRadius}}
              @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
              @ease={{EASE}}
            />
            <c.Tween
              @of={{c.kept "avatar"}}
              @borderRadius={{this.avatarRadius}}
              @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
              @ease={{EASE}}
            />
            <c.Tween
              @of={{c.kept "shade"}}
              @opacity={{this.shade}}
              @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
              @ease={{EASE}}
            />

            {{! The foreground moves as TYPE: every property of it at once, out
              of ONE step, because a step property may be a function of the
              sprite it is applied to. Three type scales across four fields,
              and the score does not have to know that. }}
            <c.Tween
              @of={{c.kept "value"}}
              @x={{this.wordX}}
              @y={{this.wordY}}
              @fontSize={{this.wordSize}}
              @fontWeight={{this.wordWeight}}
              @letterSpacing={{this.wordTracking}}
              @color={{this.wordColor}}
              @opacity={{this.wordFade}}
              @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
              @ease={{EASE}}
            />
            <c.Tween
              @of={{c.kept "initials"}}
              @fontSize={{this.initialSize}}
              @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
              @ease={{EASE}}
            />

            {{! Claimed by nobody, so nothing was fading them: the reading view
              has no counterpart for a form field, which is the point. }}
            <c.Tween
              @of={{c.removed "control"}}
              @opacity={{FADE_OUT}}
              @duration={{tuneSeconds "inline-edit" LEAVE "LEAVE duration"}}
              @ease={{EASE}}
            />

            {{! The date's three chips arrive as part of the crossing rather
              than by a rule of their own: they are inserted, so the score
              can address them, and their entrance is the same fade every
              other arrival on this card gets. Their TEXT is not what fades —
              the flight is still drawing that — only the grey they sit on. }}
            <c.Tween
              @of={{c.inserted "chip"}}
              @opacity={{FADE_IN}}
              @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
              @ease={{EASE}}
            />
            <c.Tween
              @of={{c.removed "chip"}}
              @opacity={{FADE_OUT}}
              @duration={{tuneSeconds "inline-edit" LEAVE "LEAVE duration"}}
              @ease={{EASE}}
            />
            <c.Tween
              @of={{c.inserted "label"}}
              @opacity={{FADE_IN}}
              @y={{LABEL_IN}}
              @duration={{tuneSeconds "inline-edit" MOVE "MOVE duration"}}
              @ease={{EASE}}
            />
            <c.Tween
              @of={{c.removed "label"}}
              @opacity={{FADE_OUT}}
              @y={{LABEL_OUT}}
              @duration={{tuneSeconds "inline-edit" LEAVE "LEAVE duration"}}
              @ease={{EASE}}
            />
          </c.Parallel>
        {{/if}}
      </Choreo>
    </div>
  </template>
}
