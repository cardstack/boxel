// Pretui — ToggleGroup usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { PRETUI_APPEARANCES } from '../pretui-primitives';
import type { PretuiAppearance, PretuiSize, PretuiTone } from '../pretui-primitives';
import { FreestyleUsage } from './freestyle-usage';
import { ToggleGroup } from './toggle-group';
import type { ToggleOption } from './toggle-group';
import { SIZES, TONES } from '../internal/toggle-controls-fixtures';

const APPEARANCES = [...PRETUI_APPEARANCES];
const ORIENTATIONS = ['horizontal', 'vertical'];

// ── ToggleGroup ← recurring-pattern weekday row + tag-filter-group ────────
const WEEKDAYS: ToggleOption[] = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun', disabled: true },
];

const FORMATTING: ToggleOption[] = [
  { value: 'note', label: 'Annotate', icon: 'pencil' },
  { value: 'mark', label: 'Highlight', icon: 'highlighter' },
  { value: 'code', label: 'Code', icon: 'code' },
];

class ToggleGroupUsage extends Component {
  tones = TONES;
  appearances = APPEARANCES;
  sizes = SIZES;
  orientations = ORIENTATIONS;
  options = WEEKDAYS;
  formatting = FORMATTING;

  @tracked days: string[] = ['mon', 'wed', 'fri'];
  @tracked day: string | undefined = 'wed';
  @tracked multiple = true;
  @tracked orientation = 'horizontal';
  @tracked tone = 'neutral';
  @tracked appearance = 'outlined';
  @tracked pressedAppearance = 'accent';
  @tracked sizeName = 'm';
  @tracked deselectable = true;
  @tracked wrap = true;
  @tracked marks: string[] = ['mark'];

  setDays = (v: string[]) => (this.days = v);
  setDay = (v: string | undefined) => (this.day = v);
  setMultiple = (v: boolean) => (this.multiple = v);
  setOrientation = (v: string) => (this.orientation = v);
  setTone = (v: string) => (this.tone = v);
  setAppearance = (v: string) => (this.appearance = v);
  setPressed = (v: string) => (this.pressedAppearance = v);
  setSize = (v: string) => (this.sizeName = v);
  setDeselectable = (v: boolean) => (this.deselectable = v);
  setWrap = (v: boolean) => (this.wrap = v);
  setMarks = (v: string[]) => (this.marks = v);

  get orientationVal() {
    return this.orientation as 'horizontal' | 'vertical';
  }
  get toneVal() {
    return this.tone as PretuiTone;
  }
  get appearanceVal() {
    return this.appearance as PretuiAppearance;
  }
  get pressedVal() {
    return this.pressedAppearance as PretuiAppearance;
  }
  get sizeVal() {
    return this.sizeName as PretuiSize;
  }
  get readout() {
    return this.multiple
      ? this.days.join(', ') || 'nothing selected'
      : (this.day ?? 'nothing selected');
  }
  get usage() {
    let bits = ["@label='Repeat on'"];
    if (this.multiple) {
      bits.push('@multiple={{true}}', '@values={{this.days}}', '@onValuesChange={{this.setDays}}');
    } else {
      bits.push('@value={{this.day}}', '@onValueChange={{this.setDay}}');
    }
    bits.push('@options={{this.weekdays}}');
    return `<ToggleGroup ${bits.join(' ')} />`;
  }

  <template>
    <FreestyleUsage
      @name='ToggleGroup'
      @description="A set of mutually-related toggles in one named group. The whole point is that the ARIA changes with the mode: single-select is a radiogroup of radios where the arrows move AND choose, multi-select is a toolbar of aria-pressed buttons where the arrows only move and Space toggles. Both are one tab stop with arrows, Home and End inside. Sourced from the recurring-pattern weekday row and catalog-app's tag-filter-group, neither of which had a group, a name, a pressed state or a keyboard."
      @source={{this.usage}}
    >
      <:example>
        <ToggleGroup
          @options={{this.options}}
          @label='Repeat on'
          @multiple={{this.multiple}}
          @values={{this.days}}
          @onValuesChange={{this.setDays}}
          @value={{this.day}}
          @onValueChange={{this.setDay}}
          @orientation={{this.orientationVal}}
          @tone={{this.toneVal}}
          @appearance={{this.appearanceVal}}
          @pressedAppearance={{this.pressedVal}}
          @size={{this.sizeVal}}
          @deselectable={{this.deselectable}}
          @wrap={{this.wrap}}
        />
        <p class='pretui-demo-readout' data-test-tg-readout>
          selection = {{this.readout}}
        </p>
        <p class='pretui-demo-note'>
          Icon-only, multi-select — every label survives as the item's
          accessible name and its tooltip:
        </p>
        <ToggleGroup
          @options={{this.formatting}}
          @label='Annotation tools'
          @multiple={{true}}
          @iconOnly={{true}}
          @values={{this.marks}}
          @onValuesChange={{this.setMarks}}
          @size={{this.sizeVal}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @description='The members. Each carries a value, a label, an optional icon-registry name and an optional disabled flag — disabled members stay focusable and announced (aria-disabled), because removing one changes the shape of the group between visits.'
          @value={{this.options}}
        />
        <Args.String
          @name='label'
          @required={{true}}
          @defaultValue='Repeat on'
          @description='The group name, and it is required rather than optional. Both sourced implementations shipped an unnamed pile of buttons; a name that is optional is a name that is usually missing.'
        />
        <Args.Bool
          @name='multiple'
          @defaultValue={{false}}
          @value={{this.multiple}}
          @description='Switches the entire ARIA contract, not just the arithmetic: radiogroup of radios versus toolbar of pressed buttons. React Aria makes the same split, and for the same reason — with one legal answer the arrows can be the choice, and with many they cannot be.'
          @onInput={{this.setMultiple}}
        />
        <Args.Bool
          @name='deselectable'
          @defaultValue={{true}}
          @value={{this.deselectable}}
          @description='Single-select only: re-activating the chosen member clears the group. This is the line between a ToggleGroup and a RadioGroup — left/centre/right/none is a toggle group, one-of-these-must-be-true is a radio group.'
          @onInput={{this.setDeselectable}}
        />
        <Args.String
          @name='orientation'
          @defaultValue='horizontal'
          @value={{this.orientation}}
          @options={{this.orientations}}
          @description='Which arrow axis navigates, and which way the members flow.'
          @onInput={{this.setOrientation}}
        />
        <Args.String
          @name='tone'
          @defaultValue='neutral'
          @value={{this.tone}}
          @options={{this.tones}}
          @description='Semantic hue for every member. Nothing here is hand-authored colour, so a season the component has never seen re-tints it.'
          @onInput={{this.setTone}}
        />
        <Args.String
          @name='appearance'
          @defaultValue='outlined'
          @value={{this.appearance}}
          @options={{this.appearances}}
          @description='The recipe worn at rest.'
          @onInput={{this.setAppearance}}
        />
        <Args.String
          @name='pressedAppearance'
          @defaultValue='accent'
          @value={{this.pressedAppearance}}
          @options={{this.appearances}}
          @description='The recipe worn while pressed. Selection is an appearance swap rather than a tint, which is why it still reads in greyscale — the source conveyed it with colour alone.'
          @onInput={{this.setPressed}}
        />
        <Args.String
          @name='size'
          @defaultValue='m'
          @value={{this.sizeName}}
          @options={{this.sizes}}
          @description='Size scale. Sets host font-size only; every internal dimension is em.'
          @onInput={{this.setSize}}
        />
        <Args.Bool
          @name='wrap'
          @defaultValue={{false}}
          @value={{this.wrap}}
          @description='Let a long horizontal group flow onto more lines rather than overflow its pane.'
          @onInput={{this.setWrap}}
        />
        <Args.Bool
          @name='iconOnly'
          @defaultValue={{false}}
          @description="Draw glyphs only. Each label becomes its member's sr-only name and its title, so an icon-only bar is still fully named."
        />
        <Args.Array
          @name='values'
          @description='Controlled multi-select value. Omit and seed defaultValues for uncontrolled use.'
          @value={{this.days}}
        />
        <Args.String
          @name='value'
          @description='Controlled single value. Pass null for an explicit empty selection; omit and seed defaultValue for uncontrolled use.'
        />
        <Args.Action
          @name='onValuesChange'
          @description='Receives the whole next selection, rebuilt in options order — so the callback never depends on the order the reader happened to click in.'
        />
        <Args.Action
          @name='onValueChange'
          @description='Receives the chosen value, or undefined when the group is cleared.'
        />
        <Args.Yield
          @name='empty'
          @description='Replaces the built-in "No options" line shown when @options is empty.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-togglegroup-gap'
          @type='length'
          @description='Space between members. Grows on coarse pointers.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-readout {
        margin: 10px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .pretui-demo-note {
        margin: 18px 0 8px;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_TOGGLE_GROUP: Record<string, unknown> = {
  ToggleGroup: ToggleGroupUsage,
};
