// Pretui — Drawer usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Drawer } from './drawer';
import { Button } from './button';
import { DRAWER_PLACEMENT_OPTIONS } from '../demo-structure';

// Dropped knobs: layer (stacking comes from the native <dialog> top layer).
// size and the boxel-modal-offset-* CSS variables fold into the
// --pretui-drawer-size row below.
class DrawerUsage extends GlimmerComponent {
  @tracked open = false;
  @tracked placement = 'end';
  @tracked dismissible = true;
  show = () => (this.open = true);
  hide = () => (this.open = false);
  setPlacement = (v: string) => (this.placement = v);
  toggleOpen = (v: boolean) => (this.open = v);
  toggleDismissible = (v: boolean) => (this.dismissible = v);
  get placementVal() {
    return this.placement as 'end' | 'start' | 'bottom';
  }
  <template>
    <FreestyleUsage
      @name='Drawer'
      @description='A modal drawer that slides in over a dark, translucent overlay that obscures the page underneath — riding the native dialog top layer, so focus trap, Escape, backdrop, and stacking come from the platform.'
    >
      <:example>
        <Button @tone='primary' {{on 'click' this.show}}>Open</Button>
        <Drawer
          @open={{this.open}}
          @onClose={{this.hide}}
          @label='Demo drawer'
          @placement={{this.placementVal}}
          @dismissible={{this.dismissible}}
        >
          <:title>Pretui Drawer</:title>
          <:default>Hi! This is some content. The drawer rides the native
            dialog top layer — focus trap, Escape, and backdrop come from the
            platform.</:default>
          <:footer>
            <Button @tone='primary' {{on 'click' this.hide}}>OK</Button>
          </:footer>
        </Drawer>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='placement'
          @description='Edge the drawer slides in from.'
          @value={{this.placement}}
          @options={{DRAWER_PLACEMENT_OPTIONS}}
          @defaultValue='end'
          @onInput={{this.setPlacement}}
        />
        <Args.Bool
          @name='open'
          @description='Condition for opening the drawer.'
          @value={{this.open}}
          @defaultValue={{false}}
          @required={{true}}
          @onInput={{this.toggleOpen}}
        />
        <Args.Action
          @name='onClose'
          @description="Callback when the drawer's backdrop is clicked or the escape key is pressed."
          @required={{true}}
          @hideControls={{true}}
        />
        <Args.Bool
          @name='dismissible'
          @description='When true, backdrop click and Escape close the drawer — the inverse of isOverlayDismissalDisabled.'
          @value={{this.dismissible}}
          @defaultValue={{true}}
          @onInput={{this.toggleDismissible}}
        />
        <Args.String
          @name='label'
          @description='Accessible label for the drawer dialog.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='title'
          @description='Heading block at the top of the drawer.'
          @hideControls={{true}}
        />
        <Args.Yield
          @description='The content of the drawer. Unlike the renderless modal, the drawer renders its own surface on the native dialog top layer.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='footer'
          @description='Action row pinned to the bottom of the drawer.'
          @hideControls={{true}}
        />
        <Args.Base
          @typeLabel='CSS'
          @name='--pretui-drawer-size'
          @description='Width of side drawers / max-height of the bottom drawer. Replaces the size arg and the boxel-modal-offset-* variables.'
          @defaultValue='360px (side) / 420px (bottom)'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_DRAWER: Record<string, unknown> = {
  Drawer: DrawerUsage,
};
