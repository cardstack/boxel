// What the authorize page shows once the user has answered, while the browser
// goes on to finish the flow (§10, states 5 and 7). The OAuth grant doesn't
// exist yet, so nothing here says when it ends.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

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
    {{#if (isDenied @outcome)}}
      <MessagePage
        @heading='{{@name}} was not connected'
        @info='Nothing was shared. Returning you to {{@returnsTo}}…'
      />
    {{else}}
      <MessagePage @heading='Returning you to {{@returnsTo}}…' />
    {{/if}}
  </div>

  <style scoped>
    .outcome {
      display: contents;
    }
  </style>
</template>;

function isDenied(outcome: Signature['Args']['outcome']): boolean {
  return outcome === 'denied';
}

export default Outcome;
