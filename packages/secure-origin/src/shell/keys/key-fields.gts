// The fields a key is entered in, as rows of a card's edit format: its name,
// a label for the user's own use, and its value, masked as it is typed. A key
// holds no destination; where it may be sent is granted when an operation
// using it is approved.
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
    value: string;
    onName?: (value: string) => void;
    onValue: (value: string) => void;
  };
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
  <FieldContainer
    @tag='label'
    @label='Key'
    @icon={{KeyRound}}
    data-test-key-field='value'
  >
    <BoxelInput
      @type='password'
      @autocomplete='off'
      @placeholder='Paste the key'
      @value={{@value}}
      @onInput={{@onValue}}
      name='key-value'
      spellcheck='false'
      data-test-key-value
      {{autofocus (if @onName false true)}}
    />
  </FieldContainer>
</template>;

export default KeyFields;
