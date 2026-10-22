// Pretui — SlideOver usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { SlideOver } from './slide-over';

const SOURCE = "<SlideOver @open={{this.open}} @label='Lot 7' @onClose={{this.close}}>…</SlideOver>";

export class SlideOverUsage extends Component {
  @tracked open = false;
  show = () => (this.open = true);
  close = () => (this.open = false);
  <template>
    <FreestyleUsage
      @name='SlideOver'
      @description='Drawer under a name that cannot collide: what shadcn calls Sheet (Pretui Sheet is a spreadsheet). A native dialog against one edge. Import it when a port already says SlideOver or means shadcn Sheet; the component and its writeup are Drawer.'
      @source={{SOURCE}}
    >
      <:example>
        <Button {{on 'click' this.show}}>Open SlideOver</Button>
        <SlideOver @open={{this.open}} @label='Lot 7' @onClose={{this.close}}>
          <:title>Lot 7</:title>
          <:default><p class='ov-demo-p'>Filters for the lot list go here.</p></:default>
          <:footer><Button {{on 'click' this.close}}>Close</Button></:footer>
        </SlideOver>
      </:example>
      <:api as |Args|>
        <Args.Bool @name='open' @description='Controlled open state.' />
        <Args.String @name='label' @value='Lot 7' @description='The accessible name.' />
        <Args.String @name='placement' @defaultValue='end' @description='start, end or bottom; left and right map.' />
        <Args.Bool @name='dismissible' @defaultValue={{true}} @description='Escape and an outside click close it.' />
        <Args.Action @name='onClose' @description='Called when it asks to close.' />
        <Args.Yield @name='title' />
        <Args.Yield @name='default' />
        <Args.Yield @name='footer' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .ov-demo-p {
        margin: 0;
      }
    </style>
  </template>
}

export const DEMOS_SLIDE_OVER: Record<string, unknown> = {
  SlideOver: SlideOverUsage,
};
