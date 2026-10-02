// Pretui — ChannelSlider usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { parseColor } from '../color-engine';
import type { ColorValue } from '../color-engine';
import { ChannelSlider } from './channel-slider';
import type { ChannelTrack } from './channel-slider';
import { FreestyleUsage } from './freestyle-usage';

// ── ChannelSlider ────────────────────────────────────────────────────────
class ChannelSliderUsage extends Component {
  @tracked color: ColorValue = parseColor('oklch(0.7 0.16 210)')!;
  @tracked hue = 210;
  setHue = (v: number) => {
    this.hue = v;
    this.color = { ...this.color, coords: [0.7, 0.16, v] };
  };
  get track(): ChannelTrack {
    // A typed spec, not a CSS string — the engine builds the gradient, so
    // there is no caller text on this path at all.
    return { kind: 'channel', color: this.color, index: 2, gamut: 'srgb', steps: 32 };
  }
  get valueText() {
    return `Hue ${Math.round(this.hue)} degrees`;
  }
  get trackKind() {
    return this.track.kind;
  }
  get usage() {
    return "<ChannelSlider @label='Hue' @valueText={{this.text}} @value={{this.hue}} @min={{0}} @max={{360}} @step={{1}} @wrap={{true}} @track={{this.track}} @onInput={{this.setHue}} />";
  }
  <template>
    <FreestyleUsage
      @name='ChannelSlider'
      @description="One channel on a track built from real conversions of the current colour. It is a native <input type='range'>, so Home/End, PageUp/PageDown, touch and RTL arrive from the platform; Shift (×10), Alt (÷10) and hue WRAPPING are layered on. Focus it and hold Shift while arrowing."
      @source={{this.usage}}
    >
      <:example>
        <ChannelSlider
          @label='Hue'
          @valueText={{this.valueText}}
          @value={{this.hue}}
          @min={{0}}
          @max={{360}}
          @step={{1}}
          @wrap={{true}}
          @track={{this.track}}
          @onInput={{this.setHue}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @required={{true}}
          @description='Accessible name for the slider.'
          @value='Hue'
        />
        <Args.String
          @name='valueText'
          @required={{true}}
          @description="Spoken value — a sentence ('Lightness 62%'), never a bare number."
          @value={{this.valueText}}
        />
        <Args.Number
          @name='value'
          @required={{true}}
          @value={{this.hue}}
          @description='Current value in display units.'
          @onInput={{this.setHue}}
        />
        <Args.Bool
          @name='wrap'
          @defaultValue={{false}}
          @description='Hue channels wrap at the ends instead of dead-ending at 0/360.'
          @value={{true}}
        />
        <Args.Bool
          @name='checker'
          @defaultValue={{false}}
          @description='Show the alpha checkerboard behind the track.'
          @value={{false}}
        />
        <Args.String
          @name='track'
          @required={{true}}
          @description="A TYPED spec — { kind: 'channel' | 'alpha' | 'custom' }. The two real paths carry no caller text at all; only 'custom' does, and it goes through the shared allowlist."
          @value={{this.trackKind}}
        />
        <Args.Action
          @name='onInput'
          @description='Receives the new value on every change.'
        />
        <Args.Action
          @name='onCommit'
          @description='Fires once when a gesture ends. Announcements belong here, not on onInput — a live region that fires per drag frame is unusable.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_CHANNEL_SLIDER: Record<string, unknown> = {
  ChannelSlider: ChannelSliderUsage,
};
