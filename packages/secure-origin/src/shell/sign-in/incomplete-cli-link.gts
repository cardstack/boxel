// A CLI sign-in without a loopback port and state this page may hand a session
// to (see `cliCallback`), whether the link lacked them or Google's callback
// found none it could use.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import MessagePage from './message-page.gts';

const IncompleteCliLink: TemplateOnlyComponent = <template>
  <MessagePage
    @heading='This sign-in link is not complete'
    @info='Run the command in your terminal again to get a new link.'
  />
</template>;

export default IncompleteCliLink;
