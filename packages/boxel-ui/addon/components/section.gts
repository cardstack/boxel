import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { initStyleSheet, attachStyles } from '../attach-styles';
import Header from './header';

interface Signature {
  Element: HTMLElement;
  Args: {
    header?: string;
  };
  Blocks: {
    default: [],
  };
}

let styles = initStyleSheet(`
  .boxel-section__header {
    grid-column: 1 / -1;
  }
`);

const Section: TemplateOnlyComponent<Signature> = <template>
  <section class="boxel-section" {{attachStyles styles}} data-test-boxel-section ...attributes>
    {{#if @header}}
      <Header @label={{@header}} @size="medium" @noBackground={{true}} class="boxel-section__header" />
    {{/if}}

    {{yield}}
  </section>
</template>;

export default Section;
