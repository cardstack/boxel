import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { Choreo, motion, to } from 'glimmer-motion';

/** the record's fields, in the order the card reads them */
const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'dob', label: 'Date of birth' },
] as const;

type Key = (typeof FIELDS)[number]['key'];

/** one duration for the whole crossing, so nothing arrives out of step */
const MOVE = 0.62;
const EASE = [0.2, 0, 0, 1] as const;

/** the type tween is its own curve: shorter, so weight lands before the move does */
const TYPE = { duration: 0.5, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * The same words, read and written.
 *
 * A record card in two states — a reading view and a form — and one
 * `<c.Crossing>` between them. Every word of every value is its own identity,
 * so a value does not dissolve into its editor: each word FLIES to where the
 * form puts it, and changes size and weight on the way.
 *
 * WHY WORDS, AND WHY THE SWAP STAYS ON
 * The first cut of this demo passed `@swap='none'`, reasoning that both sides
 * say the SAME thing — "Marguerite" is "Marguerite" — so a dissolve would be
 * a word crossfading with itself. That confused two different questions. The
 * swap is not about whether the TEXT differs; it is about the fact that these
 * are two different DOM nodes, one in each branch of the `{{#if}}`. Turn it
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

  /** a value split into the words that will each fly on their own */
  words = (key: Key) =>
    this.record[key]
      .split(/\s+/)
      .filter(Boolean)
      .map((word, index) => ({ id: `${key}-w${index}`, word }));

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

  /**
   * The two scales, addressed by mode rather than by "current".
   *
   * `initial` matters as much as `animate` here, and for a reason that is not
   * obvious: with `swap='none'` the crossing flies ONE box, but the arriving
   * word is still a different DOM node from the departing one. Left to
   * itself it mounts at whatever `.ie-word` inherits — 16px/400, since that
   * rule deliberately states no size — and then tweens from there. So the
   * form's words appeared to animate 16px -> 17px, which is nothing, while
   * the reading view's animated 16px -> 30px, which looked correct and was
   * correct by accident. Stating where the word COMES FROM is what makes
   * both directions travel the same distance.
   */
  private scale = (key: Key, editing: boolean) => ({
    size: editing ? '17px' : key === 'name' ? '30px' : '15px',
    weight: editing ? 400 : key === 'name' ? 700 : 500,
  });

  size = (key: Key) => this.scale(key, this.editing).size;
  weight = (key: Key) => this.scale(key, this.editing).weight;
  /** the type the counterpart is leaving behind */
  fromSize = (key: Key) => this.scale(key, !this.editing).size;
  fromWeight = (key: Key) => this.scale(key, !this.editing).weight;

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
      this.record = next;
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
              {{motion
                id="initials"
                role="type"
                pack="content"
                initial=(to fontSize=(if this.editing "22px" "15px"))
                animate=(to fontSize=(if this.editing "15px" "22px"))
                transition=TYPE
              }}
            >{{this.initials}}</b>
          </span>

          <span class="ie-kicker" {{motion id="kicker" role="type"}}>
            {{if this.editing "Editing record" "Customer"}}
          </span>
        </div>

        {{#each this.fields as |field|}}
          <div class="ie-field" data-field={{field.key}}>
            {{! the label belongs to the form only: it ARRIVES with the
                editor and leaves with it, which is what tells you the card
                changed mode rather than merely reflowing }}
            {{#if this.editing}}
              <span
                class="ie-label"
                {{motion id=(concat field.key "-label") role="label"}}
              >{{field.label}}</span>
            {{/if}}

            {{#if this.editing}}
              <div
                class="ie-input"
                data-test-editor={{field.key}}
                contenteditable="true"
                spellcheck="false"
                role="textbox"
                aria-label={{field.label}}
                tabindex="0"
                {{this.hold field.key}}
                {{motion id=(concat field.key "-box") role="box"}}
              >
                {{#each (this.words field.key) as |part|}}
                  <span
                    class="ie-word"
                    {{motion
                      id=part.id
                      role="word"
                      pack="content"
                      initial=(to
                        fontSize=(this.fromSize field.key)
                        fontWeight=(this.fromWeight field.key)
                      )
                      animate=(to
                        fontSize=(this.size field.key)
                        fontWeight=(this.weight field.key)
                      )
                      transition=TYPE
                    }}
                  >{{part.word}}</span>
                {{/each}}
              </div>
            {{else}}
              <div class="ie-value" data-test-value={{field.key}}>
                {{#each (this.words field.key) as |part|}}
                  <span
                    class="ie-word"
                    {{motion
                      id=part.id
                      role="word"
                      pack="content"
                      initial=(to
                        fontSize=(this.fromSize field.key)
                        fontWeight=(this.fromWeight field.key)
                      )
                      animate=(to
                        fontSize=(this.size field.key)
                        fontWeight=(this.weight field.key)
                      )
                      transition=TYPE
                    }}
                  >{{part.word}}</span>
                {{/each}}
              </div>
            {{/if}}
          </div>
        {{/each}}

        {{! One crossing for the whole card. `swap='none'` because every
            counterpart here says the same thing on both sides — a dissolve
            would be a word crossfading with itself. }}
        <c.Parallel>
          <c.Crossing
            @duration={{MOVE}}
            @ease={{EASE}}
            @leave={{0.2}}
            @arrive={{0.28}}
            @overlap={{0.42}}
          />
          <c.Move @of={{c.moved}} @duration={{MOVE}} @ease={{EASE}} />
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
