import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

const CardContentContainer: TemplateOnlyComponent<Signature> = <template>
  <div class='card-content-container' ...attributes>
    {{yield}}
  </div>
  <style scoped>
    .card-content-container {
      padding: var(--boxel-sp);
    }
  </style>
</template>;

export default CardContentContainer;
