// Pretui — Prose usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { Prose } from './prose';

const ProseUsage: TemplateOnlyComponent = <template>
    <FreestyleUsage @name='Prose' @description='A restrained reading measure for authored text. Paragraph rhythm and inline machine values are styled without becoming a document renderer.' @source='<Prose><p>…</p></Prose>'>
      <:example><Prose><p>The first-flush Gyokuro arrived from Shizuoka under lot <code>B-103</code>. Its reserve is unchanged after sensory review.</p><p>Use <code>records@2.4.0</code> when importing the supplier manifest.</p></Prose></:example>
      <:api as |Args|><Args.Yield @name='default' @description='Semantic prose content.' /></:api>
    </FreestyleUsage>
  </template>;

export const DEMOS_PROSE: Record<string, unknown> = {
  Prose: ProseUsage,
};
