import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { BoxelIcon } from '@cardstack/boxel-ui/icons';

interface Signature {
  Element: HTMLDivElement;
  Args: {};
  Blocks: { default: [] };
}

const AuthContainer: TemplateOnlyComponent<Signature> = <template>
  <div class='auth'>
    <div class='logo' aria-hidden='true'>
      <BoxelIcon />
    </div>
    <div class='container'>
      <div class='content'>
        {{yield}}
      </div>
    </div>
  </div>

  <style scoped>
    .auth {
      position: relative;
      min-height: 100dvh;
      overflow: auto;
      background-color: var(--background);

      /*
       * shadcn-style aliases — BoxelInput and the secondary-dark Button kind
       * read these, so the dark theme cascades to every child of the auth
       * dispatcher (login / register / forgot-password) without per-component
       * styling. Only the values without a boxel token are spelled as raw hex.
       */
      --background: #191624;
      --foreground: var(--boxel-light);
      --border: #525252;
      --muted-foreground: #7f7c8c;
      --ring: var(--boxel-highlight);

      color: var(--foreground);

      /*
       * Auth-page shared button palette. Component-level overrides
       * (login / register / forgot-password) read these so we don't repeat
       * the same values per file.
       */
      --auth-primary-bg: var(--boxel-highlight);
      --auth-primary-text: var(--boxel-dark);
      --auth-primary-disabled-bg: #444051;
      --auth-primary-disabled-text: #817c93;
      --auth-secondary-bg: var(--background);
      --auth-secondary-border: var(--border);
      --auth-secondary-text: var(--foreground);
      --auth-secondary-hover-bg: #221f30;
    }
    .logo {
      position: absolute;
      top: var(--boxel-sp-lg);
      left: var(--boxel-sp-lg);
      --icon-color: var(--boxel-highlight);
      width: 2rem;
      height: 2rem;
    }
    .logo :deep(svg) {
      width: 100%;
      height: 100%;
    }
    .container {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 100dvh;
      padding: var(--boxel-sp-lg);
    }
    .content {
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: 25rem;
      padding: var(--boxel-sp) 0 calc(var(--boxel-sp) * 2) 0;
    }
  </style>
</template>;

export default AuthContainer;
