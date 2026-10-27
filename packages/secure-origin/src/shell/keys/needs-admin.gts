// What a reader of a realm who isn't one of its direct writers sees where a
// share would be set up: only a direct writer may put a key into a realm, so
// there is nothing for them to enter. It says "direct write access" rather
// than "edits": write access that comes from a row for everyone, or a
// permission policy that admits a write, doesn't make someone a direct
// writer.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import EditPage from './edit-page.gts';
import { addressOf } from './workspace-dropdown.gts';

interface Signature {
  Args: { realm: { name: string; url: string } };
}

const NeedsAdmin: TemplateOnlyComponent<Signature> = <template>
  <EditPage
    @heading='Someone with direct write access to this workspace needs to set this up'
    data-test-keys-needs-admin
  >
    <:intro>Only people with direct write access to
      <strong>{{@realm.name}}</strong>
      (<span data-test-needs-admin-address>{{addressOf @realm.url}}</span>) can
      add a key to it.</:intro>
  </EditPage>
</template>;

export default NeedsAdmin;
