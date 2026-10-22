// Pretui — Swatch usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Swatch } from './swatch';

// ── Swatch ───────────────────────────────────────────────────────────────
class SwatchUsage extends Component {
  @tracked color = '#AC00FF';
  @tracked labelText = 'Amethyst';
  @tracked shape = 'round';
  get shapeValue(): 'round' | 'square' {
    return this.shape === 'square' ? 'square' : 'round';
  }
  @tracked selected = false;
  shapes = ['round', 'square'];
  setColor = (v: string) => (this.color = v);
  setLabel = (v: string) => (this.labelText = v);
  setShape = (v: string) => (this.shape = v);
  setSelected = (v: boolean) => (this.selected = v);
  toggleSelected = () => (this.selected = !this.selected);
  get usage() {
    return "<Swatch @color='#AC00FF' @label='Amethyst' @onSelect={{this.pick}} />";
  }
  <template>
    <FreestyleUsage
      @name='Swatch'
      @description="A colour chip. @color is PARSED and re-serialized before it reaches the style attribute, so a value of `red; background: url(…)` renders as the empty state rather than injecting declarations — try it in the knob. Its accessible name carries the hex and a colour word, so the chip is legible without relying on colour. Alpha shows against a checkerboard."
      @source={{this.usage}}
    >
      <:example>
        <Swatch
          @color={{this.color}}
          @label={{this.labelText}}
          @shape={{this.shapeValue}}
          @selected={{this.selected}}
          @onSelect={{this.toggleSelected}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='color'
          @required={{true}}
          @description='Any CSS colour. Unparseable input renders the empty (slashed) chip — it is never interpolated raw.'
          @value={{this.color}}
          @onInput={{this.setColor}}
        />
        <Args.String
          @name='label'
          @description='Visible label beside the chip. Also becomes the accessible name when given.'
          @value={{this.labelText}}
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='shape'
          @defaultValue='round'
          @options={{this.shapes}}
          @description='round (default) or square, which reads better in a dense grid.'
          @value={{this.shape}}
          @onInput={{this.setShape}}
        />
        <Args.Bool
          @name='selected'
          @defaultValue={{false}}
          @description='Draws the selection ring.'
          @value={{this.selected}}
          @onInput={{this.setSelected}}
        />
        <Args.Action
          @name='onSelect'
          @description='Receives the swatch colour. Omitting it leaves a static chip.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_SWATCH: Record<string, unknown> = {
  Swatch: SwatchUsage,
};
