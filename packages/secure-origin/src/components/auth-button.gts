// AuthButton: a full-width Button of the touch size, as every button on the
// sign-in screens is, in the app and on the secure origin alike.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import Button from './button.gts';

export type AuthButtonVariant = 'primary' | 'secondary' | 'default';

interface Signature {
  Element: HTMLButtonElement | HTMLAnchorElement;
  Args: {
    as?: 'button' | 'anchor';
    disabled?: boolean;
    href?: string;
    loading?: boolean;
    variant?: AuthButtonVariant;
  };
  Blocks: { default: [] };
}

const AuthButton: TemplateOnlyComponent<Signature> = <template>
  <Button
    class='auth-btn'
    @as={{@as}}
    @href={{@href}}
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
