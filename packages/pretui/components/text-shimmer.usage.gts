// Pretui — TextShimmer usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { TextShimmer } from './text-shimmer';

// ── TextShimmer — fresh page (no upstream knob rig) ──────────────────────
class TextShimmerUsage extends Component {
  @tracked text = 'Cupping panel in session — scoring Junshan Yinzhen…';
  @tracked duration = 2;
  @tracked spread = 2;
  setText = (v: string) => (this.text = v);
  setDuration = (v: number | null) => (this.duration = v ?? 2);
  setSpread = (v: number | null) => (this.spread = v ?? 2);
  get usage() {
    let bits = [`@text='${this.text}'`];
    if (this.duration !== 2) bits.push(`@duration={{${this.duration}}}`);
    if (this.spread !== 2) bits.push(`@spread={{${this.spread}}}`);
    return `<TextShimmer ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='TextShimmer'
      @description='Gradient sheen sweeping across text — background-clip: text over an animated two-layer gradient, pure CSS on a linear infinite loop. The waiting-state voice for pending lots and in-flight work; base and sheen colors ride the token channel (muted-foreground → foreground).'
      @source={{this.usage}}
    >
      <:example>
        <TextShimmer
          @text={{this.text}}
          @duration={{this.duration}}
          @spread={{this.spread}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='text'
          @required={{true}}
          @value={{this.text}}
          @description='The text the sheen sweeps across — real DOM text, readable by assistive tech.'
          @onInput={{this.setText}}
        />
        <Args.Number
          @name='duration'
          @defaultValue={{2}}
          @value={{this.duration}}
          @min={{0.5}}
          @max={{8}}
          @step={{0.5}}
          @description='Seconds per sweep, right to left, looping.'
          @onInput={{this.setDuration}}
        />
        <Args.Number
          @name='spread'
          @defaultValue={{2}}
          @value={{this.spread}}
          @min={{0.5}}
          @max={{8}}
          @step={{0.5}}
          @description='Sheen half-width in px per character — longer strings get a proportionally wider highlight.'
          @onInput={{this.setSpread}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_TEXT_SHIMMER: Record<string, unknown> = {
  TextShimmer: TextShimmerUsage,
};
