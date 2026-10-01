// Pretui — Autocomplete usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Autocomplete } from './autocomplete';
import type { AutocompleteItem } from './autocomplete';
import {
  PRETUI_APPEARANCES,
  PRETUI_SIZES,
  PRETUI_TONES,
} from '../pretui-primitives';
import type {
  PretuiAppearance,
  PretuiSize,
  PretuiTone,
} from '../pretui-primitives';

const TONES = [...PRETUI_TONES];
const APPEARANCES = [...PRETUI_APPEARANCES];
const SIZES = [...PRETUI_SIZES];
const FILTERS = ['contains', 'starts-with', 'none'];
const ENTER_MODES = ['deliberate', 'highlight', 'text'];

// ── Autocomplete ← MUI freeSolo / Mantine / Base UI / Ant AutoComplete ───
const CITIES: AutocompleteItem[] = [
  { value: 'Amsterdam', meta: 'NL' },
  { value: 'Antwerp', meta: 'BE' },
  { value: 'Athens', meta: 'GR' },
  { value: 'Auckland', meta: 'NZ' },
  { value: 'Barcelona', meta: 'ES' },
  { value: 'Belgrade', meta: 'RS' },
  { value: 'Berlin', meta: 'DE' },
  { value: 'Bogotá', meta: 'CO' },
  { value: 'Copenhagen', meta: 'DK' },
  { value: 'Dakar', meta: 'SN' },
  { value: 'Edinburgh', meta: 'GB' },
  { value: 'Kyoto', meta: 'JP', disabled: true },
  { value: 'Lisbon', meta: 'PT' },
  { value: 'Montréal', meta: 'CA' },
  { value: 'Reykjavík', meta: 'IS' },
  { value: 'Valparaíso', meta: 'CL' },
];

export class AutocompleteUsage extends Component {
  tones = TONES;
  appearances = APPEARANCES;
  sizes = SIZES;
  filters = FILTERS;
  enterModes = ENTER_MODES;
  cities = CITIES;

  @tracked value = '';
  @tracked committedValue = '(nothing committed yet)';
  @tracked lastQuery = '';
  @tracked filter = 'contains';
  @tracked enterCommits = 'deliberate';
  @tracked autoHighlight = false;
  @tracked openOnFocus = true;
  @tracked clearable = true;
  @tracked busy = false;
  @tracked invalid = false;
  @tracked disabled = false;
  @tracked tone = 'neutral';
  @tracked appearance = 'filled-outlined';
  @tracked sizeName = 'm';
  @tracked minChars = 0;
  @tracked maxVisible = 8;

  setValue = (v: string) => (this.value = v);
  onCommit = (v: string, item?: AutocompleteItem) => {
    this.committedValue = item ? v + ' (suggestion)' : v + ' (free text)';
  };
  onSearch = (q: string) => (this.lastQuery = q);
  setFilter = (v: string) => (this.filter = v);
  setEnterCommits = (v: string) => (this.enterCommits = v);
  setAutoHighlight = (v: boolean) => (this.autoHighlight = v);
  setOpenOnFocus = (v: boolean) => (this.openOnFocus = v);
  setClearable = (v: boolean) => (this.clearable = v);
  setBusy = (v: boolean) => (this.busy = v);
  setInvalid = (v: boolean) => (this.invalid = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setTone = (v: string) => (this.tone = v);
  setAppearance = (v: string) => (this.appearance = v);
  setSize = (v: string) => (this.sizeName = v);
  setMinChars = (v: number | null) => (this.minChars = v ?? 0);
  setMaxVisible = (v: number | null) => (this.maxVisible = v ?? 8);

  get filterVal() {
    return this.filter as 'contains' | 'starts-with' | 'none';
  }
  get enterVal() {
    return this.enterCommits as 'deliberate' | 'highlight' | 'text';
  }
  get toneVal() {
    return this.tone as PretuiTone;
  }
  get appearanceVal() {
    return this.appearance as PretuiAppearance;
  }
  get sizeVal() {
    return this.sizeName as PretuiSize;
  }
  get usage() {
    return [
      '<Autocomplete',
      '@items={{this.cities}}',
      '@value={{this.value}}',
      '@onChange={{this.setValue}}',
      '@onCommit={{this.onCommit}}',
      "@label='City'",
      '/>',
    ].join(' ');
  }

  <template>
    <FreestyleUsage
      @name='Autocomplete'
      @description='Free text WITH suggestions beside it. Combobox constrains the value to its listbox and Lookup resolves a record; here the typed string stands on its own, which is what MUI calls freeSolo. The hard question is what Enter means when the highlighted suggestion and the typed text disagree — this component answers it in one exported six-line function and one knob, where MUI hides the same rule in four interacting flags. Home and End are deliberately left to the caret, because the value is prose.'
      @source={{this.usage}}
      @viewportMode='narrow'
    >
      <:example>
        <div class='ac-demo-slot'>
          <Autocomplete
            @items={{this.cities}}
            @value={{this.value}}
            @onChange={{this.setValue}}
            @onCommit={{this.onCommit}}
            @onSearch={{this.onSearch}}
            @label='City'
            @placeholder='Type a city, or anything else'
            @filter={{this.filterVal}}
            @enterCommits={{this.enterVal}}
            @autoHighlight={{this.autoHighlight}}
            @openOnFocus={{this.openOnFocus}}
            @clearable={{this.clearable}}
            @busy={{this.busy}}
            @invalid={{this.invalid}}
            @disabled={{this.disabled}}
            @tone={{this.toneVal}}
            @appearance={{this.appearanceVal}}
            @size={{this.sizeVal}}
            @minChars={{this.minChars}}
            @maxVisible={{this.maxVisible}}
          />
        </div>
        <p class='pretui-demo-readout' data-test-ac-readout>
          value = {{this.value}} · committed = {{this.committedValue}} · last
          query = {{this.lastQuery}}
        </p>
        <p class='pretui-demo-note'>
          Try it: type
          <b>be</b>, then press Enter without touching the arrows — you get the
          text you typed. Type
          <b>be</b>
          again, press ArrowDown to Belgrade, then Enter — you get Belgrade.
          Turn autoHighlight on and repeat the first one: the pre-highlighted
          row still does not win, because the reader did not put it there.
          Kyoto is disabled and the arrows step over it.
        </p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @description='The suggestion collection. Each carries a value, an optional label, an optional meta line and an optional disabled flag. options is accepted as an alias, since that is the noun every React kit uses.'
          @value={{this.cities}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @description='Controlled text. In an autocomplete the value IS what the reader typed — that is the whole difference from Combobox, whose value is constrained to its listbox. Omit and seed defaultValue for uncontrolled use.'
          @onInput={{this.setValue}}
        />
        <Args.Action
          @name='onChange'
          @description='Fires on every keystroke with the current text. onValueChange is accepted as an alias and both fire if both are supplied.'
        />
        <Args.Action
          @name='onCommit'
          @description='Fires when a value is MEANT rather than merely typed — Enter, a click on a suggestion, or blur — with the chosen item as a second argument and undefined for free text. This is the callback that separates typing from deciding, and no React source in the survey exposes it.'
        />
        <Args.Action
          @name='onSearch'
          @description='The debounced query, for a caller that fetches suggestions. Pair it with filter set to none, since the server already decided what matches.'
        />
        <Args.Number
          @name='debounce'
          @defaultValue={{0}}
          @description='Seconds of quiet before onSearch fires. Seconds, not milliseconds — the kit uses seconds for every duration. Zero, the default, fires on every keystroke and schedules no timer at all; any non-zero handle is owned by an ember-modifier and cleared in its destructor.'
        />
        <Args.String
          @name='filter'
          @defaultValue='contains'
          @value={{this.filter}}
          @options={{this.filters}}
          @description='Local matching. contains is what every React kit ships, starts-with is the prefix behaviour an identifier field wants, and none means the caller has already filtered — the correct mode for async, where re-filtering the server answer against the current keystroke hides rows it deliberately returned.'
          @onInput={{this.setFilter}}
        />
        <Args.String
          @name='enterCommits'
          @defaultValue='deliberate'
          @value={{this.enterCommits}}
          @options={{this.enterModes}}
          @description='What Enter means when the highlight and the typed text disagree. deliberate lets a suggestion win only when the reader arrowed to it with the keyboard; highlight is the strict listbox behaviour; text never lets a suggestion win. MUI reaches the same default through an undocumented branch on whether the highlight was programmatic.'
          @onInput={{this.setEnterCommits}}
        />
        <Args.Bool
          @name='autoHighlight'
          @defaultValue={{false}}
          @value={{this.autoHighlight}}
          @description='Pre-highlight the first row when suggestions appear. Note that an automatic highlight still does not win Enter under the default enterCommits — that combination is exactly the bug this component is designed not to have.'
          @onInput={{this.setAutoHighlight}}
        />
        <Args.Bool
          @name='openOnFocus'
          @defaultValue={{true}}
          @value={{this.openOnFocus}}
          @description='Open the suggestion layer when the field receives focus, provided there is anything to suggest.'
          @onInput={{this.setOpenOnFocus}}
        />
        <Args.Number
          @name='minChars'
          @defaultValue={{0}}
          @value={{this.minChars}}
          @description='Hold the layer shut until this many characters are typed. The layer still reports open through onOpenChange, so a controlled caller never desynchronises.'
          @onInput={{this.setMinChars}}
        />
        <Args.Number
          @name='maxVisible'
          @defaultValue={{8}}
          @value={{this.maxVisible}}
          @description='Cap on rendered rows. The rest are reachable by narrowing, which is the honest alternative to a scroll container holding four hundred options.'
          @onInput={{this.setMaxVisible}}
        />
        <Args.Bool
          @name='clearable'
          @defaultValue={{false}}
          @value={{this.clearable}}
          @description='Show a named clear button once the field has text.'
          @onInput={{this.setClearable}}
        />
        <Args.Bool
          @name='busy'
          @defaultValue={{false}}
          @value={{this.busy}}
          @description='Pending: aria-busy on the field, a spinner, and focus retained. loading and isPending are accepted as aliases.'
          @onInput={{this.setBusy}}
        />
        <Args.Bool
          @name='invalid'
          @defaultValue={{false}}
          @value={{this.invalid}}
          @description='Error dress plus aria-invalid. isInvalid is accepted as an alias. The focus ring still wins over the error ring, so a reader can always see where they are.'
          @onInput={{this.setInvalid}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @description='Dims and inerts through aria-disabled, never the native attribute. isDisabled is accepted as an alias.'
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='label'
          @defaultValue='Search'
          @description='Accessible name, rendered as a real sr-only label pointing at the field. A wrapper that owns the visible label passes controlId instead, and then this component renders no label of its own — two names on one field is a defect, and realm lint agrees.'
        />
        <Args.String
          @name='tone'
          @defaultValue='neutral'
          @value={{this.tone}}
          @options={{this.tones}}
          @description='Semantic hue for the field and the matched run in each row.'
          @onInput={{this.setTone}}
        />
        <Args.String
          @name='appearance'
          @defaultValue='filled-outlined'
          @value={{this.appearance}}
          @options={{this.appearances}}
          @description='The field recipe. filled-outlined is the house default dress for inputs.'
          @onInput={{this.setAppearance}}
        />
        <Args.String
          @name='size'
          @defaultValue='m'
          @value={{this.sizeName}}
          @options={{this.sizes}}
          @description='Size scale. Accepts sm, md, lg and default as aliases.'
          @onInput={{this.setSize}}
        />
        <Args.Bool
          @name='open'
          @description='Controlled suggestion layer. Pair with onOpenChange; defaultOpen is the uncontrolled seed.'
        />
        <Args.Yield
          @name='item'
          @description='Replaces the default row body, yielding the item and the live query. It renders inside an aria-hidden face, so any markup is legal here — the option name is computed rather than scraped, which is what keeps a caller who yields an avatar from failing realm lint in their own file.'
        />
        <Args.Yield
          @name='empty'
          @description='Replaces the built-in empty line. The built-in one is deliberate — a mark, the reason, and the next action — rather than a bare no results.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-ac-h'
          @description='Minimum field height, em-scaled off the resolved size.'
          @defaultValue='2.24em'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      /* The layer renders in place and is absolutely positioned, so the demo
         slot reserves room for it rather than letting it clip the artboard. */
      .ac-demo-slot {
        min-height: 18em;
        max-width: 26em;
      }
      .pretui-demo-readout {
        margin: 12px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .pretui-demo-note {
        margin: 16px 0 0;
        font-size: var(--text-ui-xs, 11px);
        line-height: 1.5;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}


export const DEMOS_AUTOCOMPLETE: Record<string, unknown> = {
  Autocomplete: AutocompleteUsage,
};
