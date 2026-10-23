import type { TemplateOnlyComponent } from '@ember/component/template-only';

import FieldContainer from './field-container.gts';

// AuthFormField, which the sign-in, registration and password-reset screens
// wrap each field in, in the app and on the secure origin alike. Its block is given its label's id,
// as FieldContainer's is.
interface Signature {
  Element: HTMLElement;
  Args: {
    label?: string;
  };
  Blocks: { default: [labelId: string | undefined] };
}

const AuthFormField: TemplateOnlyComponent<Signature> = <template>
  <FieldContainer
    @label={{@label}}
    @tag='label'
    @vertical={{true}}
    class='auth-form-field'
    ...attributes
    as |labelId|
  >
    {{yield labelId}}
  </FieldContainer>

  <style scoped>
    .auth-form-field {
      margin-top: var(--boxel-sp);
    }
    .auth-form-field :deep(input:autofill) {
      transition:
        background-color 0s 600000s,
        color 0s 600000s;
    }
    .auth-form-field :deep(.validation-icon-container) {
      display: none;
    }
    .auth-form-field :deep(.error-message) {
      margin-left: 0;
      font: 500 var(--boxel-font-xs);
    }
  </style>
</template>;

export default AuthFormField;
