// Pretui — EmptyState usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from '../freestyle';
import { Button } from './button';
import { EmptyState } from './empty-state';

const EmptyStateUsage: TemplateOnlyComponent = <template>
    <FreestyleUsage @name='EmptyState' @description='A named absence with optional action. Texture is confined to this low-information surface and never competes with data.' @source='<EmptyState @title="No lots match" @message="Try clearing…">…</EmptyState>'>
      <:example><EmptyState @title='No lots match' @message='Try clearing the origin and harvest filters.'><:action><Button @variant='secondary'>Clear filters</Button></:action></EmptyState></:example>
      <:api as |Args|><Args.String @name='title' @value='No lots match' /><Args.String @name='message' @value='Try clearing the origin and harvest filters.' /><Args.Bool @name='texture' @defaultValue={{true}} /><Args.Yield @name='action' /></:api>
    </FreestyleUsage>
  </template>;

export const DEMOS_EMPTY_STATE: Record<string, unknown> = {
  EmptyState: EmptyStateUsage,
};
