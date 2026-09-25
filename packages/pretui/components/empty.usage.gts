// Pretui — Empty usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from '../freestyle';
import { Button } from './button';
import { Empty } from './empty';

const EmptyUsage: TemplateOnlyComponent = <template>
  <FreestyleUsage
    @name='Empty'
    @description='EmptyState under the shadcn / Ant name: a named absence with an optional message and action. Reach for this import when a port or an agent already speaks that vocabulary; the component, its contract and its writeup are EmptyState’s.'
    @source="<Empty @title='No lots match' @message='Try clearing…'><:action>…</:action></Empty>"
  >
    <:example>
      <Empty
        @title='No lots match'
        @message='Try clearing the origin and harvest filters.'
      >
        <:action><Button @variant='secondary'>Clear filters</Button></:action>
      </Empty>
    </:example>
    <:api as |Args|>
      <Args.String @name='title' @value='No lots match' @description='Required. shadcn’s EmptyTitle.' />
      <Args.String @name='message' @value='Try clearing the origin and harvest filters.' @description='shadcn’s EmptyDescription, Ant’s description.' />
      <Args.Bool @name='texture' @defaultValue={{true}} />
      <Args.Yield @name='action' @description='shadcn’s EmptyContent.' />
      <Args.Yield @name='altAction' @description='The second way in, given equal billing.' />
    </:api>
  </FreestyleUsage>
</template>;

export const DEMOS_EMPTY: Record<string, unknown> = {
  Empty: EmptyUsage,
};
