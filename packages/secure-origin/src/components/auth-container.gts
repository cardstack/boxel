// AuthContainer, the page around every sign-in screen, in the app and on the
// secure origin alike: the logo top left and the page's content in a centred
// column.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import BoxelIcon from './icons/boxel-icon.gts';

interface Signature {
  Element: HTMLDivElement;
  Blocks: { default: [] };
}

const AuthContainer: TemplateOnlyComponent<Signature> = <template>
  <div class='auth' data-theme='dark' data-test-secure-page ...attributes>
    <div class='logo' aria-hidden='true'>
      <BoxelIcon data-test-boxel-logo />
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
      /* local color vars */
      /* The secure origin's pages name this colour (`global.css`); the
         app's sign-in screens, which don't load that stylesheet, take the
         fallback. */
      --auth-background: var(--auth-page-background, #191624);
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
