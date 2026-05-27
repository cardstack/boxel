import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import CopyButton from './index.gts';

export default class CopyButtonUsage extends Component {
  @tracked textToCopy: string = 'Text to copy';

  <template>
    <FreestyleUsage @name='CopyButton'>
      <:example>
        <CopyButton @textToCopy={{this.textToCopy}} />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='text'
          @onInput={{fn (mut this.textToCopy)}}
          @value={{this.textToCopy}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
