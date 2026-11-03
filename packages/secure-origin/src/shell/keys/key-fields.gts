// The fields a key is entered in, as rows of a card's edit format: its name,
// a label for the user's own use, and its value, masked as it is typed. A
// key holds no destination; where it may be sent is granted when an operation
// using it is approved. An OAuth app's fields go between the two, its client
// secret being the value. A service account's value is its key file, entered
// in its own fields, so for one only the name is drawn here.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import FieldContainer from '../../components/field-container.gts';
import KeyRound from '../../components/icons/key-round.gts';
import Tag from '../../components/icons/tag.gts';
import BoxelInput from '../../components/input.gts';
import { autofocus } from '../../modifiers/autofocus.ts';

interface Signature {
  Args: {
    // Absent when only the value is entered, as when replacing a key.
    name?: string;
    onName?: (value: string) => void;
    // Absent when the value is entered in other fields.
    value?: string;
    onValue?: (value: string) => void;
    // What the value is called, when it isn't a key: an OAuth app's client
    // secret.
    valueLabel?: string;
  };
  Blocks: { beforeValue: [] };
}

const KeyFields: TemplateOnlyComponent<Signature> = <template>
  {{#if @onName}}
    <FieldContainer
      @tag='label'
      @label='Name'
      @icon={{Tag}}
      data-test-key-field='name'
    >
      <BoxelInput
        @type='text'
        @autocomplete='off'
        @placeholder='A name you’ll recognize, such as “Weather service”'
        @value={{@name}}
        @onInput={{@onName}}
        name='key-name'
        data-test-key-name
        {{autofocus}}
      />
    </FieldContainer>
  {{/if}}
  {{yield to='beforeValue'}}
  {{#if @onValue}}
    <FieldContainer
      @tag='label'
      @label={{if @valueLabel @valueLabel 'Key'}}
      @icon={{KeyRound}}
      data-test-key-field='value'
    >
      <BoxelInput
        @type='password'
        @autocomplete='off'
        @placeholder={{if @valueLabel 'Paste the secret' 'Paste the key'}}
        @value={{@value}}
        @onInput={{@onValue}}
        name='key-value'
        spellcheck='false'
        data-test-key-value
        {{autofocus (if @onName false true)}}
      />
    </FieldContainer>
  {{/if}}
</template>;

export default KeyFields;
