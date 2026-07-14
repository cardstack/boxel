import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { BoxelIcon } from '@cardstack/boxel-ui/icons';

interface Signature {
  Element: HTMLDivElement;
  Args: {};
  Blocks: { default: [] };
}

const AuthContainer: TemplateOnlyComponent<Signature> = <template>
  <div class='auth' data-theme='dark'>
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
      /* theme color variable updates */
      --background: #272432;
      --foreground: var(--boxel-light);
      --muted-foreground: #7f7c8c;
      /* local color vars */
      --auth-background: #191624;
      --auth-foreground: var(--boxel-light);

      position: relative;
      min-height: 100dvh;
      background-color: var(--auth-background);
      color: var(--auth-foreground);
      overflow: auto;
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
