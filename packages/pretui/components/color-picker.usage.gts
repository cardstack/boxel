// Pretui — ColorPicker usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { GamutId, SpaceId } from '../color-engine';
import { ColorPicker } from './color-picker';
import type { ColorFormat } from './color-picker';
import { FreestyleUsage } from './freestyle-usage';
import { GAMUT_NAMES } from '../internal/color-fixtures';

const SPACE_NAMES = ['srgb', 'hsl', 'hsv', 'oklch', 'oklab', 'p3', 'rec2020'];
const FORMAT_NAMES = ['auto', 'hex', 'css'];

// ── ColorPicker ──────────────────────────────────────────────────────────
class ColorPickerUsage extends Component {
  @tracked value = 'oklch(0.72 0.31 25)';
  @tracked space = 'oklch';
  @tracked gamut = 'srgb';
  @tracked format = 'auto';
  @tracked noAlpha = false;
  @tracked lockSpace = false;
  spaces = SPACE_NAMES;
  gamuts = GAMUT_NAMES;
  formats = FORMAT_NAMES;
  setValue = (v: string) => (this.value = v);
  setSpace = (v: string) => (this.space = v);
  setGamut = (v: string) => (this.gamut = v);
  setFormat = (v: string) => (this.format = v);
  setNoAlpha = (v: boolean) => (this.noAlpha = v);
  setLockSpace = (v: boolean) => (this.lockSpace = v);
  get spaceId(): SpaceId {
    return this.space as SpaceId;
  }
  get gamutId(): GamutId {
    return this.gamut as GamutId;
  }
  get formatValue(): ColorFormat {
    return this.format as ColorFormat;
  }
  get usage() {
    return '<ColorPicker @value={{this.value}} @space="oklch" @gamut="srgb" @onValueChange={{this.setValue}} />';
  }
  <template>
    <FreestyleUsage
      @name='ColorPicker'
      @description="The full picker: area, hue and opacity sliders, per-channel numbers, hex/CSS entry, eyedropper where the browser has one, copy, and space + gamut switching across sRGB / HSL / HSV / OKLCH / OKLab / Display P3 / Rec. 2020. The starting value is deliberately outside sRGB so the gamut report is visible on load — most pickers would clamp it silently and never mention it."
      @source={{this.usage}}
    >
      <:example>
        <ColorPicker
          @value={{this.value}}
          @space={{this.spaceId}}
          @gamut={{this.gamutId}}
          @format={{this.formatValue}}
          @noAlpha={{this.noAlpha}}
          @lockSpace={{this.lockSpace}}
          @onValueChange={{this.setValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @description='Any CSS colour string. Unparseable input is refused on commit rather than silently discarded.'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='space'
          @defaultValue='oklch'
          @options={{this.spaces}}
          @description='The channel model. Switching it re-expresses the SAME colour — it never changes what is selected, only the coordinates.'
          @value={{this.space}}
          @onInput={{this.setSpace}}
        />
        <Args.String
          @name='gamut'
          @defaultValue='srgb'
          @options={{this.gamuts}}
          @description='What "showable" means. Distinct from the space: OKLCH is a space, sRGB is also a gamut, and conflating them is why most pickers cannot tell you a colour is unshowable.'
          @value={{this.gamut}}
          @onInput={{this.setGamut}}
        />
        <Args.String
          @name='format'
          @defaultValue='auto'
          @options={{this.formats}}
          @description='Emitted shape. auto gives hex for the sRGB-bounded models and the space CSS function otherwise.'
          @value={{this.format}}
          @onInput={{this.setFormat}}
        />
        <Args.Bool
          @name='noAlpha'
          @defaultValue={{false}}
          @description='Hide the opacity slider and drop alpha from the emitted value.'
          @value={{this.noAlpha}}
          @onInput={{this.setNoAlpha}}
        />
        <Args.Bool
          @name='lockSpace'
          @defaultValue={{false}}
          @description='Hide the space switcher. The gamut READOUT always stays — clamping is never silent.'
          @value={{this.lockSpace}}
          @onInput={{this.setLockSpace}}
        />
        <Args.Action
          @name='onValueChange'
          @description='Receives the formatted colour string.'
        />
      </:api>
      <:description>
        <p>Every colour string is parsed and re-serialized before it reaches an
          inline style, so a
          <code>@value</code>
          carrying extra declarations becomes
          <code>transparent</code>, not an injection.</p>
      </:description>
    </FreestyleUsage>
  </template>
}

export const DEMOS_COLOR_PICKER: Record<string, unknown> = {
  ColorPicker: ColorPickerUsage,
};
