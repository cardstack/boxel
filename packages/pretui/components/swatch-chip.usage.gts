// Pretui — SwatchChip usage page.
import Component from '@glimmer/component';
import { FreestyleUsage } from './freestyle-usage';
import { Token } from './token';
import { SwatchChip } from './swatch-chip';
import { DemoRow } from '../demo-foundations-more';

class SwatchChipUsage extends Component {
  colors = ['oklch(62% 0.16 155)', 'rgb(76 110 245 / 65%)', '#d97706', 'not-a-color'];
  <template>
    <FreestyleUsage @name='SwatchChip' @description='A presentational colour sample safe to place inside another control. Alpha rides over a checker and invalid colour text becomes an honest empty chip.' @source='<SwatchChip @color="oklch(62% 0.16 155)" />'>
      <:example><DemoRow>{{#each this.colors as |color|}}<span class='swatch-sample'><SwatchChip @color={{color}} @size={{26}} /><Token @value={{color}} /></span>{{/each}}</DemoRow></:example>
      <:api as |Args|><Args.Object @name='sample colors' @value={{this.colors}} /><Args.String @name='color' @value='oklch(62% 0.16 155)' /><Args.String @name='shape' @value='round' /><Args.Number @name='size' @value={{26}} /></:api>
    </FreestyleUsage>
    <style scoped>.swatch-sample { display: inline-flex; align-items: center; gap: 6px; }</style>
  </template>
}

export const DEMOS_SWATCH_CHIP: Record<string, unknown> = {
  SwatchChip: SwatchChipUsage,
};
