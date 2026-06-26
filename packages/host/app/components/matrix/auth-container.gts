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
      min-height: 100vh;
      overflow: auto;
      background-color: #191624;

      /*
       * shadcn-style aliases — BoxelInput and the secondary-dark Button kind
       * read these, so the dark theme cascades to every child of the auth
       * dispatcher (login / register / forgot-password) without per-component
       * styling.
       */
      --background: #191624;
      --foreground: #ffffff;
      --border: #525252;
      --muted-foreground: #7f7c8c;
      --ring: #00ffba;

      color: var(--foreground);

      /*
       * Auth-page shared button palette. Component-level overrides
       * (login / register / forgot-password) read these so we don't repeat
       * the same hex values per file.
       */
      --auth-primary-bg: #00ffba;
      --auth-primary-text: #000000;
      --auth-primary-disabled-bg: #444051;
      --auth-primary-disabled-text: #817c93;
      --auth-secondary-bg: #191624;
      --auth-secondary-border: #525252;
      --auth-secondary-text: #ffffff;
    }
    .logo {
      position: absolute;
      top: var(--boxel-sp-lg);
      left: var(--boxel-sp-lg);
      --icon-color: var(--boxel-highlight);
      --icon-bg-color: var(--boxel-highlight);
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
      min-height: 100vh;
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
