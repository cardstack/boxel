// Pretui — Callout usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from '../freestyle';
import { Button } from '../controls';
import { Callout } from '../feedback';

const CalloutUsage: TemplateOnlyComponent = <template>
  <FreestyleUsage
    @name='Callout'
    @description='Alert under the Tremor and Web Awesome name: an inline, tone-mapped banner with a title, prose and an optional action. Import it when a port already says Callout; the component and its writeup are Alert.'
    @source="<Callout @tone='warning' @title='Credit is running low'>…</Callout>"
  >
    <:example>
      <div class='callout-col'>
        <Callout @tone='warning' @title='Credit is running low'>
          <:default>Upgrade the plan or buy additional credit before the next
            run.</:default>
          <:action>
            <Button @tone='neutral' @appearance='outlined' @size='xs'>
              Upgrade
            </Button>
          </:action>
        </Callout>
        <Callout @tone='success'>
          <:default>Lot 4417 published. It is visible to the desk now.</:default>
        </Callout>
      </div>
    </:example>
    <:api as |Args|>
      <Args.String @name='tone' @defaultValue='info' @description='info · success · warning · danger, plus the React spellings (destructive, error, positive, notice).' />
      <Args.String @name='title' @description='Bold headline above the prose.' />
      <Args.String @name='variant' @description="shadcn's one-enum spelling: default | destructive." />
      <Args.Yield @name='default' @description='The message, as prose.' />
      <Args.Yield @name='action' @description='An optional control beside the message.' />
    </:api>
  </FreestyleUsage>
  <style scoped>
    .callout-col {
      width: min(100%, 420px);
      display: grid;
      gap: var(--space-3, 8px);
    }
  </style>
</template>;

export const DEMOS_CALLOUT: Record<string, unknown> = {
  Callout: CalloutUsage,
};
