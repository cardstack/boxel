// Pretui — ColorArea usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { parseColor } from '../color-engine';
import type { ColorValue, GamutId } from '../color-engine';
import { ColorArea } from './color-area';
import { FreestyleUsage } from './freestyle-usage';
import { GAMUT_NAMES } from '../internal/color-fixtures';

// ── ColorArea ────────────────────────────────────────────────────────────
class ColorAreaUsage extends Component {
  @tracked color: ColorValue = parseColor('oklch(0.66 0.19 25)')!;
  @tracked gamut = 'srgb';
  gamuts = GAMUT_NAMES;
  setColor = (next: ColorValue) => (this.color = next);
  setGamut = (v: string) => (this.gamut = v);
  get gamutId(): GamutId {
    return this.gamut as GamutId;
  }
  get usage() {
    return '<ColorArea @color={{this.color}} @gamut="srgb" @onChange={{this.setColor}} />';
  }
  <template>
    <FreestyleUsage
      @name='ColorArea'
      @description="The 2D plane — chroma × lightness here, because the colour is OKLCH. Regions OUTSIDE the selected gamut are painted faded, so the gamut boundary is something you can see and aim at rather than a flat band that lies about what is selectable. Switch the gamut knob to P3 and watch the reachable area grow."
      @source={{this.usage}}
    >
      <:example>
        <ColorArea
          @color={{this.color}}
          @gamut={{this.gamutId}}
          @onChange={{this.setColor}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='gamut'
          @defaultValue='srgb'
          @options={{this.gamuts}}
          @description='Which gamut counts as reachable. Unreachable pixels are drawn faded.'
          @value={{this.gamut}}
          @onInput={{this.setGamut}}
        />
        <Args.Number
          @name='resolution'
          @defaultValue={{96}}
          @description='Paint resolution. 96² is ~10ms; 128² is ~36ms and crisper on a large picker. Painted synchronously inside a modifier — no worker, so no lifetime to leak.'
          @value={{96}}
        />
        <Args.Action
          @name='onChange'
          @description='Receives a ColorValue on every pointer move and arrow press.'
        />
      </:api>
      <:description>
        <p>Two real
          <code>&lt;input type="range"&gt;</code>
          elements sit invisibly over the plane, one per axis, each with its own
          label and spoken value — a single
          <code>aria-valuenow</code>
          cannot express two axes. Either tab stop drives both axes, so a
          keyboard user never has to know which invisible input they are on.
          Home/End move along the focused axis.</p>
      </:description>
    </FreestyleUsage>
  </template>
}

export const DEMOS_COLOR_AREA: Record<string, unknown> = {
  ColorArea: ColorAreaUsage,
};
