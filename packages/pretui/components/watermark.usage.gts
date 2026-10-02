// Pretui — Watermark usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Watermark } from './watermark';
import { Chip } from './chip';

export class WatermarkUsage extends Component {
  @tracked text = 'DRAFT';
  @tracked gap = 140;
  @tracked rotate = -22;
  @tracked opacity = 0.08;
  setText = (v: string) => (this.text = v);
  setGap = (v: number | null) => (this.gap = v ?? 140);
  setRotate = (v: number | null) => (this.rotate = v ?? -22);
  setOpacity = (v: number | null) => (this.opacity = v ?? 0.08);
  get usage() {
    return `<Watermark @text='${this.text}' @gap={{${this.gap}}} @rotate={{${this.rotate}}} @opacity={{${this.opacity}}}>\n  …the document…\n</Watermark>`;
  }
  <template>
    <FreestyleUsage
      @name='Watermark'
      @description='A repeated faint mark over a region: DRAFT, a name, a date. It is texture, never information (Law 6): the layer is aria-hidden and ignores the pointer, so when the state matters say it in words too, as the Chip here does.'
      @source={{this.usage}}
    >
      <:example>
        <Watermark @text={{this.text}} @gap={{this.gap}} @rotate={{this.rotate}} @opacity={{this.opacity}} class='wm-demo'>
          <div class='wm-demo-doc'>
            <Chip @label='Draft' />
            <p>Invoice 1042 · Northwind Roasters</p>
            <p>12 kg Huila, washed · lot 7</p>
            <p>Due on receipt</p>
          </div>
        </Watermark>
      </:example>
      <:api as |Args|>
        <Args.String @name='text' @value={{this.text}} @onInput={{this.setText}} />
        <Args.String @name='image' @description='An image to tile instead of text.' />
        <Args.Number @name='gap' @value={{this.gap}} @defaultValue={{140}} @min={{40}} @max={{600}} @onInput={{this.setGap}} />
        <Args.Number @name='rotate' @value={{this.rotate}} @defaultValue={{-22}} @min={{-90}} @max={{90}} @onInput={{this.setRotate}} />
        <Args.Number @name='opacity' @value={{this.opacity}} @defaultValue={{0.08}} @min={{0}} @max={{0.4}} @step={{0.01}} @onInput={{this.setOpacity}} />
        <Args.Number @name='fontSize' @defaultValue={{14}} />
        <Args.Yield @name='default' @description='The region under the mark.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .wm-demo {
        border-radius: var(--radius-surface, 10px);
        box-shadow: 0 0 0 1px var(--border);
        background: var(--card);
      }
      .wm-demo-doc {
        padding: var(--space-6, 1.25rem);
        min-block-size: 12rem;
        font-size: var(--text-ui-md, 0.78rem);
      }
    </style>
  </template>
}

export const DEMOS_WATERMARK: Record<string, unknown> = {
  Watermark: WatermarkUsage,
};
