// Pretui — Prose: long-form text in the kit reading voice.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

export interface ProseSignature {
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

// The typographic reading surface — styles inline code per Law 3's quieter cousin.
export const Prose: TemplateOnlyComponent<ProseSignature> = <template>
  <div class='pretui-prose' data-test-pretui-prose ...attributes>{{yield}}</div>
  <style scoped>
    .pretui-prose {
      max-width: 62ch;
      line-height: calc(var(--leading-body, 24px) / var(--text-body, 15px));
    }
    .pretui-prose :deep(p) {
      margin: 0 0 var(--space-4, 11px);
    }
    .pretui-prose :deep(code) {
      font-family: var(--font-mono);
      font-size: 0.92em;
      background: var(--inset, var(--boxel-100));
      padding: 1px 5px;
      border-radius: 5px;
      box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
    }
  </style>
</template>;
