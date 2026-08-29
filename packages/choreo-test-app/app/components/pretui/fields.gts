import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
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
  days = DAYS;
  months = MONTHS;
  years = YEARS;

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
      >
        {{#each this.days as |day|}}
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
      >
        {{#each this.months as |month|}}
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
      >
        {{#each this.years as |year|}}
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
