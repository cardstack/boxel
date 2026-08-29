import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';

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

const MONTHS = [
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

/**
 * Segmented, as pretui's `KnownDate` is: day, month, year, each its own
 * control. A native `<input type='date'>` is a single opaque widget whose
 * text you cannot address, and a date a person half-remembers — the year
 * without the day — cannot be typed into one at all.
 *
 * The segmentation is also what makes the handoff land: "14 March 1986" is
 * three words in the reading view and three controls here, so each word has
 * somewhere of its own to arrive.
 */
export class DateField extends Component<{
  Args: FieldArgs;
  Element: HTMLElement;
}> {
  months = MONTHS;

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
      <input
        class="pt-input pt-date-day"
        type="text"
        id={{@id}}
        value={{this.parts.day}}
        aria-label="Day"
        inputmode="numeric"
        maxlength="2"
        {{on "input" this.day}}
      />
      {{! A datalist rather than a <select>, and not for taste: a select
          paints its text at an inset the browser chooses and does not
          report, so a word flying to it lands eighteen pixels short in
          Chrome and somewhere else again elsewhere. An input paints at its
          content edge, which is a number this app already knows. The month
          list is still closed — the datalist supplies it — and this is
          still a segmented date, not a free-text one. }}
      <input
        class="pt-input pt-date-month"
        type="text"
        list="pt-months"
        value={{this.parts.month}}
        aria-label="Month"
        autocomplete="off"
        spellcheck="false"
        {{on "input" this.month}}
      />
      <datalist id="pt-months">
        {{#each this.months as |name|}}
          <option value={{name}}></option>
        {{/each}}
      </datalist>
      <input
        class="pt-input pt-date-year"
        type="text"
        value={{this.parts.year}}
        aria-label="Year"
        inputmode="numeric"
        maxlength="4"
        {{on "input" this.year}}
      />
    </div>
  </template>
}
