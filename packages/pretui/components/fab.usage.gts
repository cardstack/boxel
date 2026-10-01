// Pretui — Fab usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { Fab } from './fab';

const SOURCE = "<div style='position: relative'>…<Fab @label='Compose' @extended={{true}} /></div>";

const FabUsage: TemplateOnlyComponent = <template>
  <FreestyleUsage
    @name='Fab'
    @description='FloatButton under the MUI name: a corner-anchored action, or with @actions a speed dial. Import it when a port already says Fab; the component and its writeup are FloatButton.'
    @source={{SOURCE}}
  >
    <:example>
      <div class='fab-demo-pane'>
        <Fab @label='Compose' @extended={{true}} />
      </div>
    </:example>
    <:api as |Args|>
      <Args.String @name='label' @required={{true}} @value='Compose' />
      <Args.Bool @name='extended' @value={{true}} @description='MUI variant="extended": the label shows beside the icon.' />
      <Args.Yield @name='default' @description='The icon.' />
    </:api>
  </FreestyleUsage>
  <style scoped>
    .fab-demo-pane {
      position: relative;
      block-size: 8rem;
      border-radius: var(--radius-surface, 10px);
      box-shadow: 0 0 0 1px var(--border);
      background: var(--card);
    }
  </style>
</template>;

export const DEMOS_FAB: Record<string, unknown> = {
  Fab: FabUsage,
};
