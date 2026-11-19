// What the authorize page shows once the user has answered, while the browser
// goes on to finish the flow: that the app wasn't connected, or that the
// browser is on its way back to it, and where its connection can be seen and
// disconnected later. The OAuth grant doesn't exist yet, so nothing here says
// when it ends.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { eq } from '@cardstack/pretui/helpers';

import MessagePage from '../sign-in/message-page.gts';

interface Signature {
  Args: {
    outcome: 'allowed' | 'denied';
    // The app as the page names it in its sentences (`appNameShown`).
    name: string;
    // The name Boxel can check, which the browser returns to.
    returnsTo: string;
  };
}

const Outcome: TemplateOnlyComponent<Signature> = <template>
  <div class='outcome' data-test-authorize-outcome={{@outcome}}>
    {{#if (eq @outcome 'denied')}}
      <MessagePage
        @heading='{{@name}} was not connected'
        @info='Nothing was shared. Returning you to {{@returnsTo}}…'
        @focus={{true}}
      />
    {{else}}
      <MessagePage
        @heading='Returning you to {{@returnsTo}}…'
        @info='You can see and disconnect your apps in Connected apps.'
        @focus={{true}}
      />
    {{/if}}
  </div>

  <style scoped>
    .outcome {
      display: contents;
    }
  </style>
</template>;

export default Outcome;
