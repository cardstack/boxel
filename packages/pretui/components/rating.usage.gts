// Pretui — Rating usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { Rating } from './rating';
import { Token } from './token';

const PRECISIONS = ['1', '0.5'];

export class RatingUsage extends GlimmerComponent {
  @tracked value = 3.5;
  @tracked precision = '0.5';
  @tracked max = 5;
  @tracked readonly = false;
  @tracked disabled = false;
  onChange = (v: number) => (this.value = v);
  setPrecision = (v: string) => (this.precision = v);
  setMax = (v: number | null) => (this.max = v ?? 5);
  setReadonly = (v: boolean) => (this.readonly = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get precisionVal() {
    return Number(this.precision);
  }
  get valueText() {
    return String(this.value);
  }
  get usage() {
    return `<Rating @value={{${this.value}}} @precision={{${this.precision}}} @max={{${this.max}}} @onValueChange={{this.onChange}} />`;
  }
  <template>
    <FreestyleUsage
      @name='Rating'
      @description='Score as a row of selectable symbols. Ported from Web Awesome (MIT): half-symbol precision via clip-path, hover preview, click-to-clear, slider keyboard model (arrows step by precision, Shift for whole steps, Home/End). The specimen is its own knob.'
      @source={{this.usage}}
    >
      <:example>
        <Rating
          @value={{this.value}}
          @precision={{this.precisionVal}}
          @max={{this.max}}
          @readonly={{this.readonly}}
          @disabled={{this.disabled}}
          @label='Demo rating'
          @onValueChange={{this.onChange}}
        />
        <Token @value={{this.valueText}} />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='precision'
          @value={{this.precision}}
          @options={{PRECISIONS}}
          @defaultValue='1'
          @description='The increment the rating moves by — 0.5 allows half-star ratings (rendered via clip-path).'
          @onInput={{this.setPrecision}}
        />
        <Args.Number
          @name='max'
          @value={{this.max}}
          @min={{3}}
          @max={{10}}
          @defaultValue={{5}}
          @description='The highest rating to show.'
          @onInput={{this.setMax}}
        />
        <Args.Bool
          @name='readonly'
          @value={{this.readonly}}
          @defaultValue={{false}}
          @description='Displays the value without accepting interaction.'
          @onInput={{this.setReadonly}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @defaultValue={{false}}
          @description='Disables the rating.'
          @onInput={{this.setDisabled}}
        />
        <Args.Action
          @name='onValueChange'
          @description='Called with the committed value; clicking the current value clears to 0 (the Web Awesome toggle semantic).'
        />
        <Args.Action
          @name='onHover'
          @description="Called with ('start'|'move'|'end', value) as the pointer previews a value."
        />
      </:api>
    </FreestyleUsage>
  </template>
}


export const DEMOS_RATING: Record<string, unknown> = {
  Rating: RatingUsage,
};
