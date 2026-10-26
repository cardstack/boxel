// The fields a key is entered in: its name, a label for the user's own use,
// and its value, masked as it is typed. A key holds no destination; where it
// may be sent is granted when an operation using it is approved.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import AuthFormField from '../../components/auth-form-field.gts';
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
    <AuthFormField @label='Name' data-test-key-field='name'>
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
    </AuthFormField>
  {{/if}}
  <AuthFormField @label='Key' data-test-key-field='value'>
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
  </AuthFormField>
</template>;

export default KeyFields;
