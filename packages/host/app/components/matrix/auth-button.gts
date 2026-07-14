import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Button } from '@cardstack/boxel-ui/components';

export type AuthButtonVariant = 'primary' | 'secondary' | 'default';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    variant?: AuthButtonVariant;
    disabled?: boolean;
    loading?: boolean;
  };
  Blocks: { default: [] };
}

const AuthButton: TemplateOnlyComponent<Signature> = <template>
  <Button
    class='auth-btn'
    @kind={{@variant}}
    @size='touch'
    @disabled={{@disabled}}
    @loading={{@loading}}
    ...attributes
  >{{yield}}</Button>

  <style scoped>
    .auth-btn {
      width: 100%;
    }
    .auth-btn :deep(.boxel-loading-indicator) {
      display: flex;
      justify-content: center;
      align-items: center;
    }
  </style>
</template>;

export default AuthButton;
