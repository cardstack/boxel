import { array, fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { TrackedArray } from 'tracked-built-ins';

import Alert from './index.gts';

interface Signature {
  Element: HTMLElement;
}

export default class AlertUsage extends Component<Signature> {
  @tracked private messageType: 'error' | 'warning' = 'error';
  private messages = new TrackedArray([
    'Patch command can’t run because it doesn’t have all the fields in arguments returned by Open AI.',
    'Error rendering attached cards.',
  ]);
  private retryHandler = () => console.log('Retry action triggered');

  <template>
    <FreestyleUsage @name='Alert'>
      <:description>
        A component that displays error or warning messages with an optional
        action.
      </:description>
      <:example>
        <Alert @type={{this.messageType}} as |Alert|>
          <Alert.Messages @messages={{this.messages}} />
          <Alert.Action @actionName='Retry' @action={{this.retryHandler}} />
        </Alert>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='type'
          @description='Type of the first message'
          @value={{this.messageType}}
          @options={{array '' 'error' 'warning'}}
          @onInput={{fn (mut this.messageType)}}
        />
        <Args.Array
          @name='messages'
          @description='Alert messages'
          @items={{this.messages}}
        />
        <Args.Action
          @name='retryAction'
          @description='Optional callback function that is triggered when the retry button is clicked'
          @optional={{true}}
        />
      </:api>
    </FreestyleUsage>
    <FreestyleUsage @name='Without Retry Button'>
      <:example>
        <Alert @type='warning' as |Alert|>
          <Alert.Messages
            @messages={{array
              'You are about to run of credit. Please upgrade your plan or buy additional credit soon.'
            }}
          />
        </Alert>
      </:example>
    </FreestyleUsage>
  </template>
}
