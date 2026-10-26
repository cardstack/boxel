// What a reader of a realm who isn't one of its direct writers sees where a
// share would be set up: only a direct writer may put a key into a realm, so
// there is nothing for them to enter.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import EditPage from './edit-page.gts';

interface Signature {
  Args: { realm: string };
}

const NeedsAdmin: TemplateOnlyComponent<Signature> = <template>
  <EditPage
    @heading='An administrator of this realm needs to set this up'
    data-test-keys-needs-admin
  >
    <:intro>Only someone who can edit
      <strong>{{@realm}}</strong>
      can add a key to it. Ask one of them to set it up.</:intro>
  </EditPage>
</template>;

export default NeedsAdmin;
