import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import BoxelGridContainer from './index.gts';

interface Signature {
  Element: HTMLElement;
}

export default class GridContainerUsage extends Component<Signature> {
  <template>
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
  </template>
}
