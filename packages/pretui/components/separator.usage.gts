// Pretui — Separator usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { Separator } from './separator';

const SeparatorUsage: TemplateOnlyComponent = <template>
  <FreestyleUsage
    @name='Separator'
    @description='Divider under the shadcn / Radix name: a role=separator rule with an explicit orientation and an optional centred label. Import it when a port already says Separator; the component and its writeup are Divider.'
    @source="<Separator @label='or' />"
  >
    <:example>
      <p class='sep-demo-line'>Sign in with a passkey</p>
      <Separator @label='or' />
      <p class='sep-demo-line'>Use a one-time code</p>
    </:example>
    <:api as |Args|>
      <Args.String @name='orientation' @defaultValue='horizontal' @description='horizontal or vertical.' />
      <Args.String @name='label' @value='or' @description='A centred label, horizontal only.' />
    </:api>
  </FreestyleUsage>
  <style scoped>
    .sep-demo-line {
      margin: 0;
      font-size: var(--text-ui-md, 0.78rem);
    }
  </style>
</template>;

export const DEMOS_SEPARATOR: Record<string, unknown> = {
  Separator: SeparatorUsage,
};
