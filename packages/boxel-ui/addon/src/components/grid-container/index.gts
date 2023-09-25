import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

const GridContainer: TemplateOnlyComponent<Signature> = <template>
  <div class='grid-container' ...attributes>
    {{yield}}
  </div>
  <style>
    .grid-container {
      display: grid;
      gap: var(--boxel-sp);
    }

    .grid-container :deep(h2),
    .grid-container :deep(h3) {
      margin: 0;
    }
  </style>
</template>;

export default GridContainer;
