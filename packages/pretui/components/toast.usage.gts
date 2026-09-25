// Pretui — Toast usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from '../freestyle';
import { Button } from './button';
import { Toast } from './toast';

const ToastUsage: TemplateOnlyComponent = <template>
    <FreestyleUsage @name='Toast' @description='A brief in-flow status receipt. Positioning and lifetime belong to its host; title, message and action remain ordinary content.' @source='<Toast @title="Lot saved" @message="B-103 is ready for review">…</Toast>'>
      <:example><Toast @title='Lot saved' @message='B-103 is ready for review'><:icon>✓</:icon><:action><Button @variant='ghost'>Review</Button></:action></Toast></:example>
      <:api as |Args|><Args.String @name='title' @value='Lot saved' /><Args.String @name='message' @value='B-103 is ready for review' /><Args.Yield @name='icon' /><Args.Yield @name='action' /></:api>
    </FreestyleUsage>
  </template>;

export const DEMOS_TOAST: Record<string, unknown> = {
  Toast: ToastUsage,
};
