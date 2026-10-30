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
      /* reading type: answers and the reader's bubble, 14 on 22 */
      font-size: var(--boxel-font-size-sm);
      font-weight: 400;
      line-height: var(--boxel-line-height-sm);
      text-wrap: pretty;
      /* its own block context, without clipping: a reply's table and a
         framed row hang their inset into the gutter */
      display: flow-root;
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
