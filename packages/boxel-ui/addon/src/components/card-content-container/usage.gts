import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import BoxelCardContentContainer from './index.gts';

interface Signature {
  Element: HTMLElement;
}

export default class CardContentContainerUsage extends Component<Signature> {
  <template>
    <FreestyleUsage @name='CardContentContainer'>
      <:description>
        A container that provides standard padding.
      </:description>
      <:example>
        <BoxelCardContentContainer>
          <h3>h3</h3>
          <p>Hello</p>
        </BoxelCardContentContainer>
      </:example>
    </FreestyleUsage>
  </template>
}
