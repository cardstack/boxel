// Pretui — LoadingState usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { LoadingState } from './loading-state';
import { DemoRow } from '../demo-foundations-more';

const LoadingStateUsage: TemplateOnlyComponent = <template>
    <FreestyleUsage @name='LoadingState' @description='A named, accessible loading receipt. Elapsed time is caller-owned so the realm component stays timer-free and deterministic.' @source='<LoadingState @label="Checking references" @elapsed="4.2s" />'>
      <:example><DemoRow><LoadingState @label='Checking references' @elapsed='4.2s' /><LoadingState @label='Indexing cards' @variant='dots' /><LoadingState @label='Resolving links' @variant='orbit' /></DemoRow></:example>
      <:api as |Args|><Args.String @name='label' @value='Checking references' /><Args.String @name='variant' @value='drive' /><Args.String @name='elapsed' @value='4.2s' /></:api>
    </FreestyleUsage>
  </template>;

export const DEMOS_LOADING_STATE: Record<string, unknown> = {
  LoadingState: LoadingStateUsage,
};
