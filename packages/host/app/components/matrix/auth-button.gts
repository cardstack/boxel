import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Button } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

export type AuthButtonVariant = 'primary' | 'secondary' | 'google';

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
  {{#if (eq @variant 'primary')}}
    <Button
      class='auth-btn auth-btn--primary'
      @kind='primary'
      @disabled={{@disabled}}
      @loading={{@loading}}
      ...attributes
    >{{yield}}</Button>
  {{else if (eq @variant 'google')}}
    <Button
      class='auth-btn auth-btn--google'
      @kind='secondary-dark'
      @disabled={{@disabled}}
      @loading={{@loading}}
      ...attributes
    >{{yield}}</Button>
  {{else}}
    <Button
      class='auth-btn auth-btn--secondary'
      @kind='secondary-dark'
      @disabled={{@disabled}}
      @loading={{@loading}}
      ...attributes
    >{{yield}}</Button>
  {{/if}}

  <style scoped>
    .auth-btn {
      --boxel-button-padding: var(--boxel-sp-sm);
      width: 100%;
    }
    .auth-btn :deep(.boxel-loading-indicator) {
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .auth-btn--primary {
      --boxel-button-color: var(--auth-primary-bg);
      --boxel-button-text-color: var(--auth-primary-text);
    }
    .auth-btn--primary:disabled {
      --boxel-button-color: var(--auth-primary-disabled-bg);
      --boxel-button-text-color: var(--auth-primary-disabled-text);
      --boxel-button-border: none;
    }
    .auth-btn--secondary,
    .auth-btn--google {
      --boxel-button-color: var(--auth-secondary-bg);
      --boxel-button-text-color: var(--auth-secondary-text);
      --boxel-button-border: 1px solid var(--auth-secondary-border);
    }
    .auth-btn--secondary:not(:disabled):hover,
    .auth-btn--secondary:not(:disabled):active,
    .auth-btn--google:not(:disabled):hover,
    .auth-btn--google:not(:disabled):active {
      --boxel-button-color: var(--auth-secondary-hover-bg);
    }
    .auth-btn--google {
      display: inline-flex;
      align-items: center;
      gap: var(--boxel-sp-xs);
    }
  </style>
</template>;

export default AuthButton;
