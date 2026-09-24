// Pretui — Button usage page. The freestyle contract for the catalog tile:
// live example, knobs for every arg, and the API table the kit teaches from.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { Button } from './button';
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

// Spread the published vocabulary rather than restating it: Freestyle's
// @options takes a mutable string[], and a hand-written copy silently omits
// any axis value added later.
const TONES = [...PRETUI_TONES];
const APPEARANCES = [...PRETUI_APPEARANCES];
const SIZES = [...PRETUI_SIZES];

export class ButtonUsage extends GlimmerComponent {
  @tracked tone = 'primary';
  @tracked appearance = 'accent';
  @tracked size = 'm';
  @tracked busy = false;
  @tracked disabled = false;
  setTone = (v: string) => (this.tone = v);
  setAppearance = (v: string) => (this.appearance = v);
  setSize = (v: string) => (this.size = v);
  setBusy = (v: boolean) => (this.busy = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get toneVal() {
    return this.tone as PretuiTone;
  }
  get appearanceVal() {
    return this.appearance as PretuiAppearance;
  }
  get sizeVal() {
    return this.size as PretuiSize;
  }
  get usage() {
    let bits = [`@tone='${this.tone}'`, `@appearance='${this.appearance}'`];
    if (this.size !== 'm') bits.push(`@size='${this.size}'`);
    if (this.busy) bits.push('@busy={{true}}');
    if (this.disabled) bits.push('@disabled={{true}}');
    return `<Button ${bits.join(' ')}>Keep selling</Button>`;
  }
  <template>
    <FreestyleUsage
      @name='Button'
      @description='Interactive button for actions and form submission. The boxel-ui @kind axis is re-cut as the two-axis treatment grid: @tone picks the hue, @appearance picks the recipe. Renders as a native button; the boxel-ui anchor/LinkTo polymorphism is host-router coupling and stays behind.'
      @source={{this.usage}}
    >
      <:example>
        <Button
          @tone={{this.toneVal}}
          @appearance={{this.appearanceVal}}
          @size={{this.sizeVal}}
          @busy={{this.busy}}
          @disabled={{this.disabled}}
        >Keep selling</Button>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='tone'
          @value={{this.tone}}
          @options={{TONES}}
          @defaultValue='primary'
          @description='Semantic color — WHY the element is colored. Sets --pretui-tone/--pretui-tone-on from theme tokens.'
          @onInput={{this.setTone}}
        />
        <Args.String
          @name='appearance'
          @value={{this.appearance}}
          @options={{APPEARANCES}}
          @defaultValue='accent'
          @description='Visual weight — HOW loud. One recipe per appearance, written once, reading the tone variables.'
          @onInput={{this.setAppearance}}
        />
        <Args.String
          @name='size'
          @value={{this.size}}
          @options={{SIZES}}
          @defaultValue='m'
          @description='Sets only the host font-size; every internal dimension rides the em (webawesome scaling). m is 28px-high.'
          @onInput={{this.setSize}}
        />
        <Args.Bool
          @name='busy'
          @value={{this.busy}}
          @defaultValue={{false}}
          @description='Shows the spinner, dims the label, and blocks pointer events while a triggered action runs.'
          @onInput={{this.setBusy}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @defaultValue={{false}}
          @description='Disables the button.'
          @onInput={{this.setDisabled}}
        />
        <Args.Base
          @name='variant'
          @typeLabel='String'
          @description='Deprecated sugar over @tone + @appearance: primary→primary/accent, secondary→neutral/outlined, ghost→neutral/plain, destructive→danger/accent.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_BUTTON: Record<string, unknown> = {
  Button: ButtonUsage,
};
