import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import FocusPill from './index';

export default class AiAssistantFocusPillUsage extends Component {
  @tracked label = 'Crypto Portfolio Tracker';
  @tracked itemType: string | undefined = 'Schema';
  @tracked codeRange: string | undefined = 'Lines 51–78';

  <template>
    <FreestyleUsage @name='AiAssistant::FocusPill'>
      <:description>
        A compact group of pills highlighting a focus context. The first pill
        shows the label; optional meta pills can show an item type and a code
        range.
      </:description>
      <:example>
        <div class='container-to-constrain-width'>
          <FocusPill
            @label={{this.label}}
            @itemType={{this.itemType}}
            @codeRange={{this.codeRange}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @description='Main label for the focus pill.'
          @value={{this.label}}
          @onInput={{fn (mut this.label)}}
        />
        <Args.String
          @name='itemType'
          @description='Optional meta pill showing an item type (e.g. “Schema”). Leave empty to hide.'
          @value={{this.itemType}}
          @onInput={{fn (mut this.itemType)}}
        />
        <Args.String
          @name='codeRange'
          @description='Optional meta pill showing a code range (e.g. “Lines 51–78”). Leave empty to hide.'
          @value={{this.codeRange}}
          @onInput={{fn (mut this.codeRange)}}
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
