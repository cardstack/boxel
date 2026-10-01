// Pretui — Sonner usage page.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Sonner } from './sonner';
import { ToastStore } from './toaster';

class SonnerUsage extends Component {
  toasts = new ToastStore();

  show = () =>
    this.toasts.show({
      title: 'Lot 4417 published',
      message: 'Visible to the desk in a moment.',
      tone: 'success',
    });

  <template>
    <FreestyleUsage
      @name='Sonner'
      @description='Toaster under the shadcn name: the positioned region that stacks, ages and dismisses toasts pushed into a ToastStore. Import it when a port already says Sonner; the component and its writeup are Toaster.'
      @source='<Sonner @store={{this.toasts}} @placement="bottom-end" />'
    >
      <:example>
        <Button @tone='primary' @appearance='accent' {{on 'click' this.show}}>
          Show a toast
        </Button>
        <Sonner @store={{this.toasts}} @placement='bottom-end' @limit={{3}} />
      </:example>
      <:api as |Args|>
        <Args.Base @name='store' @description='A ToastStore: show({title, message, tone, duration}) returns an id; dismiss(id) and clear() do what they say.' @hideControls={{true}} />
        <Args.String @name='placement' @defaultValue='bottom-end' @description='Where the stack sits. The Sonner position spellings (bottom-right, top-left, …) are accepted through position.' />
        <Args.Number @name='limit' @defaultValue={{4}} @description='How many render at once; the rest queue with their clock unstarted.' />
        <Args.Number @name='duration' @defaultValue={{5}} @description='Default seconds per toast. Seconds, not milliseconds.' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_SONNER: Record<string, unknown> = {
  Sonner: SonnerUsage,
};
