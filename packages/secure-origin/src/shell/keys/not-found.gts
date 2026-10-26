// What a key page shows when the realm server knows nothing of what it was
// opened for: a realm, card or operation that doesn't exist, or one this user
// can't read, which the server answers alike.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import EditPage from './edit-page.gts';

const NotFound: TemplateOnlyComponent = <template>
  <EditPage @heading='This link doesn’t lead anywhere' data-test-keys-not-found>
    <:intro>The workspace, card or request it names doesn’t exist, or you don’t
      have access to it. Close this window and try again from Boxel.</:intro>
  </EditPage>
</template>;

export default NotFound;
