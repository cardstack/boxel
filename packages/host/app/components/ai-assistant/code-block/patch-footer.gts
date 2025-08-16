import type { TemplateOnlyComponent } from '@ember/component/template-only';

export interface CodeBlockPatchFooterSignature {
  Args: {};
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
}

const CodeBlockPatchFooterComponent: TemplateOnlyComponent<CodeBlockPatchFooterSignature> =
  <template>
    <style scoped>
      .code-block-patch-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        background-color: var(--boxel-650);
        color: var(--boxel-light);
        padding: 8px 12px;
        font-size: 14px;
        height: 50px;
      }

      :deep(.code-patch-error) {
        padding: 0;
      }
    </style>
    <div class='code-block-patch-footer'>{{yield}}</div>
  </template>;

export default CodeBlockPatchFooterComponent;
