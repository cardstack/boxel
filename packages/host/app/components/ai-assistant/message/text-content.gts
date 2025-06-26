import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Element: HTMLDivElement;
  Blocks: { default: [] };
}

const TextContent: TemplateOnlyComponent<Signature> = <template>
  <div class='message' ...attributes>
    {{yield}}
  </div>

  <style scoped>
    .message {
      position: relative;
      font-size: var(--boxel-font-size-sm);
      font-weight: 400;
      line-height: 1.5em;
      letter-spacing: var(--boxel-lsp-xs);
      text-wrap: pretty;
      overflow: hidden;
    }
    .message > :deep(*) {
      margin-block: 0;
    }
    .message > :deep(* + *) {
      margin-top: var(--boxel-sp-sm);
    }
  </style>
</template>;

export default TextContent;
