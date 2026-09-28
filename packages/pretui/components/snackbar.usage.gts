// Pretui — Snackbar usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Snackbar } from './snackbar';

const SnackbarUsage: TemplateOnlyComponent = <template>
  <FreestyleUsage
    @name='Snackbar'
    @description='Toast under the MUI name: the brief status card alone, with no position, clock or live region of its own. Import it when a port already says Snackbar; the component and its writeup are Toast, and the host that stacks and ages them is Toaster.'
    @source="<Snackbar @title='Lot saved' @message='B-103 is ready for review'>…</Snackbar>"
  >
    <:example>
      <Snackbar @title='Lot saved' @message='B-103 is ready for review'>
        <:icon>✓</:icon>
        <:action><Button @variant='ghost'>Review</Button></:action>
      </Snackbar>
    </:example>
    <:api as |Args|>
      <Args.String @name='title' @value='Lot saved' />
      <Args.String @name='message' @value='B-103 is ready for review' @description='The second line; description is the Sonner spelling of the same arg.' />
      <Args.Yield @name='icon' />
      <Args.Yield @name='action' />
    </:api>
  </FreestyleUsage>
</template>;

export const DEMOS_SNACKBAR: Record<string, unknown> = {
  Snackbar: SnackbarUsage,
};
