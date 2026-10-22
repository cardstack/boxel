// A page that only says something: a title, a line under it, and whatever
// follows. Every page a sign-in ends on, or stops at, is one.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import AuthContainer from '../../components/auth-container.gts';

interface Signature {
  Args: {
    heading: string;
    info?: string;
  };
  Blocks: { default: [] };
}

const MessagePage: TemplateOnlyComponent<Signature> = <template>
  <AuthContainer>
    <section class='message' data-test-secure-sign-in>
      {{! The app's title is a span, laid out by where it sits; this one is
          marked as the page's heading. }}
      <span
        class='title'
        role='heading'
        aria-level='1'
        data-test-secure-title
      >{{@heading}}</span>
      {{#if @info}}
        <p class='info' data-test-secure-info>{{@info}}</p>
      {{/if}}
      {{yield}}
    </section>
  </AuthContainer>

  <style scoped>
    /* Lays out what it holds as if it weren't there, as the app puts its
       title and text straight into the page's column. */
    .message {
      display: contents;
    }
    .title {
      font: 600 var(--boxel-font-md);
      color: var(--foreground);
      margin: 0 0 var(--boxel-sp-sm);
      padding: 0;
    }
    .info {
      margin-top: 0;
      margin-bottom: var(--boxel-sp-sm);
      letter-spacing: var(--boxel-lsp);
      line-height: 20px;
      color: var(--foreground);
    }
  </style>
</template>;

export default MessagePage;
