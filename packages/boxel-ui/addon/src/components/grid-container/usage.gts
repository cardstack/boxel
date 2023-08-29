import type { TemplateOnlyComponent } from '@ember/component/template-only';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import BoxelGridContainer from './index';

interface Signature {
  Element: HTMLElement;
}

const GridContainerUsage: TemplateOnlyComponent<Signature> = <template>
  <FreestyleUsage @name='GridContainer'>
    <:description>
      A container that provides a grid layout and h3/h4 spacing.
    </:description>
    <:example>
      <BoxelGridContainer>
        <h3>h3</h3>
        <p>Hello</p>
      </BoxelGridContainer>
    </:example>
  </FreestyleUsage>
</template>;

export default GridContainerUsage;
