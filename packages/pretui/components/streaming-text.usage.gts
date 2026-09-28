// Pretui — StreamingText usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { StreamingText } from './streaming-text';

const StreamingTextUsage: TemplateOnlyComponent = <template>
    <FreestyleUsage @name='StreamingText' @description='Timer-free word reveal for agent output. The full sentence remains available to assistive technology and reduced-motion users.' @source='<StreamingText @text="Comparing supplier records…" @rate={{12}} />'>
      <:example><StreamingText @text='Comparing supplier records against 148 approved tea lots.' @rate={{12}} @cursor={{true}} /></:example>
      <:api as |Args|><Args.String @name='text' @value='Comparing supplier records against 148 approved tea lots.' /><Args.Number @name='rate' @value={{12}} /><Args.Number @name='startDelay' @defaultValue={{0}} /><Args.Bool @name='cursor' @value={{true}} /></:api>
    </FreestyleUsage>
  </template>;

export const DEMOS_STREAMING_TEXT: Record<string, unknown> = {
  StreamingText: StreamingTextUsage,
};
