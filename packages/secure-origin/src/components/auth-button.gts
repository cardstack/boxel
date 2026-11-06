// AuthButton: Pret UI's Button, full width and as tall as a touch target, as
// every button on the sign-in screens is. It paints from the theme's
// `--boxel-button-*` variables, which the sign-in screens' themes set, over
// Pret UI's own treatment, so the screens keep their look: a pill, the
// heavier type, no shadow, and the theme's colors for each variant and for
// a disabled button. A link that looks like a button is drawn by giving it
// `@href`.
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

// Pret UI's nearest variant, which carries the hover and focus treatment.
function pretVariant(variant: AuthButtonVariant | undefined): ButtonVariant {
  return variant === 'primary' ? 'primary' : 'outline';
}

const AuthButton: TemplateOnlyComponent<Signature> = <template>
  <Button
    class='auth-btn auth-btn-{{if @variant @variant "default"}}'
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
      --pretui-button-radius: var(--boxel-button-border-radius, 100px);
      width: 100%;
      padding-block: var(--boxel-sp-xs);
      border: var(--auth-btn-border);
      background-color: var(--auth-btn-bg);
      color: var(--auth-btn-fg);
      box-shadow: none;
      font: 600 var(--boxel-font);
      font-family: inherit;
      letter-spacing: var(--boxel-lsp-xs);
    }
    .auth-btn-default {
      --auth-btn-bg: var(--boxel-button-default-background, var(--background));
      --auth-btn-fg: var(--boxel-button-default-foreground, var(--foreground));
      --auth-btn-border: 1px solid
        var(--boxel-button-default-border, var(--border));
    }
    .auth-btn-primary {
      --auth-btn-bg: var(--boxel-button-primary-background, var(--primary));
      --auth-btn-fg: var(
        --boxel-button-primary-foreground,
        var(--primary-foreground)
      );
      --auth-btn-border: 1px solid transparent;
    }
    .auth-btn-secondary {
      --auth-btn-bg: var(--boxel-button-secondary-background, var(--secondary));
      --auth-btn-fg: var(
        --boxel-button-secondary-foreground,
        var(--secondary-foreground)
      );
      --auth-btn-border: 1px solid
        var(--boxel-button-secondary-border, var(--secondary));
    }
    /* Hover and press follow boxel-ui's Button: each variant's active
       colors on hover and press, then a hovered fill at 90%. A button that
       is disabled or busy takes neither. */
    .auth-btn-default:not(:disabled, [aria-disabled='true']):is(
        :hover,
        :active
      ) {
      --auth-btn-bg: var(
        --boxel-button-default-active-background,
        var(--accent)
      );
      --auth-btn-fg: var(
        --boxel-button-default-active-foreground,
        var(--accent-foreground)
      );
      --auth-btn-border: 1px solid
        var(--boxel-button-default-active-border, var(--border));
    }
    .auth-btn-primary:not(:disabled, [aria-disabled='true']):is(
        :hover,
        :active
      ) {
      --auth-btn-bg: var(
        --boxel-button-primary-active-background,
        var(--primary)
      );
    }
    .auth-btn-secondary:not(:disabled, [aria-disabled='true']):is(
        :hover,
        :active
      ) {
      --auth-btn-border: 1px solid
        var(--boxel-button-secondary-active-border, var(--secondary));
    }
    .auth-btn:not(:disabled, [aria-disabled='true']):hover {
      background-color: color-mix(
        in oklab,
        var(--auth-btn-bg) 90%,
        transparent
      );
    }
    .auth-btn:active {
      transform: none;
    }
    /* A busy button keeps its colors, and its label at full strength beside
       the spinner. */
    .auth-btn:disabled:not([data-state='busy']),
    a.auth-btn[aria-disabled='true'] {
      border: var(--boxel-button-disabled-border, var(--auth-btn-border));
      background-color: var(
        --boxel-button-disabled-background,
        var(--auth-btn-bg)
      );
      color: var(--boxel-button-disabled-foreground, var(--auth-btn-fg));
      opacity: var(--boxel-button-disabled-opacity, 0.5);
    }
    .auth-btn[data-state='busy'] {
      --pretui-button-busy-label-opacity: 1;
      opacity: 1;
    }
  </style>
</template>;

export default AuthButton;
