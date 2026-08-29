import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { Choreo, motion, styles } from 'glimmer-motion';
import type { Sprite } from 'glimmer-motion';
import {
  layoutWords,
  type TypeScale,
  typeReady,
} from 'test-app/lib/word-layout';

/** the record's fields, in the order the card reads them */
const FIELDS = [
  { key: 'name', label: 'Name', role: 'name-value' },
  { key: 'email', label: 'Email', role: 'sub-value' },
  { key: 'dob', label: 'Date of birth', role: 'sub-value' },
] as const;

type Key = (typeof FIELDS)[number]['key'];

/** one duration for the whole crossing, so nothing arrives out of step */
const MOVE = 0.55;
const EASE = [0.22, 1, 0.36, 1] as const;
const SOFT = [0.22, 1, 0.36, 1] as const;
const BOX = 0.46;

/**
 * The two poses of the type, said in numbers rather than in CSS.
 *
 * These are the source of truth for BOTH the stylesheet's rest poses and
 * pretext's measurements, which is the point: a width measured against one
 * set of numbers and rendered against another is a width that is wrong.
 * `wdth` is deliberately absent — a variation axis cannot be said in the
 * canvas font shorthand, so asking for one here would measure a face the
 * screen is not showing.
 */
const FAMILY = 'Archivo';
const WORD_GAP = 0.3;

/**
 * 87.5% of Archivo's width axis, said the one way that both the canvas and
 * the stylesheet understand. `font-variation-settings: 'wdth' 88` renders
 * the same face but cannot appear in a font shorthand, so pretext would
 * measure the wide cut and the screen would draw the narrow one — about
 * thirty pixels of error on a two-word name, all of it in the gaps.
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

/** the form insets its values from the plate's edge; the reading view does not */
const INSET = { edit: 11, view: 0 };

interface Word {
  id: string;
  word: string;
  /** left edge in the reading pose, and in the form — both, always */
  edit: number;
  view: number;
}

/**
 * The same words, read and written.
 *
 * A record card in two states — a reading view and a form — and one
 * `<c.Crossing>` between them. Every word of every value is its own identity
 * and its own element in BOTH states, so a value does not dissolve into its
 * editor: each word travels to where the form puts it, changing size and
 * weight on the way.
 *
 * THE WORDS ARE NOT IN LAYOUT, AND THAT IS THE WHOLE DESIGN
 * `font-size` is a layout property, and every arrangement that let the
 * browser flow these words collided with it. With a copy per state the
 * arriving one relaid itself out as it grew, so the crossing's pin was
 * computed against a box that was still moving and you saw the name twice,
 * large and small, sliding past each other. With one flowed copy the boxes
 * collapsed under the type. And in both, the gaps inside a multi-word line
 * went wrong mid-flight — "14 March 1986" arrived as "14  March1986" —
 * because each word was flying on its own and nothing was interpolating the
 * LINE. The space between two words is a property of neither of them.
 *
 * So the words are taken out of flow. `word-layout.ts` asks pretext for each
 * word's left edge at both scales — arithmetic over canvas measurements, no
 * DOM and no reflow — and the score tweens `x` from one number to the other.
 * Nothing is in layout, so nothing can be disturbed by the type resizing,
 * and the line moves as a line because one model produced both ends of it.
 *
 * WHY MEASURING THE POSE YOU ARE NOT SHOWING MATTERS
 * A record's reading view and its editor are not usually one component by
 * one author. They are two, and only one of them is ever rendered, so
 * neither can measure the other by asking the DOM. Pretext can measure a
 * layout that is not on screen. That is what makes this generalise past a
 * demo where both halves happen to live in the same file.
 *
 * WHY A VARIABLE FONT IS LOAD-BEARING
 * Reading type is 30px at weight 700; the form's is 17px at 400. With static
 * cuts those are two files and the browser can only swap between them — the
 * weight would pop at whatever frame the swap lands on. Archivo is variable
 * (`wght 400..700`, loaded by the stylesheet), so `fontWeight` is a number
 * the engine can interpolate, and the library registers it unitless so it
 * interpolates as one.
 */
export class InlineEdit extends Component {
  @tracked editing = false;
  @tracked record: Record<Key, string> = {
    dob: '14 March 1986',
    email: 'm.villanueva@kiln.studio',
    name: 'Marguerite Villanueva',
  };

  /**
   * Bumped when the fonts resolve, and when a commit changes the record.
   *
   * Canvas measurement is only as good as the face the browser has: ask
   * before Archivo has arrived and every width comes back in the fallback's
   * metrics. So the first plan is measured against whatever is loaded, and
   * this re-measures it once the real face is there.
   */
  @tracked private generation = 0;

  /** the live editable nodes, so a commit can read what was typed */
  private live = new Map<string, HTMLElement>();

  fields = FIELDS;

  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    void typeReady([...Object.values(VIEW), ...Object.values(EDIT)]).then(
      () => {
        this.generation++;
      }
    );
  }

  /**
   * The plan: every word of every field, with its left edge in both poses.
   *
   * Measured once per generation rather than per render — pretext's
   * `prepare` is the expensive half of it by design, and the answer only
   * changes when the record or the loaded fonts do.
   */
  get plan(): Map<Key, Word[]> {
    // read the generation so a font arriving re-measures everything
    this.generation;
    const plan = new Map<Key, Word[]>();
    for (const { key } of FIELDS) {
      const words = this.record[key].split(/\s+/).filter(Boolean);
      const view = layoutWords(words, VIEW[key], INSET.view);
      const edit = layoutWords(words, EDIT[key], INSET.edit);
      plan.set(
        key,
        words.map((word, index) => ({
          edit: edit[index]!.x,
          id: `${key}-g${this.generation}-w${index}`,
          view: view[index]!.x,
          word,
        }))
      );
    }
    return plan;
  }

  words = (key: Key) => this.plan.get(key) ?? [];

  /** the record's initials, which cross as one identity of their own */
  get initials() {
    return this.record.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('');
  }

  /* — what the score animates — */

  /**
   * Every pose below is a PAIR: where the value is coming from, and where it
   * is going. That is not decoration, it is the only shape that works here.
   * The rest poses live in the stylesheet, keyed by `[data-mode]`, which is
   * where a rest pose belongs — but it also means the new value is already
   * on the element by the time the region measures the pass. A step given
   * one target finds the element already there and animates nothing. A
   * keyframe array says both ends in one value.
   */
  private pair = <T,>(from: T, to: T) =>
    this.editing ? [from, to] : [to, from];

  /**
   * One step, one value per SPRITE. A step property may be a function of the
   * sprite it is being applied to, which is what lets a single `<c.Tween>`
   * give every word its own journey: the plan already knows where each id
   * belongs at both scales, so this is a lookup, not a measurement.
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

  get nameSize() {
    return this.pair(`${VIEW.name.size}px`, `${EDIT.name.size}px`);
  }

  get nameWeight() {
    return this.pair(VIEW.name.weight, EDIT.name.weight);
  }

  get nameTracking() {
    return this.pair(`${VIEW.name.tracking}em`, `${EDIT.name.tracking}em`);
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

  /** the plate does not travel: it expands into place and fades up */
  get plateOpacity() {
    return this.pair(0, 1);
  }

  get plateScale() {
    return this.pair(0.72, 1);
  }

  /**
   * Hold an editable word. Its content is rendered ONCE per pass and then
   * left alone: the browser owns the text while a word is being typed into,
   * and re-rendering under a caret is how a contenteditable loses it.
   */
  hold = modifier((el: HTMLElement, [id]: [string]) => {
    this.live.set(id, el);
    return () => this.live.delete(id);
  });

  toggle = () => {
    if (this.editing) {
      // read what was typed BEFORE the pass, or the nodes are already gone
      const next = { ...this.record };
      for (const [key, words] of this.plan) {
        const typed = words
          .map((word) => this.live.get(word.id)?.textContent ?? word.word)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (typed) {
          next[key] = typed;
        }
      }
      const changed = FIELDS.some(({ key }) => next[key] !== this.record[key]);
      if (changed) {
        this.record = next;
        // a fresh generation hands Glimmer keys it has never seen, so it
        // builds new nodes instead of adopting ones the browser has been
        // editing behind its back
        this.generation++;
      }
    }
    this.editing = !this.editing;
  };

  <template>
    <div class="ex ie">
      <Choreo
        class="ie-card"
        data-mode={{if this.editing "edit" "view"}}
        as |c|
      >
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
          <div class="ie-field" data-field={{field.key}}>
            {{! The form's chrome is its OWN element. While the box holding
                the words also drew the border, the frame had to fly with the
                text and the eye read the chrome as the thing that was
                moving. A plate that is not the text container is left out of
                every Move: it arrives where the form puts it and fades up. }}
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

            {{! The line's box travels; the words inside it do not flow. Each
                one is absolutely positioned at an x pretext worked out for
                both scales, so the type can change size without anything
                being laid out and the gaps stay the line's own. }}
            <div
              class="ie-box"
              data-test-field={{field.key}}
              aria-label={{field.label}}
            >
              {{#each (this.words field.key) key="id" as |part|}}
                <span
                  class="ie-word"
                  contenteditable={{if this.editing "true" "false"}}
                  spellcheck="false"
                  {{this.hold part.id}}
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

          {{! The lines travel as boxes; so do the avatar and the hairline.
              The plates are deliberately in no Move at all. }}
          <c.Move @of={{c.moved "avatar"}} @duration={{MOVE}} @ease={{EASE}} />
          <c.Move @of={{c.moved "rule"}} @duration={{MOVE}} @ease={{EASE}} />

          {{! One step, one journey per word: a step property may be a
              function of the sprite, so the plan is read per element. }}
          <c.Tween
            @of={{c.kept "name-value"}}
            @x={{this.wordX}}
            @fontSize={{this.nameSize}}
            @fontWeight={{this.nameWeight}}
            @letterSpacing={{this.nameTracking}}
            @duration={{MOVE}}
            @ease={{SOFT}}
          />
          <c.Tween
            @of={{c.kept "sub-value"}}
            @x={{this.wordX}}
            @fontSize={{this.subSize}}
            @fontWeight={{this.subWeight}}
            @duration={{MOVE}}
            @ease={{SOFT}}
          />
          <c.Tween
            @of={{c.kept "initials"}}
            @fontSize={{this.initialSize}}
            @duration={{MOVE}}
            @ease={{SOFT}}
          />
          <c.Tween
            @of={{c.kept "avatar"}}
            @borderRadius={{this.avatarRadius}}
            @duration={{BOX}}
            @ease={{SOFT}}
          />
          <c.Tween
            @of={{c.kept "plate"}}
            @opacity={{this.plateOpacity}}
            @scaleY={{this.plateScale}}
            @duration={{BOX}}
            @ease={{SOFT}}
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
