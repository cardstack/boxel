// What a reader of a realm who isn't one of its direct writers sees where a
// share would be set up: only a direct writer may put a key into a realm, so
// there is nothing for them to enter.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Args: { realm: string };
}

const NeedsAdmin: TemplateOnlyComponent<Signature> = <template>
  <section data-test-keys-needs-admin>
    <h1 class='heading'>An administrator of this realm needs to set this up</h1>
    <p class='info'>Only someone who can edit
      <strong>{{@realm}}</strong>
      can add a key to it. Ask one of them to set it up.</p>
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
      overflow-wrap: anywhere;
    }
  </style>
</template>;

export default NeedsAdmin;
