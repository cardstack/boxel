// Pretui — Loader usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from '../freestyle';
import { Loader } from '../feedback';

const LoaderUsage: TemplateOnlyComponent = <template>
  <FreestyleUsage
    @name='Loader'
    @description='Spinner under the shadcn and Mantine name: an indeterminate ring that takes its colour from the surrounding text. Import it when a port already says Loader; the component and its writeup are Spinner.'
    @source='<Loader @size={{20}} />'
  >
    <:example>
      <Loader @size={{20}} />
      <span class='tint-primary'><Loader @size={{20}} /></span>
      <span class='tint-danger'><Loader @size={{20}} /></span>
    </:example>
    <:api as |Args|>
      <Args.Number @name='size' @defaultValue={{13}} @description='Pixels, or any spelling of the xs · s · m · l · xl scale.' />
    </:api>
  </FreestyleUsage>
  <style scoped>
    .tint-primary {
      color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
      display: inline-flex;
    }
    .tint-danger {
      color: var(--pretui-destructive-ink, var(--boxel-danger));
      display: inline-flex;
    }
  </style>
</template>;

export const DEMOS_LOADER: Record<string, unknown> = {
  Loader: LoaderUsage,
};
