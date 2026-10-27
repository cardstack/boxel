// What a reader of a realm who isn't one of its direct writers sees where a
// share would be set up: only a direct writer may put a key into a realm, so
// there is nothing for them to enter. A direct writer is someone given edit
// access by name; edit access that comes from a row for everyone doesn't
// count, so the page says whom to ask rather than that they can't edit.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import EditPage from './edit-page.gts';
import { addressOf } from './workspace-dropdown.gts';

interface Signature {
  Args: { realm: { name: string; url: string } };
}

const NeedsAdmin: TemplateOnlyComponent<Signature> = <template>
  <EditPage
    @heading='Someone who edits this workspace needs to set this up'
    data-test-keys-needs-admin
  >
    <:intro>Only someone given edit access to
      <strong>{{@realm.name}}</strong>
      (<span data-test-needs-admin-address>{{addressOf @realm.url}}</span>) by
      name can add a key to it. Ask one of them to set it up.</:intro>
  </EditPage>
</template>;

export default NeedsAdmin;
