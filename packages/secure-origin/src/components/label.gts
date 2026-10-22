import type { TemplateOnlyComponent } from '@ember/component/template-only';

// boxel-ui's Label, drawn as a `div` at its default size. boxel-ui's can't
// ship on the secure origin (ADR 008 §1.3), so its template and styles are
// brought here, kept as they are there, but for the sizes the secure origin's
// pages don't draw.
interface Signature {
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

const Label: TemplateOnlyComponent<Signature> = <template>
  <div class='boxel-label' ...attributes>
    {{yield}}
  </div>
  <style scoped>
    @layer boxelComponentL1 {
      .boxel-label {
        color: var(--boxel-label-color);
        font-size: var(--boxel-label-font-size, var(--boxel-body-font-size));
        font-weight: var(--boxel-label-font-weight, 500);
        line-height: var(--boxel-label-line-height, 1.1);
        font-family: inherit;
        letter-spacing: var(--boxel-label-letter-spacing, var(--boxel-lsp-sm));
      }
    }
  </style>
</template>;

export default Label;
