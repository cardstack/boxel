import { concat, fn, get } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
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
 * `kind` rather than a component reference, and the template branches on it.
 * A list of component classes reads better right up until you type it: the
 * three differ in their root element — two inputs and a group — so a union
 * of the classes is not invokable, and the cast that would make it invokable
 * is a lie about three genuinely different shapes.
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
const EASE = [0.22, 1, 0.36, 1] as const;
const BOX = 0.42;

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

/** where a control paints its first glyph, measured from the field's left */
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
  INSET,
  INSET + SEGMENT.day + SEGMENT.gap,
  INSET + SEGMENT.day + SEGMENT.gap + SEGMENT.month + SEGMENT.gap,
];

interface Word {
  id: string;
  word: string;
  edit: number;
  view: number;
}

/**
 * Real DOM, then a flight, then real DOM again.
 *
 * A record card in two states. The reading view is an ordinary string in
 * ordinary flow. The form is three REAL fields — a text input, an email
 * input, and a segmented date group — copied into this app from pretui
 * rather than depended on, because pretui's own `Input` wraps boxel-ui.
 *
 * No element is in both, and none can be. A `<span>` in flow and the value
 * of an `<input>` cannot be the same node, and every attempt to make
 * choreography pretend otherwise failed in a different way: two copies of a
 * word sliding past each other while the arriving one relaid itself out; a
 * line whose inter-word gaps went wrong in flight because each word was
 * travelling alone and nothing was interpolating the LINE — "14 March 1986"
 * arriving as "14  March1986". The space between two words is a property of
 * neither of them.
 *
 * So this hands off, in three phases:
 *
 *   1. REAL DOM. The reading view's own markup, in flow and selectable.
 *   2. THE FLIGHT. A layer of words, out of flow, carrying the eye from one
 *      pose to the other while both real ends crossfade underneath.
 *   3. REAL DOM AGAIN. The form's fields, with focus, keyboards, autofill —
 *      everything a span pretending to be an input never had.
 *
 * WHAT IS MEASURED, AND BY WHOM
 * The containers are measured by the LIBRARY. A field's box before the swap
 * and after it is exactly what a changeset is: `<Choreo>` takes both, and
 * `c.Move` flies the field between them. There is no `getBoundingClientRect`
 * in this file, and there was — a hand-rolled FLIP, two reads a frame apart,
 * re-deriving what the region had already measured and would have kept
 * correct through interruptions and speed changes that hand-rolling does
 * not survive.
 *
 * pretext measures the one thing the DOM cannot: where a word will sit in a
 * pose that is not rendered. The form does not exist while the reading view
 * is on screen, and in the general case it is not even the same author's
 * component. So each word's x WITHIN its field is arithmetic over canvas
 * metrics — no DOM, no reflow, no requirement that the text be on screen at
 * the size being asked about — and the field's own journey is the library's.
 * Between them there is nothing left to guess.
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

  /**
   * "A scene change is under way", as the library says it.
   *
   * The flight words are in the DOM in every phase — that is what lets the
   * region keep their identity and fly them with the field — so something
   * has to say when they are the thing being looked at. The first cut said
   * it with four opacity keyframes on their own step, which put the engine
   * in charge of a value whose REST pose matters more than its journey: any
   * pass that did not run the step left the words sitting at whatever the
   * crossing had last set, fully opaque over the real controls.
   *
   * `createArming` is the region's own answer. It stands up when the pass
   * starts, latches the run once it exists, hands over rather than standing
   * down when a run is replaced mid-flight, and has a deadline for the
   * crossing that never produces a pass at all — four subtleties this demo
   * would otherwise have got wrong one at a time.
   */
  private arming = createArming();

  grab = (context: ChoreoContext) => {
    this.region = context;
    return '';
  };

  private region?: ChoreoContext;

  get flying() {
    return this.arming.active();
  }

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

  toggle = () => {
    if (this.region) {
      this.arming.begin(this.region);
    }
    this.editing = !this.editing;
  };

  /**
   * Where each word of a field sits, relative to that field's own left edge,
   * in BOTH poses — neither of which needs to be rendered to be known.
   *
   * The reading view is one flowed line, so pretext lays it out. The form is
   * not always one line: the date is three controls, and its words go to the
   * three text origins the stylesheet gives them.
   */
  get plan(): Map<Key, Word[]> {
    // read the generation so a font arriving re-measures everything
    this.generation;
    const plan = new Map<Key, Word[]>();
    for (const { key } of FIELDS) {
      const words = this.record[key].split(/\s+/).filter(Boolean);
      const view = layoutWords(words, VIEW[key], 0).map((box) => box.x);
      const edit =
        key === 'dob'
          ? words.map((_, index) => DATE_X[index] ?? INSET)
          : layoutWords(words, EDIT[key], INSET).map((box) => box.x);
      plan.set(
        key,
        words.map((word, index) => ({
          edit: edit[index] ?? INSET,
          id: `${key}-g${this.generation}-w${index}`,
          view: view[index] ?? 0,
          word,
        }))
      );
    }
    return plan;
  }

  words = (key: Key) => this.plan.get(key) ?? [];

  /**
   * One step, one journey per SPRITE. A step property may be a function of
   * the sprite it is applied to, which is what lets a single `<c.Tween>`
   * give every word its own x: the plan already knows where each id belongs
   * at both scales, so this is a lookup, not a measurement.
   */
  wordX = (sprite: Sprite) => {
    for (const words of this.plan.values()) {
      const found = words.find((word) => word.id === sprite.id);
      if (found) {
        return this.editing
          ? [found.view, found.edit]
          : [found.edit, found.view];
      }
    }
    return 0;
  };

  private pair = <T,>(from: T, to: T) =>
    this.editing ? [from, to] : [to, from];

  get nameSize() {
    return this.pair(`${VIEW.name.size}px`, `${EDIT.name.size}px`);
  }

  get nameWeight() {
    return this.pair(VIEW.name.weight, EDIT.name.weight);
  }

  get subSize() {
    return this.pair(`${VIEW.dob.size}px`, `${EDIT.dob.size}px`);
  }

  get subWeight() {
    return this.pair(VIEW.dob.weight, EDIT.dob.weight);
  }

  get initialSize() {
    return this.pair('28px', '14px');
  }

  get avatarRadius() {
    return this.pair('36px', '10px');
  }

  get plateOpacity() {
    return this.pair(0, 1);
  }

  get plateScale() {
    return this.pair(0.72, 1);
  }

  <template>
    <div class="ex ie">
      <Choreo
        class="ie-card"
        data-mode={{if this.editing "edit" "view"}}
        data-flying={{if this.flying "true"}}
        as |c|
      >
        {{this.grab c}}
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
          <div
            class="ie-field"
            data-field={{field.key}}
            {{motion id=(concat field.key "-field") role="field"}}
          >
            {{! The form's chrome is its own element, so it can be left out of
                every Move: it belongs to the container rather than to the
                text, and it arrives where the form puts it. }}
            <span
              class="ie-plate"
              {{motion id=(concat field.key "-plate") role="plate"}}
            ></span>

            {{#if this.editing}}
              <span
                class="ie-label"
                {{motion id=(concat field.key "-label") role="label"}}
              >{{field.label}}</span>
            {{/if}}

            <div class="ie-box" data-test-field={{field.key}}>
              {{! PHASE 1 and PHASE 3: real DOM at both ends. Neither carries
                  a motion id, and that is deliberate — they are not in the
                  crossing at all. There is never a moment with two copies of
                  a value on screen: the string is gone the instant the
                  flight begins, the control's own text is transparent for
                  exactly as long as the flight is up, and the word lands on
                  the pixel the control will paint. A crossfade here would be
                  two identical copies blending, which reads as a ghost — and
                  a ghost is what you get when the two do not agree, so the
                  right answer is to make them agree and show one. }}
              {{#if this.editing}}
                {{#if field.date}}
                  <DateField
                    @id={{concat "ie-" field.key}}
                    @label={{field.label}}
                    @value={{get this.record field.key}}
                    @onChange={{fn this.update field.key}}
                  />
                {{else if field.email}}
                  <EmailField
                    @id={{concat "ie-" field.key}}
                    @label={{field.label}}
                    @value={{get this.record field.key}}
                    @onChange={{fn this.update field.key}}
                  />
                {{else}}
                  <TextField
                    @id={{concat "ie-" field.key}}
                    @label={{field.label}}
                    @value={{get this.record field.key}}
                    @onChange={{fn this.update field.key}}
                  />
                {{/if}}
              {{else}}
                <span class="ie-value">{{get this.record field.key}}</span>
              {{/if}}

              {{! PHASE 2: the flight. These words are in the DOM in every
                  phase — that is what lets the region keep their identity and
                  fly them with the field — but they are only ever VISIBLE
                  between the two real poses. }}
              {{#each (this.words field.key) key="id" as |part|}}
                <span
                  class="ie-word"
                  aria-hidden="true"
                  {{motion
                    id=part.id
                    role=field.role
                    style=(styles x=(if this.editing part.edit part.view))
                  }}
                >{{part.word}}</span>
              {{/each}}
            </div>
          </div>
        {{/each}}

        <c.Parallel>
          <c.Crossing
            @duration={{MOVE}}
            @ease={{EASE}}
            @leave={{0.2}}
            @arrive={{0.28}}
            @overlap={{0.42}}
          />

          {{! The card's boxes travel — the library's measurement, not mine.
              The plates are in no Move at all: they expand where they land. }}
          <c.Move @of={{c.moved "field"}} @duration={{MOVE}} @ease={{EASE}} />
          <c.Move @of={{c.moved "avatar"}} @duration={{MOVE}} @ease={{EASE}} />
          <c.Move @of={{c.moved "rule"}} @duration={{MOVE}} @ease={{EASE}} />

          {{! Each word's x comes from pretext. Whether it can be SEEN comes
              from the region's arming, in the stylesheet — a rest pose the
              engine does not own, so a pass that runs no step cannot leave
              a word opaque over the control it was flying to. }}
          <c.Tween
            @of={{c.kept "name-value"}}
            @x={{this.wordX}}
            @fontSize={{this.nameSize}}
            @fontWeight={{this.nameWeight}}
            @duration={{MOVE}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.kept "sub-value"}}
            @x={{this.wordX}}
            @fontSize={{this.subSize}}
            @fontWeight={{this.subWeight}}
            @duration={{MOVE}}
            @ease={{EASE}}
          />

          <c.Tween
            @of={{c.kept "initials"}}
            @fontSize={{this.initialSize}}
            @duration={{MOVE}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.kept "avatar"}}
            @borderRadius={{this.avatarRadius}}
            @duration={{BOX}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.kept "plate"}}
            @opacity={{this.plateOpacity}}
            @scaleY={{this.plateScale}}
            @duration={{BOX}}
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
