import type { TemplateOnlyComponent } from '@ember/component/template-only';

import MessagePage from '../sign-in/message-page.gts';

// Where the link in a registration email lands, once the Matrix server has
// validated the address. The page that asked for the email is still waiting
// for it, and carries on from there by itself.
const VerifyEmail: TemplateOnlyComponent = <template>
  <MessagePage @heading='Your email has now been validated'>
    <p class='info' data-test-email-validated>Return to the window where you are
      creating your Boxel account to finish. You can close this one.</p>
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

export default VerifyEmail;
