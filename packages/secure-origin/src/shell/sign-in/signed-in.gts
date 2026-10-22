// The window, signed in. It shows nothing more: the app asks the realm server
// whether the window has a session, rather than hearing it from the window.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import MessagePage from './message-page.gts';

const SignedIn: TemplateOnlyComponent = <template>
  <MessagePage @heading='You’re signed in to Boxel'>
    <p class='info' data-test-secure-signed-in>You can close this window.</p>
  </MessagePage>

  <style scoped>
    .info {
      margin-top: 0;
      margin-bottom: var(--boxel-sp-sm);
      letter-spacing: var(--boxel-lsp);
      line-height: 20px;
      color: var(--foreground);
    }
  </style>
</template>;

export default SignedIn;
