import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Field } from '@cardstack/pretui/components/field';

// AuthFormField, which the sign-in, registration and password-reset screens
// wrap each field in, in the app and on the secure origin alike: Pret UI's
// Field, its label above the control. Its block is given its label's id and
// the id its control takes, which the label points at; a control that can't
// take an id (`@labelTag='span'`) names itself by the label's id alone.
interface Signature {
  Element: HTMLElement;
  Args: {
    label?: string;
    labelTag?: 'label' | 'span';
  };
  Blocks: { default: [labelId: string | undefined, controlId: string] };
}

const AuthFormField: TemplateOnlyComponent<Signature> = <template>
  <Field
    @label={{@label}}
    @labelTag={{@labelTag}}
    class='auth-form-field'
    ...attributes
    as |controlId _messageId labelId|
  >
    {{yield labelId controlId}}
  </Field>

  <style scoped>
    /* The control shows its own error, so no line is kept for a message. */
    .auth-form-field {
      --pretui-field-message-min-height: 0;
      margin-top: var(--boxel-sp);
      justify-items: stretch;
    }
    .auth-form-field :deep(input:autofill) {
      transition:
        background-color 0s 600000s,
        color 0s 600000s;
    }
    .auth-form-field :deep(.validation-icon-container) {
      display: none;
    }
    .auth-form-field :deep(.boxel-input.has-validation-icon) {
      padding-inline-end: var(--boxel-input-padding-inline-end, 0);
    }
    .auth-form-field :deep(.error-message) {
      margin-inline-start: 0;
      font: 500 var(--boxel-font-xs);
    }
  </style>
</template>;

export default AuthFormField;
