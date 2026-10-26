// What a key page shows when the realm server knows nothing of what it was
// opened for: a realm, card or operation that doesn't exist, or one this user
// can't read, which the server answers alike.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

const NotFound: TemplateOnlyComponent = <template>
  <section data-test-keys-not-found>
    <h1 class='heading'>This link doesn’t lead anywhere</h1>
    <p class='info'>The workspace, card or request it names doesn’t exist, or
      you don’t have access to it. Close this window and try again from Boxel.</p>
  </section>

  <style scoped>
    .heading {
      font: 600 var(--boxel-font-md);
      margin: 0 0 var(--boxel-sp-sm);
    }
    .info {
      margin: 0;
      letter-spacing: var(--boxel-lsp);
      line-height: 20px;
    }
  </style>
</template>;

export default NotFound;
