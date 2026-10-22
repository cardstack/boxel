// Pretui — Modal usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Modal } from './modal';

const SOURCE = "<Modal @open={{this.open}} @label='Lot 7' @onClose={{this.close}}>…</Modal>";

export class ModalUsage extends Component {
  @tracked open = false;
  show = () => (this.open = true);
  close = () => (this.open = false);
  <template>
    <FreestyleUsage
      @name='Modal'
      @description='Dialog under the Ant / Mantine / MUI name: a native dialog opened with showModal(), with the focus trap, Escape and inert background from the platform. Import it when a port already says Modal; the component and its writeup are Dialog.'
      @source={{SOURCE}}
    >
      <:example>
        <Button {{on 'click' this.show}}>Open Modal</Button>
        <Modal @open={{this.open}} @label='Lot 7' @onClose={{this.close}}>
          <:title>Lot 7</:title>
          <:default><p class='ov-demo-p'>Lot 7 ships Thursday with the spring labels.</p></:default>
          <:footer><Button {{on 'click' this.close}}>Close</Button></:footer>
        </Modal>
      </:example>
      <:api as |Args|>
        <Args.Bool @name='open' @description='Controlled open state.' />
        <Args.String @name='label' @value='Lot 7' @description='The accessible name.' />
        <Args.String @name='size' @defaultValue='m' @description='s, m or l.' />
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

export const DEMOS_MODAL: Record<string, unknown> = {
  Modal: ModalUsage,
};
