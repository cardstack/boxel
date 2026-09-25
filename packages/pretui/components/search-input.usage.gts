// Pretui — SearchInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { SearchInput } from './search-input';

// ── SearchInput — typed-input split, fresh page ──────────────────────────
// Type-specific knob: clearable (the ✕ button). Wave-0 adaptation on
// record: no debounce knob — realm code takes no timers; debounce belongs
// to the consumer's data layer.
class SearchInputUsage extends Component {
  @tracked value = '';
  @tracked placeholder = 'Search components…';
  @tracked clearable = true;
  @tracked disabled = false;
  setValue = (v: string) => (this.value = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setClearable = (v: boolean) => (this.clearable = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.placeholder) bits.push(`@placeholder='${this.placeholder}'`);
    if (!this.clearable) bits.push('@clearable={{false}}');
    bits.push('@onInput={{this.setValue}}');
    return `<SearchInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='SearchInput'
      @description="Search field riding boxel-ui BoxelInput (@type=search) — the leading magnifier re-dressed in Pretui field tokens — plus the clear button boxel-ui doesn't ship: a ✕ appears once the field holds text and resets it through @onInput('')."
      @source={{this.usage}}
    >
      <:example>
        <SearchInput
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @clearable={{this.clearable}}
          @disabled={{this.disabled}}
          @onInput={{this.setValue}}
        />
        <p class='pretui-demo-readout' data-test-search-readout>
          value = “{{this.value}}”
        </p>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='clearable'
          @defaultValue={{true}}
          @value={{this.clearable}}
          @description='Show the ✕ clear button while the field holds text.'
          @onInput={{this.setClearable}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onInput'
          @description="Receives the changed value as a string; the clear button sends ''."
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_SEARCH_INPUT: Record<string, unknown> = {
  SearchInput: SearchInputUsage,
};
