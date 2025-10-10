import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import FocusPill from './index';

export default class AiAssistantFocusPillUsage extends Component {
  @tracked label = 'Crypto Portfolio Tracker';
  @tracked metaPills: string[] = ['Schema', 'Lines 51–78'];

  <template>
    <FreestyleUsage @name='AiAssistant::FocusPill'>
      <:description>
        A compact group of pills highlighting a focus context. The first pill
        shows the label; meta pills display additional context information.
      </:description>
      <:example>
        <div class='container-to-constrain-width'>
          <FocusPill @label={{this.label}} @metaPills={{this.metaPills}} />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @description='Main label for the focus pill.'
          @value={{this.label}}
          @onInput={{fn (mut this.label)}}
        />
        <Args.Object
          @name='metaPills'
          @description='Array of strings for meta pills (e.g. ["Schema", "Lines 51–78"]). Leave empty to hide meta pills.'
          @value={{this.metaPills}}
          @onInput={{fn (mut this.metaPills)}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .container-to-constrain-width {
        max-width: 325px;
      }
    </style>
  </template>
}
