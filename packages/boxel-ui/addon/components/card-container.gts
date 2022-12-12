import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { initStyleSheet, attachStyles } from '../attach-styles';

interface Signature {
  Element: HTMLElement;
  Blocks: {
    default: [],
  };
}

let styles = initStyleSheet(`
  .boxel-card-container {
    background-color: var(--boxel-light);
    border-radius: var(--boxel-border-radius);
    border: 1px solid var(--boxel-light-500);
    padding: 1rem;
  }
`);

const CardContainer: TemplateOnlyComponent<Signature> = <template>
  <div
    class="boxel-card-container"
    {{attachStyles styles}}
    data-test-boxel-card-container
    ...attributes
  >
    {{yield}}
  </div>
</template>;
export default CardContainer;
