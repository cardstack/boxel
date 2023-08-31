/* eslint-disable no-console */
import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import Accordion from './index';

export default class AccordionUsage extends Component {
  <template>
    <FreestyleUsage @name='Accordion'>
      <:example>
        <Accordion />
      </:example>
      <:description>
      </:description>
    </FreestyleUsage>
  </template>
}
