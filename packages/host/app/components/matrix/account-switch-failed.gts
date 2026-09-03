import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import { Button } from '@cardstack/boxel-ui/components';

import AuthContainer from './auth-container';

interface Signature {
  Args: {
    onBackToHome: () => void;
  };
}

// Shown when a `?loginToken` account switch fails before any teardown (the token
// was expired or already spent). The current session is untouched, so this is a
// non-destructive dead end with a single recovery action. Mirrors the auth
// status screens (login "signing you in", register "setting up") — same dark
// AuthContainer shell, centered title + message — ending in a text link rather
// than a spinner or a filled button.
const AccountSwitchFailed: TemplateOnlyComponent<Signature> = <template>
  <AuthContainer>
    <div class='centered' data-test-account-switch-failed>
      <span class='title'>Couldn't switch accounts</span>
      <p class='message'>The sign-in link has expired or was already used. You
        haven't been signed out — return home to keep using your current
        account.</p>
      <Button
        @kind='link-primary'
        @size='extra-small'
        data-test-account-switch-back-home
        {{on 'click' @onBackToHome}}
      >Back to home</Button>
    </div>

    <style scoped>
      .centered {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-sm);
        text-align: center;
      }
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
      }
      .message {
        margin: 0 0 var(--boxel-sp-xs);
        color: var(--foreground);
        font: 500 var(--boxel-font-sm);
        line-height: 1.4;
      }
    </style>
  </AuthContainer>
</template>;

export default AccountSwitchFailed;
