import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { FieldContainer } from '@cardstack/boxel-ui/components';

interface Signature {
  Element: HTMLElement;
  Args: {
    label: string;
  };
  Blocks: { default: [] };
}

const AuthFormField: TemplateOnlyComponent<Signature> = <template>
  <FieldContainer
    @label={{@label}}
    @tag='label'
    @vertical={{true}}
    class='auth-form-field'
    ...attributes
  >
    {{yield}}
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
