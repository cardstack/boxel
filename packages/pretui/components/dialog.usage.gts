// Pretui — Dialog usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from '../freestyle';
import { Button } from './button';
import { Dialog } from './dialog';

const DIALOG_SIZES = ['s', 'm', 'l'];

class DialogUsage extends GlimmerComponent {
  @tracked open = false;
  @tracked size = 's';
  @tracked dismissible = true;
  show = () => (this.open = true);
  hide = () => (this.open = false);
  setSize = (v: string) => (this.size = v);
  setDismissible = (v: boolean) => (this.dismissible = v);
  get sizeVal() {
    return this.size as 's' | 'm' | 'l';
  }
  <template>
    <FreestyleUsage
      @name='Dialog'
      @description='Modal dialog on the native top layer (showModal). Focus trap, Escape (as a cancelable controlled close), ::backdrop, and stacking come from the platform — no JS dismissible-stack. Supersedes boxel-ui Modal, which owns the viewport and ships no focus trap.'
    >
      <:example>
        <Button @tone='neutral' @appearance='outlined' {{on 'click' this.show}}>
          Open the dialog
        </Button>
        <Dialog
          @open={{this.open}}
          @onClose={{this.hide}}
          @label='Demo'
          @size={{this.sizeVal}}
          @dismissible={{this.dismissible}}
        >
          <:title>Native top layer</:title>
          <:default>Focus trap, Escape, backdrop click, and stacking come from
            the platform dialog. Entry motion is pure CSS via
            @starting-style.</:default>
          <:footer>
            <Button @tone='primary' {{on 'click' this.hide}}>Done</Button>
          </:footer>
        </Dialog>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='size'
          @value={{this.size}}
          @options={{DIALOG_SIZES}}
          @defaultValue='m'
          @description='Dialog width: s 400px, m 560px, l 760px (all clamped to the viewport).'
          @onInput={{this.setSize}}
        />
        <Args.Bool
          @name='dismissible'
          @value={{this.dismissible}}
          @defaultValue={{true}}
          @description='Whether Escape and backdrop click close the dialog.'
          @onInput={{this.setDismissible}}
        />
        <Args.Bool
          @name='open'
          @value={{this.open}}
          @description='Controlled open state — the component never closes itself out from under it.'
          @onInput={{this.setDismissible}}
          @hideControls={{true}}
        />
        <Args.Action
          @name='onClose'
          @required={{true}}
          @description='Called when the user dismisses (Escape, backdrop, or your own buttons).'
        />
        <Args.Yield
          @name='title / default / footer'
          @description='Named blocks: heading, body, and the right-aligned action row above a hairline.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_DIALOG: Record<string, unknown> = {
  Dialog: DialogUsage,
};
