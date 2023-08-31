/* eslint-disable no-console */
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import Accordion from './index';

export default class AccordionUsage extends Component {
  @tracked title = 'Accordion Title';

  <template>
    <FreestyleUsage @name='Accordion'>
      <:example>
        <Accordion @title={{this.title}} />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @optional={{true}}
          @description='The title argument for Accordion'
          @onInput={{fn (mut this.title)}}
          @value={{this.title}}
        />
      </:api>
      <:description>
      </:description>
    </FreestyleUsage>
  </template>
}
