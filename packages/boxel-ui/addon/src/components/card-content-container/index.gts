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
  <style>
    .card-content-container {
      padding: 10px;
    }
  </style>
</template>;

export default CardContentContainer;
