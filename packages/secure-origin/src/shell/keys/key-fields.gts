// The fields a key is entered in, as rows of a card's edit format: its name,
// a label for the user's own use, and its value, masked as it is typed. A
// key holds no destination; where it may be sent is granted when an operation
// using it is approved. An OAuth app's fields go between the two, its client
// secret being the value. A service account's value is its key file, entered
// in its own fields, so for one only the name is drawn here.
//
// A name beside a masked value is a login form's shape, on the origin where
// the Boxel login is saved, so each field tells password managers to leave it
// alone: none fills the login in, or offers to save the key as the password.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Field } from '@cardstack/pretui/components/field';
import KeyRound from '@cardstack/boxel-icons/key-round';
import Tag from '@cardstack/boxel-icons/tag';
import { Input } from '@cardstack/pretui/components/input';
import { ignoredByPasswordManagers } from '@cardstack/pretui/password-managers';
import { focusWhen } from '@cardstack/pretui/focus';

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
    <Field
      @reserveMessage={{false}}
      @orientation='horizontal'
      @label='Name'
      @icon={{Tag}}
      data-test-key-field='name'
      as |controlId|
    >
      <Input
        @controlId={{controlId}}
        @type='text'
        autocomplete='off'
        @placeholder='A name you’ll recognize, such as “Weather service”'
        @value={{@name}}
        @onInput={{@onName}}
        name='key-name'
        data-test-key-name
        {{ignoredByPasswordManagers}}
        {{focusWhen true}}
      />
    </Field>
  {{/if}}
  {{yield to='beforeValue'}}
  {{#if @onValue}}
    <Field
      @reserveMessage={{false}}
      @orientation='horizontal'
      @label={{if @valueLabel @valueLabel 'Key'}}
      @icon={{KeyRound}}
      data-test-key-field='value'
      as |controlId|
    >
      <Input
        @controlId={{controlId}}
        @type='password'
        autocomplete='off'
        @placeholder={{if @valueLabel 'Paste the secret' 'Paste the key'}}
        @value={{@value}}
        @onInput={{@onValue}}
        name='key-value'
        spellcheck='false'
        data-test-key-value
        {{ignoredByPasswordManagers}}
        {{focusWhen (if @onName false true)}}
      />
    </Field>
  {{/if}}
</template>;

export default KeyFields;
