// Pretui — Combobox usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { PLACES, TEAS, pick, seedFrom } from '../examples';
import { Combobox } from './combobox';
import { FreestyleUsage } from './freestyle-usage';

// ── Combobox ← the Lookup engine over plain {value,label} options ────────
// Same ember-power-select engine as Lookup, single-valued. Where Pretui's
// Select puts the search box inside the dropdown (power-select resolves
// searchFieldPosition to 'before-options' for single selects), a combobox
// needs the text field to BE the control — so this rides the multiple
// trigger and caps the selection at one.
class ComboboxUsage extends Component {
  origins = PLACES.slice(0, 10).map((name, i) => ({
    value: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label: name,
    meta: pick(seedFrom(name), i, TEAS),
  }));
  @tracked value = '';
  @tracked term = '';
  @tracked placeholder = 'Type to filter origins…';
  @tracked disabled = false;
  @tracked invalid = false;

  get optionValues() {
    return this.origins.map((o) => o.value);
  }
  setValue = (v: string) => (this.value = v);
  setTerm = (v: string) => (this.term = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setInvalid = (v: boolean) => (this.invalid = v);

  get usage() {
    let bits = ['@options={{this.origins}}', `@value='${this.value}'`];
    if (this.placeholder) {
      bits.push(`@placeholder='${this.placeholder}'`);
    }
    if (this.disabled) {
      bits.push('@disabled={{true}}');
    }
    if (this.invalid) {
      bits.push('@invalid={{true}}');
    }
    bits.push('@onValueChange={{this.setValue}}');
    return `<Combobox ${bits.join('\n  ')}\n/>`;
  }

  <template>
    <FreestyleUsage
      @name='Combobox'
      @description='A free-text input over a filtering listbox — the control for a closed set that is too long to scroll comfortably and too short to need a server. Type and the list narrows; Enter or click commits; the chosen label stays in the field as editable-looking text with a clear control. Reach for Combobox over Select whenever the option count passes roughly a dozen, and over Lookup whenever the values are plain data rather than records. It rides the same ember-power-select engine as Lookup (BoxelMultiSelectBasic, rendered in place), so dismissal, Escape, focus return, arrow keys, the aria-activedescendant wiring and the result-count live region are the engine’s. Honest limits: it will NOT accept a value outside @options — creating on the fly is power-select-with-create, an addon the realm cannot import; filtering is local over @options, matched on label; and the listbox reports aria-multiselectable even though only one value can be held, because the single-value trigger is the multiple trigger with a cap of one.'
      @source={{this.usage}}
    >
      <:example>
        <Combobox
          @options={{this.origins}}
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @disabled={{this.disabled}}
          @invalid={{this.invalid}}
          @label='Growing origin'
          @onSearch={{this.setTerm}}
          @onValueChange={{this.setValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @required={{true}}
          @description='The full candidate list: {value, label, meta?}. Filtering is local, so hand over everything the user may pick.'
          @value={{this.origins}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @options={{this.optionValues}}
          @description='Controlled value. Omit it and the component holds its own (@defaultValue seeds that). Clearing emits an empty string.'
          @onInput={{this.setValue}}
        />
        <Args.Base
          @name='defaultValue'
          @type='String'
          @description='Uncontrolled initial value. Ignored once @value is supplied.'
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @defaultValue='Type to filter…'
          @description='Input placeholder.'
          @onInput={{this.setPlaceholder}}
        />
        <Args.Base
          @name='label'
          @type='String'
          @defaultValue='Choose an option'
          @description='Accessible name for the combobox input (passed to the engine as @ariaLabel).'
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @description='Blocks every interaction.'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='invalid'
          @defaultValue={{false}}
          @description='Error dress plus aria-invalid. It marks; it never validates.'
          @value={{this.invalid}}
          @onInput={{this.setInvalid}}
        />
        <Args.String
          @name='(search text)'
          @value={{this.term}}
          @description='READ-ONLY, and not an arg — the engine owns the search text. This row mirrors what @onSearch last reported.'
          @onInput={{this.setTerm}}
        />
        <Args.Action
          @name='onSearch'
          @description='Fires on every keystroke with the current search text. Useful for analytics or a "no match — create one?" affordance beside the field.'
        />
        <Args.Action
          @name='onValueChange'
          @description="Fires with the chosen value, or '' when the value is cleared."
        />
        <Args.Action
          @name='onOpenChange'
          @description='Fires with true/false when the dropdown opens or closes.'
        />
        <Args.Yield
          @name=':option'
          @description='Replaces the default row. Yields (option, {term}). The default row is the label with an optional right-aligned meta.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_COMBOBOX: Record<string, unknown> = {
  Combobox: ComboboxUsage,
};
