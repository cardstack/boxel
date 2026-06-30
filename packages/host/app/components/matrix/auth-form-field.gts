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
    .auth-form-field :deep(.validation-icon-container.invalid) {
      display: none;
    }
    .auth-form-field :deep(.validation-icon-container.valid svg) {
      height: var(--boxel-sp-xs);
    }
    .auth-form-field :deep(.boxel-input-group--invalid > :nth-last-child(2)) {
      border-top-right-radius: var(--boxel-input-group-border-radius);
      border-bottom-right-radius: var(--boxel-input-group-border-radius);
      border-right-width: var(--boxel-input-group-interior-border-width);
    }
    .auth-form-field
      :deep(
        .boxel-input-group:not(.boxel-input-group--invalid) > :nth-last-child(2)
      ) {
      padding-right: 0;
    }
    .auth-form-field :deep(.error-message) {
      margin-left: 0;
      font: 500 var(--boxel-font-xs);
    }
    .auth-form-field :deep(.text-accessory) {
      color: var(--muted-foreground);
    }
  </style>
</template>;

export default AuthFormField;
