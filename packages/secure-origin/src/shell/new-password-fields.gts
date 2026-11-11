import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Cue } from '@cardstack/pretui/components/cue';

import AuthFormField from '../components/auth-form-field.gts';
import { Input } from '@cardstack/pretui/components/input';
import { focusWhen } from '@cardstack/pretui/focus';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULES,
} from '../security/password-rules.js';
import type { NewPassword } from './new-password.ts';

// The new password and confirmation fields of the app's registration and
// password reset forms. Each states the password rule in `minlength` and
// `passwordrules`, so a password manager generates a password the form
// accepts; neither carries `maxlength` (see `newPasswordError`). `@hints`
// shows registration's check-marked hint under each once it is right.
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
    as |labelId controlId|
  >
    <Input
      @controlId={{controlId}}
      aria-labelledby={{labelId}}
      data-test-password-field
      name='password'
      autocomplete='new-password'
      minlength={{MIN_PASSWORD_LENGTH}}
      passwordrules={{PASSWORD_RULES}}
      @type='password'
      @value={{@password.password}}
      placeholder={{@passwordPlaceholder}}
      @invalid={{if @password.passwordError true false}}
      @errorMessage={{@password.passwordError}}
      @onInput={{@password.setPassword}}
      {{on 'blur' @password.checkPassword}}
      {{focusWhen (if @autofocus true false)}}
    />
    {{#if @hints}}
      {{#if @password.passwordValid}}
        <Cue
          @tone='success'
          @text='password is valid'
          class='validation-hint'
          data-test-password-valid
        />
      {{/if}}
    {{/if}}
  </AuthFormField>
  <AuthFormField
    @label={{@confirmLabel}}
    data-test-secure-field='confirm-password'
    as |labelId controlId|
  >
    <Input
      @controlId={{controlId}}
      aria-labelledby={{labelId}}
      data-test-confirm-password-field
      name='confirm-password'
      autocomplete='new-password'
      minlength={{MIN_PASSWORD_LENGTH}}
      passwordrules={{PASSWORD_RULES}}
      @type='password'
      @value={{@password.confirm}}
      placeholder={{@confirmPlaceholder}}
      @invalid={{if @password.confirmError true false}}
      @errorMessage={{@password.confirmError}}
      @onInput={{@password.setConfirm}}
      {{on 'blur' @password.checkConfirm}}
    />
    {{#if @hints}}
      {{#if @password.confirmValid}}
        <Cue
          @tone='success'
          @text='passwords match'
          class='validation-hint'
          data-test-passwords-match
        />
      {{/if}}
    {{/if}}
  </AuthFormField>
  <style scoped>
    .validation-hint {
      display: flex;
      margin-top: var(--boxel-sp-2xs);
    }
  </style>
</template>;

export default NewPasswordFields;
