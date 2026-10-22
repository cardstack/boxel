// Pretui — Toggle usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Toggle } from './toggle';
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
const ARIA_STATES = ['pressed', 'checked', 'none'];

// ── Toggle ← Radix `Toggle` ──────────────────────────────────────────────
export class ToggleUsage extends Component {
  tones = TONES;
  appearances = APPEARANCES;
  sizes = SIZES;
  ariaStates = ARIA_STATES;

  @tracked pressed = true;
  @tracked tone = 'neutral';
  @tracked appearance = 'outlined';
  @tracked pressedAppearance = 'accent';
  @tracked sizeName = 'm';
  @tracked ariaState = 'pressed';
  @tracked disabled = false;
  @tracked busy = false;
  @tracked iconOnly = false;
  @tracked log = 'nothing yet';

  @tracked bold = false;
  @tracked italic = true;
  @tracked underline = false;

  setPressed = (v: boolean) => {
    this.pressed = v;
    this.log = v ? 'pressed' : 'released';
  };
  setTone = (v: string) => (this.tone = v);
  setAppearance = (v: string) => (this.appearance = v);
  setPressedAppearance = (v: string) => (this.pressedAppearance = v);
  setSize = (v: string) => (this.sizeName = v);
  setAriaState = (v: string) => (this.ariaState = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setBusy = (v: boolean) => (this.busy = v);
  setIconOnly = (v: boolean) => (this.iconOnly = v);
  setBold = (v: boolean) => (this.bold = v);
  setItalic = (v: boolean) => (this.italic = v);
  setUnderline = (v: boolean) => (this.underline = v);

  get toneVal() {
    return this.tone as PretuiTone;
  }
  get appearanceVal() {
    return this.appearance as PretuiAppearance;
  }
  get pressedAppearanceVal() {
    return this.pressedAppearance as PretuiAppearance;
  }
  get sizeVal() {
    return this.sizeName as PretuiSize;
  }
  get ariaStateVal() {
    return this.ariaState as 'pressed' | 'checked' | 'none';
  }
  get usage() {
    return [
      '<Toggle',
      '@pressed={{this.pressed}}',
      '@onPressedChange={{this.setPressed}}',
      "@label='Pin'",
      '>Pin</Toggle>',
    ].join(' ');
  }

  <template>
    <FreestyleUsage
      @name='Toggle'
      @description='One button whose meaning is a STATE, not an action. It is not a Switch (a setting that takes effect the moment it moves) and not a Button (which does a thing and returns to rest), so the state is the noun: pressed, defaultPressed, onPressedChange. Ported from Radix Toggle, with three fixes — disabled is aria-disabled so it stays focusable inside a roving-tabindex toolbar, the pressed state is an appearance recipe swap rather than a tint so it survives greyscale, and busy is a pending state that keeps focus rather than a disable.'
      @source={{this.usage}}
    >
      <:example>
        <Toggle
          @pressed={{this.pressed}}
          @onPressedChange={{this.setPressed}}
          @tone={{this.toneVal}}
          @appearance={{this.appearanceVal}}
          @pressedAppearance={{this.pressedAppearanceVal}}
          @size={{this.sizeVal}}
          @ariaState={{this.ariaStateVal}}
          @disabled={{this.disabled}}
          @busy={{this.busy}}
          @iconOnly={{this.iconOnly}}
          @label='Pin this row'
        >Pin</Toggle>
        <p class='pretui-demo-readout' data-test-toggle-readout>
          last change = {{this.log}}
        </p>
        <p class='pretui-demo-note'>
          Three independent toggles, uncontrolled. This is what a formatting bar
          looks like before a ToggleGroup is warranted — no group, no arrows,
          just three pressed states:
        </p>
        <span class='entry-demo-bar'>
          <Toggle
            @pressed={{this.bold}}
            @onPressedChange={{this.setBold}}
            @size={{this.sizeVal}}
          >B</Toggle>
          <Toggle
            @pressed={{this.italic}}
            @onPressedChange={{this.setItalic}}
            @size={{this.sizeVal}}
          >I</Toggle>
          <Toggle
            @pressed={{this.underline}}
            @onPressedChange={{this.setUnderline}}
            @size={{this.sizeVal}}
          >U</Toggle>
        </span>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='pressed'
          @defaultValue={{false}}
          @value={{this.pressed}}
          @description='Controlled pressed state. Omit and seed defaultPressed for uncontrolled use. Deliberately not named checked or isSelected — a Toggle is not a Checkbox and React Aria collapsing the three into one isSelected is the one convention this kit does not copy.'
          @onInput={{this.setPressed}}
        />
        <Args.Bool
          @name='defaultPressed'
          @defaultValue={{false}}
          @description='Uncontrolled seed, ignored once pressed is supplied.'
        />
        <Args.Action
          @name='onPressedChange'
          @description='Receives the NEXT state on every activation. onChange is accepted as an alias and both fire if both are supplied, so an alias layer can never silently swallow one.'
        />
        <Args.String
          @name='ariaState'
          @defaultValue='pressed'
          @value={{this.ariaState}}
          @options={{this.ariaStates}}
          @description='Which ARIA attribute carries the state. pressed is a standalone toggle or a toolbar member; checked is what a single-select ToggleGroup member needs beside its radio role; none hands the ARIA to a parent. This is the arg that lets ToggleGroup compose Toggle instead of hand-rolling a third pressed-state implementation.'
          @onInput={{this.setAriaState}}
        />
        <Args.String
          @name='tone'
          @defaultValue='neutral'
          @value={{this.tone}}
          @options={{this.tones}}
          @description='Semantic hue. Accepts destructive, brand, positive, notice and caution as aliases.'
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
          @description='The recipe worn while pressed. Selection is a recipe swap rather than a tint, which is why it still reads in greyscale — Radix has no visual opinion here and almost every consumer reaches for colour alone.'
          @onInput={{this.setPressedAppearance}}
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
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @description='Dims and inerts, but stays focusable and announced through aria-disabled. Radix passes disabled to the button element, which removes it from the tab order — fine for one button, wrong inside a toolbar whose shape then changes between visits. isDisabled is accepted as an alias.'
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='busy'
          @defaultValue={{false}}
          @value={{this.busy}}
          @description='Pending, in React Aria terms: aria-busy, a spinner, clicks ignored, and focus retained. loading and isPending are accepted as aliases.'
          @onInput={{this.setBusy}}
        />
        <Args.Bool
          @name='iconOnly'
          @defaultValue={{false}}
          @value={{this.iconOnly}}
          @description='Draw the glyph only. The label becomes the accessible name and the tooltip, so an icon-only toggle is still fully named.'
          @onInput={{this.setIconOnly}}
        />
        <Args.String
          @name='label'
          @description='Accessible name. Required in iconOnly mode, where there is no text for a reader to fall back on.'
        />
        <Args.Yield
          @name='default'
          @description='Yields the resolved state as a hash, so a caller can swap the glyph in place rather than render two and hide one.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .entry-demo-bar {
        display: inline-flex;
        gap: 4px;
        margin-top: 8px;
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


export const DEMOS_TOGGLE: Record<string, unknown> = {
  Toggle: ToggleUsage,
};
