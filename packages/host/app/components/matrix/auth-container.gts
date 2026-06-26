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
      min-height: 100%;
      overflow: auto;
      background-color: var(--boxel-dark);

      /*
       * shadcn-style aliases — BoxelInput and the secondary-dark Button kind
       * read these, so the dark theme cascades to every child of the auth
       * dispatcher (login / register / forgot-password) without per-component
       * styling.
       */
      --background: var(--boxel-dark);
      --foreground: var(--boxel-light);
      --border: rgba(255, 255, 255, 0.35);
      --muted-foreground: var(--boxel-form-control-dark-mode-placeholder-color);
      --ring: var(--boxel-highlight);

      color: var(--foreground);
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
      min-height: 100%;
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
