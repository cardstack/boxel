// Pretui — SearchInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { SearchInput } from './search-input';
import { LayoutControl } from './layout-control';
import { Button } from './button';
import { IconButton } from './icon-button';
import { iconFor } from '../icon-registry';

const ICON_ONLY = [{ name: 'icon', minWidth: 2 }];
const ROW_WIDTHS = ['18rem', '26rem', '36rem'];

// ── SearchInput — typed-input split, fresh page ──────────────────────────
// Type-specific knob: clearable (the ✕ button). Wave-0 adaptation on
// record: no debounce knob — realm code takes no timers; debounce belongs
// to the consumer's data layer.
class SearchInputUsage extends Component {
  @tracked value = '';
  @tracked placeholder = 'Search components…';
  @tracked clearable = true;
  @tracked disabled = false;
  @tracked display = 'field';
  displays = ['field', 'collapsed'];
  rowWidths = ROW_WIDTHS;
  iconOnly = ICON_ONLY;
  more = iconFor('ellipsis');
  setDisplay = (v: string) => (this.display = v);
  get displayVal() {
    return this.display as 'field' | 'collapsed';
  }
  setValue = (v: string) => (this.value = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setClearable = (v: boolean) => (this.clearable = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.placeholder) bits.push(`@placeholder='${this.placeholder}'`);
    if (!this.clearable) bits.push('@clearable={{false}}');
    if (this.display !== 'field') bits.push(`@display='${this.display}'`);
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
          @display={{this.displayVal}}
          @onInput={{this.setValue}}
        />
        <p class='pretui-demo-readout' data-test-search-readout>
          value = “{{this.value}}”
        </p>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='display'
          @value={{this.display}}
          @options={{this.displays}}
          @defaultValue='field'
          @description='field is the whole field. collapsed is a square button, as wide as the field is high, showing only the magnifier; a click opens the full field across the whole LayoutControl row, from its start (--pretui-search-open-w overrides the width; outside a row it is 15rem), Escape closes it and returns focus to the button, and the value carries across. --pretui-field-h sets the height.'
          @onInput={{this.setDisplay}}
        />
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
    <FreestyleUsage
      @name='SearchInput collapsed in a LayoutControl row'
      @description='The opened field covers the whole row, from its start, at any row width, so no neighbouring control shows beside it. Focus moves into the field on open; Escape or leaving returns it to the magnifier.'
    >
      <:example>
        {{#each this.rowWidths as |w|}}
          <div class='pretui-demo-row' data-demo-width={{w}}>
            <LayoutControl @label='Row {{w}}' as |lc|>
              <lc.Slot @id='search' @forms={{this.iconOnly}} @label='Search'>
                <SearchInput @display='collapsed' @placeholder='Search' />
              </lc.Slot>
              <lc.Slot @id='add' @forms={{this.iconOnly}} @label='New'>
                <Button @tone='primary'>New</Button>
              </lc.Slot>
              <IconButton @label='More options' @icon={{this.more}} />
            </LayoutControl>
          </div>
        {{/each}}
      </:example>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-row {
        max-inline-size: 100%;
        margin-block-end: var(--boxel-sp-sm);
      }
      .pretui-demo-row[data-demo-width='18rem'] {
        inline-size: 18rem;
      }
      .pretui-demo-row[data-demo-width='26rem'] {
        inline-size: 26rem;
      }
      .pretui-demo-row[data-demo-width='36rem'] {
        inline-size: 36rem;
      }
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
