// A page that only says something: a title, a line under it, and whatever
// follows. Every page a sign-in ends on, or stops at, is one. A page that
// replaces another the user was working in (`@focus`) takes focus on its
// title, so a screen reader reads what it says. The title draws no focus
// ring: it isn't a control.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { focusWhen } from '@cardstack/pretui/focus';

import AuthContainer from '../../components/auth-container.gts';

interface Signature {
  Args: {
    heading: string;
    info?: string;
    focus?: boolean;
  };
  Blocks: { default: [] };
}

const MessagePage: TemplateOnlyComponent<Signature> = <template>
  <AuthContainer>
    <section class='message' data-test-secure-sign-in>
      {{#if @focus}}
        <h1
          class='title'
          tabindex='-1'
          {{focusWhen true}}
          data-test-secure-title
        >{{@heading}}</h1>
      {{else}}
        <h1 class='title' data-test-secure-title>{{@heading}}</h1>
      {{/if}}
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
    .title:focus {
      outline: none;
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
