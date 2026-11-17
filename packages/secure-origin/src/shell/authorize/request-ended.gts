// What the authorize page shows for a request it can't go on with: one that
// has expired, was already answered, or that the provider refused. The app is
// left to start again.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import MessagePage from '../sign-in/message-page.gts';

const RequestEnded: TemplateOnlyComponent<object> = <template>
  <div class='ended' data-test-authorize-ended>
    <MessagePage
      @heading='This request can’t continue'
      @info='Start connecting again from the app.'
    />
  </div>

  <style scoped>
    .ended {
      display: contents;
    }
  </style>
</template>;

export default RequestEnded;
