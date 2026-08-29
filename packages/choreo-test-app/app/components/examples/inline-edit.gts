import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { Choreo, motion } from 'glimmer-motion';

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

/** the type tween is its own length: shorter, so the scale lands before the move does */
const TYPE = 0.55;

/** what every tween that is not the move rides */
const SOFT = [0.22, 1, 0.36, 1] as const;

/**
 * The box's own curve, for radius and border.
 *
 * The Crossing demo's lesson, applied: a plate's box is TWEENED — real
 * left/top/width/height through `c.Move` — and its corner radius rides the
 * modifier beside it, because a radius carried by a crop-scale is a radius
 * that smears. The same split here. What is deliberately NOT tweened is the
 * border colour as a shadow would be: it crossfades from transparent, which
 * is one property and cannot drag a colour through mud.
 */
const BOX = 0.46;

/**
 * The same words, read and written.
 *
 * A record card in two states — a reading view and a form — and one
 * `<c.Crossing>` between them. Every word of every value is its own identity,
 * so a value does not dissolve into its editor: each word FLIES to where the
 * form puts it, and changes size and weight on the way.
 *
 * WHY THE TWO POSES ARE SO FAR APART
 * The first cut changed only the type and the chrome. It was correct and it
 * was nearly invisible: a word that ends 40px from where it started reads as
 * a re-render, not a flight. So the card is now a BUSINESS CARD becoming a
 * FORM. The avatar is 72px and then 34px. Email and date of birth share one
 * line pinned to the card's bottom edge in the reading view, and become two
 * full-width labelled rows in the form — the longest journey on the stage,
 * and the one that makes the claim legible. The card's OUTER box is
 * identical in both states, so every pixel of motion is the contents moving
 * and none of it is the container.
 *
 * WHY WORDS, AND WHY THE SWAP STAYS ON
 * The first cut of this demo passed `@swap='none'`, reasoning that both sides
 * say the SAME thing — "Marguerite" is "Marguerite" — so a dissolve would be
 * a word crossfading with itself. That confused two different questions. The
 * swap is not about whether the TEXT differs; it is about the fact that these
 * are two different DOM nodes, one in each branch of the an if/else. Turn it
 * off and neither is crossfaded: the departing word stays fully opaque in the
 * orphan layer while the arriving one sits at opacity 0, and every pass
 * leaves another pair behind. Three copies of one word, and the flight
 * invisible under them.
 *
 * With the swap left alone the box flies and the two skins cross inside it.
 * Because the text is identical the crossfade is invisible, which is the
 * point: you see one word travelling and resetting, not a dissolve.
 *
 * WHY A VARIABLE FONT IS LOAD-BEARING
 * Reading type here is 30px at weight 700; the form's is 17px at 400. With
 * static cuts those are two different files and the browser can only swap
 * between them — the weight would pop at whatever frame the swap lands on.
 * Archivo is variable (`wght 400..700`, already loaded by the stylesheet), so
 * `fontWeight` is a number the engine can interpolate, and it is registered
 * unitless in the library so it interpolates as one. The size tween rides the
 * same curve.
 *
 * `fontSize` is layout, not a transform, so this is the one demo in the
 * gallery that deliberately animates a layout property: the alternative is
 * scaling a projection, which stretches glyphs rather than setting them, and
 * "the type is really 17px now" is the whole claim.
 */
export class InlineEdit extends Component {
  @tracked editing = false;
  @tracked record: Record<Key, string> = {
    dob: '14 March 1986',
    email: 'm.villanueva@kiln.studio',
    name: 'Marguerite Villanueva',
  };

  /** the live editable nodes, so a commit can read what was typed */
  private live = new Map<Key, HTMLElement>();

  fields = FIELDS;

  /**
   * Bumped only when a commit actually changes the record.
   *
   * A word's identity has to be STABLE across a mode toggle — that is the
   * whole point, one node in both states — and DISPOSABLE across a commit.
   * Typing into a contenteditable rewrites nodes Glimmer still believes it
   * owns; re-rendering the each over that wreckage is how this demo hung.
   * Folding the revision into the id means a commit hands Glimmer a set of
   * keys it has never seen, so it builds fresh nodes instead of adopting
   * ones the browser has been editing behind its back.
   */
  @tracked private revision = 0;

  /** a value split into the words that will each fly on their own */
  words = (key: Key) =>
    this.record[key]
      .split(/\s+/)
      .filter(Boolean)
      .map((word, index) => ({
        id: `${key}-r${this.revision}-w${index}`,
        word,
      }));

  /** the record's initials, which cross as one identity of their own */
  get initials() {
    return this.record.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('');
  }

  /* — the two type scales the crossing interpolates between — */

  /* — the type, as the score animates it — */

  /**
   * Every pose below is a PAIR: where the value is coming from, and where it
   * is going. That is not decoration, it is the only shape that works here.
   *
   * The rest poses live in the stylesheet, keyed by `[data-mode]`, which is
   * where a rest pose belongs — but it also means the new value is already on
   * the element by the time the region measures the pass. A step given one
   * target would find the element already there and animate nothing, which is
   * exactly what this demo did for a day: the words teleported between scales
   * while their boxes flew correctly around them. A keyframe array says both
   * ends in one value, so the step re-states where to start from.
   *
   * The reading pose is the one with variety — a large bold name over two
   * quiet secondary values. The form has none: every field is 17px regular,
   * because a form is a place where all the values are the same kind of
   * thing. Losing that variety IS the animation.
   */
  get nameSize() {
    return this.editing ? ['30px', '17px'] : ['17px', '30px'];
  }

  get nameWeight() {
    return this.editing ? [700, 400] : [400, 700];
  }

  get subSize() {
    return this.editing ? ['13px', '17px'] : ['17px', '13px'];
  }

  get subWeight() {
    return this.editing ? [500, 400] : [400, 500];
  }

  get initialSize() {
    return this.editing ? ['28px', '14px'] : ['14px', '28px'];
  }

  get avatarRadius() {
    return this.editing ? ['36px', '10px'] : ['10px', '36px'];
  }

  /** the plate does not travel: it expands into place and fades up */
  get plateOpacity() {
    return this.editing ? [0, 1] : [1, 0];
  }

  get plateScale() {
    return this.editing ? [0.72, 1] : [1, 0.72];
  }

  /**
   * Hold the editable node. Its content is rendered ONCE per pass and then
   * left alone: the browser owns the text while a field is being typed into,
   * and re-rendering under a caret is how a contenteditable loses it.
   */
  hold = modifier((el: HTMLElement, [key]: [Key]) => {
    this.live.set(key, el);
    return () => this.live.delete(key);
  });

  toggle = () => {
    if (this.editing) {
      // read what was typed BEFORE the pass, or the nodes are already gone
      const next = { ...this.record };
      for (const { key } of FIELDS) {
        const el = this.live.get(key);
        const text = el?.textContent?.replace(/\s+/g, ' ').trim();
        if (text) {
          next[key] = text;
        }
      }
      const changed = FIELDS.some(({ key }) => next[key] !== this.record[key]);
      if (changed) {
        this.record = next;
        this.revision++;
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
            {{! The form's chrome is its OWN element, and that is the point.
                While the box that held the words was also the box that drew
                the border, the frame had to fly with the text — it slid and
                stretched across the card behind the words, and the eye read
                the chrome as the thing that was moving. A plate that is not
                the text container never has to follow it: it sits where the
                form puts it and does one thing, which is arrive. }}
            <span
              class="ie-plate"
              {{motion id=(concat field.key "-plate") role="plate"}}
            ></span>
            {{! The label is the only part of a field that is genuinely NEW in
                the form: it arrives with the editor and leaves with it, which
                is what says the card changed MODE rather than reflowed. }}
            {{#if this.editing}}
              <span
                class="ie-label"
                {{motion id=(concat field.key "-label") role="label"}}
              >{{field.label}}</span>
            {{/if}}

            {{! ONE box, and one set of words, in both states.
                They were two — a value and an editor in opposite branches of
                an if/else
            — which made every word a counterpart pair the crossing had to
            align. It could not, because the arriving copy was animating its own
            font-size and so changing the very box the pin was computed against:
            mid-flight you saw the name twice, one large and one small, sliding
            past each other. A word that never stops existing has nothing to
            align with. }}
            <div
              class="ie-box"
              data-test-field={{field.key}}
              contenteditable={{if this.editing "true" "false"}}
              spellcheck="false"
              role={{if this.editing "textbox" "text"}}
              aria-label={{field.label}}
              {{this.hold field.key}}
              {{motion id=(concat field.key "-box") role="box"}}
            >
              {{#each (this.words field.key) key="id" as |part|}}
                <span
                  class="ie-word"
                  {{motion id=part.id role=field.role}}
                >{{part.word}}</span>
              {{/each}}
            </div>
          </div>
        {{/each}}

        {{! One crossing for the whole card: the label arriving, the kicker
            swapping its words, the avatar changing shape. The field boxes and
            the words inside them are KEPT identities, so they are `c.Move`'s
            business — a real box tween, the way the Crossing demo moves its
            plate rather than crop-scaling it. }}
        <c.Parallel>
          <c.Crossing
            @duration={{MOVE}}
            @ease={{EASE}}
            @leave={{0.2}}
            @arrive={{0.28}}
            @overlap={{0.42}}
          />
          {{! Only the RECORD moves — the words, the avatar, the hairline.
              The field plates are deliberately absent from every Move: they
              belong to the container, not to the text, so they arrive where
              the form puts them and fade up in place. }}
          <c.Move
            @of={{c.moved "name-value"}}
            @duration={{MOVE}}
            @ease={{EASE}}
          />
          <c.Move
            @of={{c.moved "sub-value"}}
            @duration={{MOVE}}
            @ease={{EASE}}
          />
          <c.Move @of={{c.moved "avatar"}} @duration={{MOVE}} @ease={{EASE}} />
          <c.Move @of={{c.moved "rule"}} @duration={{MOVE}} @ease={{EASE}} />

          <c.Tween
            @of={{c.kept "plate"}}
            @opacity={{this.plateOpacity}}
            @scaleY={{this.plateScale}}
            @duration={{BOX}}
            @ease={{SOFT}}
          />

          <c.Tween
            @of={{c.kept "name-value"}}
            @fontSize={{this.nameSize}}
            @fontWeight={{this.nameWeight}}
            @duration={{TYPE}}
            @ease={{SOFT}}
          />
          <c.Tween
            @of={{c.kept "sub-value"}}
            @fontSize={{this.subSize}}
            @fontWeight={{this.subWeight}}
            @duration={{TYPE}}
            @ease={{SOFT}}
          />
          <c.Tween
            @of={{c.kept "initials"}}
            @fontSize={{this.initialSize}}
            @duration={{TYPE}}
            @ease={{SOFT}}
          />
          <c.Tween
            @of={{c.kept "avatar"}}
            @borderRadius={{this.avatarRadius}}
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
