import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { ComponentLike } from '@glint/template';
import { motion } from 'glimmer-motion';

/**
 * Three real form fields, written the way pretui writes them.
 *
 * COPIED IN RATHER THAN DEPENDED ON, deliberately. pretui's own `Input` is a
 * wrapper over boxel-ui's `BoxelInput` — it delegates validation state, the
 * aria-invalid/errormessage wiring and the helper and error rows — and its
 * `KnownDate` is six hundred lines with dependencies of its own. Taking
 * either as a dependency would drag boxel-ui into a motion gallery to prove
 * a point about text. So these are the same field SHAPES, written small:
 * real inputs, real types, real keyboards.
 *
 * That they are real inputs is the whole reason this file exists. A word in
 * the reading view is a `<span>` in flow; the value in the form is the value
 * of an `<input>`, and no amount of choreography can make one element be
 * both. The demo above them does not try: it hands off.
 */

export interface FieldArgs {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}

const value = (event: Event) => (event.target as HTMLInputElement).value;

/**
 * What a field IS, to anything that holds a list of them.
 *
 * The three below differ in their root element — two inputs and a group —
 * and a union of the classes themselves is not invokable because of it. One
 * declared shape is what lets a card iterate its fields instead of writing
 * an if/else per key, which is the whole point of a field registry.
 */
export type FieldComponent = ComponentLike<{
  Args: FieldArgs;
  Element: HTMLElement;
}>;

/** the plain one: a name, a title, anything that is just text */
export class TextField extends Component<{
  Args: FieldArgs;
  Element: HTMLElement;
}> {
  change = (event: Event) => this.args.onChange(value(event));
  <template>
    <input
      class="pt-input"
      type="text"
      id={{@id}}
      value={{@value}}
      aria-label={{@label}}
      autocomplete="name"
      spellcheck="false"
      enterkeyhint="done"
      {{on "input" this.change}}
      ...attributes
    />
  </template>
}

/**
 * `type='email'` is not decoration. It is the mobile keyboard with the `@`
 * on it, the browser's own autofill category, and free format validation —
 * three things a text input with a nicer placeholder does not give you.
 */
export class EmailField extends Component<{
  Args: FieldArgs;
  Element: HTMLElement;
}> {
  change = (event: Event) => this.args.onChange(value(event));
  <template>
    <input
      class="pt-input"
      type="email"
      id={{@id}}
      value={{@value}}
      aria-label={{@label}}
      inputmode="email"
      autocomplete="email"
      spellcheck="false"
      enterkeyhint="done"
      {{on "input" this.change}}
      ...attributes
    />
  </template>
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => String(from + index));

const DAYS = range(1, 31);
const YEARS = range(1930, 2012).reverse();

/**
 * Three dropdowns: day, month, year — pretui's `KnownDate` shape.
 *
 * Segmented rather than a native `<input type='date'>`, which is a single
 * opaque widget whose text you cannot address and which cannot hold a date a
 * person only half-remembers. Three closed lists rather than three text
 * boxes, because every part of a date IS a closed list, and a picker that
 * knows February has no thirtieth is worth more than free text that does
 * not.
 *
 * The segmentation is also what makes the handover land: "14 March 1986" is
 * three words in the reading view and three controls here, so each word has
 * somewhere of its own to arrive.
 */
export class DateField extends Component<{
  Args: FieldArgs;
  Element: HTMLElement;
}> {
  /**
   * A closed list is not free, and on WebKit it is expensive.
   *
   * Day, month and year is 31 + 12 + 83 options — a hundred and twenty-six
   * elements, built every time the form opens. Blink does that in about
   * fifty milliseconds. WebKit builds a native menu structure per select and
   * is an order of magnitude slower at it, which is where the FOUR SECONDS
   * between clicking Edit and the card settling came from. It looked like an
   * animation problem for a long time, and it survived turning the entire
   * choreography off — which is what finally placed it.
   *
   * So a select holds exactly one option, the one it is showing, until it is
   * about to be used. `pointerdown` fires before the menu opens and `focus`
   * covers the keyboard, so by the time a list is needed it is there.
   */
  @tracked private live = new Set<string>();

  private fill = (part: string) => () => {
    if (!this.live.has(part)) {
      this.live = new Set([...this.live, part]);
    }
  };

  options = (part: 'day' | 'month' | 'year') => {
    const all = { day: DAYS, month: MONTHS, year: YEARS }[part];
    if (this.live.has(part)) {
      return all;
    }
    // one option, so the control shows its value and costs nothing
    const current = this.parts[part];
    return all.includes(current) ? [current] : all.slice(0, 1);
  };

  get parts() {
    const [day = '', month = '', year = ''] = this.args.value.split(/\s+/);
    return { day, month, year };
  }

  private emit(next: { day?: string; month?: string; year?: string }) {
    const parts = { ...this.parts, ...next };
    this.args.onChange(`${parts.day} ${parts.month} ${parts.year}`.trim());
  }

  day = (event: Event) => this.emit({ day: value(event) });
  month = (event: Event) => this.emit({ month: value(event) });
  year = (event: Event) => this.emit({ year: value(event) });

  <template>
    <div class="pt-date" role="group" aria-label={{@label}} ...attributes>
      <select
        class="pt-input pt-date-day"
        {{motion id=(concat @id "-day") role="chip"}}
        id={{@id}}
        aria-label="Day"
        {{on "change" this.day}}
        {{on "pointerdown" (this.fill "day")}}
        {{on "focus" (this.fill "day")}}
        {{on "keydown" (this.fill "day")}}
      >
        {{#each (this.options "day") as |day|}}
          <option value={{day}} selected={{isSame day this.parts.day}}>
            {{day}}
          </option>
        {{/each}}
      </select>
      <select
        class="pt-input pt-date-month"
        {{motion id=(concat @id "-month") role="chip"}}
        aria-label="Month"
        {{on "change" this.month}}
        {{on "pointerdown" (this.fill "month")}}
        {{on "focus" (this.fill "month")}}
        {{on "keydown" (this.fill "month")}}
      >
        {{#each (this.options "month") as |month|}}
          <option value={{month}} selected={{isSame month this.parts.month}}>
            {{month}}
          </option>
        {{/each}}
      </select>
      <select
        class="pt-input pt-date-year"
        {{motion id=(concat @id "-year") role="chip"}}
        aria-label="Year"
        {{on "change" this.year}}
        {{on "pointerdown" (this.fill "year")}}
        {{on "focus" (this.fill "year")}}
        {{on "keydown" (this.fill "year")}}
      >
        {{#each (this.options "year") as |year|}}
          <option value={{year}} selected={{isSame year this.parts.year}}>
            {{year}}
          </option>
        {{/each}}
      </select>
    </div>
  </template>
}

/** `selected` wants a boolean, and there is no `eq` in a strict template */
function isSame(a: string, b: string) {
  return a === b;
}
