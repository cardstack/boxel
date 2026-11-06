// AuthButton: Pret UI's Button, full width and as tall as a touch target, as
// every button on the sign-in screens is. It keeps the sign-in screens' own
// treatment over Pret UI's: a pill, the heavier type, no shadow, and
// boxel-ui's colours for each variant. A link that looks like a button is
// drawn by giving it `@href`.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Button } from '@cardstack/pretui/components/button';
import type { ButtonVariant } from '@cardstack/pretui/components/button';

export type AuthButtonVariant = 'primary' | 'secondary' | 'default';

interface Signature {
  Element: HTMLButtonElement | HTMLAnchorElement;
  Args: {
    disabled?: boolean;
    href?: string;
    loading?: boolean;
    variant?: AuthButtonVariant;
  };
  Blocks: { default: [] };
}

// Primary is Pret UI's filled primary. Secondary is filled too, in the
// theme's secondary colours (set below). Default is Pret UI's outline, on
// the page's background.
function pretVariant(variant: AuthButtonVariant | undefined): ButtonVariant {
  return variant === 'default' || variant === undefined ? 'outline' : 'primary';
}

function isSecondary(variant: AuthButtonVariant | undefined): boolean {
  return variant === 'secondary';
}

const AuthButton: TemplateOnlyComponent<Signature> = <template>
  <Button
    class='auth-btn {{if (isSecondary @variant) "auth-btn-secondary"}}'
    @variant={{pretVariant @variant}}
    @href={{@href}}
    @disabled={{@disabled}}
    @loading={{@loading}}
    ...attributes
  >{{yield}}</Button>

  <style scoped>
    /* Unlayered, so it wins over Pret UI's PretComponent layer. */
    .auth-btn {
      --pretui-button-h: var(--boxel-button-touch);
      --pretui-button-px: var(--boxel-sp-lg);
      --pretui-button-radius: 100px;
      --pretui-button-secondary-bg: var(--background);
      --pretui-btn-elevation: none;
      width: 100%;
      padding-block: var(--boxel-sp-xs);
      font: 600 var(--boxel-font);
      font-family: inherit;
      letter-spacing: var(--boxel-lsp-xs);
    }
    .auth-btn-secondary {
      --pretui-button-bg: var(--secondary);
      --pretui-button-fg: var(--secondary-foreground);
      --pretui-btn-accent-hover: var(--secondary);
      border-color: var(--secondary);
    }
    /* A busy button keeps its colours, as boxel-ui's loading state does. */
    .auth-btn:disabled,
    a.auth-btn[aria-disabled='true'] {
      opacity: 0.5;
    }
    .auth-btn[data-state='busy'] {
      opacity: 1;
    }
  </style>
</template>;

export default AuthButton;
