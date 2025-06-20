import { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Element: HTMLDivElement;
  Blocks: { default: [] };
}

const CommandButtonBar: TemplateOnlyComponent<Signature> = <template>
  <div class='command-button-bar' ...attributes>
    {{yield}}
  </div>
  <style scoped>
    .command-button-bar {
      display: flex;
      justify-content: flex-end;
    }
    .command-button-bar > :deep(* + *) {
      margin-left: var(--boxel-sp-xs);
    }
  </style>
</template>;

export default CommandButtonBar;
