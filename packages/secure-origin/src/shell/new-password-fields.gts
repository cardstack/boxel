import type { TemplateOnlyComponent } from '@ember/component/template-only';

import AuthFormField from '../components/auth-form-field.gts';
import BoxelInput from '../components/input.gts';
import ValidationHint from '../components/validation-hint.gts';
import { autofocus } from '../modifiers/autofocus.ts';
import type { NewPassword } from './new-password.ts';

// The new password and confirmation fields of the app's registration and
// password reset forms. `@hints` shows registration's check-marked hint
// under each once it is right.
interface Signature {
  Args: {
    password: NewPassword;
    passwordLabel: string;
    confirmLabel: string;
    passwordPlaceholder?: string;
    confirmPlaceholder?: string;
    hints?: boolean;
    // Focuses the new password field as it is drawn.
    autofocus?: boolean;
  };
}

const NewPasswordFields: TemplateOnlyComponent<Signature> = <template>
  <AuthFormField
    @label={{@passwordLabel}}
    data-test-secure-field='password'
    as |labelId|
  >
    <BoxelInput
      aria-labelledby={{labelId}}
      data-test-password-field
      name='password'
      autocomplete='new-password'
      @type='password'
      @value={{@password.password}}
      placeholder={{@passwordPlaceholder}}
      @state={{if @password.passwordError 'invalid' 'initial'}}
      @errorMessage={{@password.passwordError}}
      @onInput={{@password.setPassword}}
      @onBlur={{@password.checkPassword}}
      {{autofocus (if @autofocus true false)}}
    />
    {{#if @hints}}
      {{#if @password.passwordValid}}
        <ValidationHint data-test-password-valid>password is valid</ValidationHint>
      {{/if}}
    {{/if}}
  </AuthFormField>
  <AuthFormField
    @label={{@confirmLabel}}
    data-test-secure-field='confirm-password'
    as |labelId|
  >
    <BoxelInput
      aria-labelledby={{labelId}}
      data-test-confirm-password-field
      name='confirm-password'
      autocomplete='new-password'
      @type='password'
      @value={{@password.confirm}}
      placeholder={{@confirmPlaceholder}}
      @state={{if @password.confirmError 'invalid' 'initial'}}
      @errorMessage={{@password.confirmError}}
      @onInput={{@password.setConfirm}}
      @onBlur={{@password.checkConfirm}}
    />
    {{#if @hints}}
      {{#if @password.confirmValid}}
        <ValidationHint data-test-passwords-match>passwords match</ValidationHint>
      {{/if}}
    {{/if}}
  </AuthFormField>
</template>;

export default NewPasswordFields;
