// What a key page shows once its change is made: what was done, as a Pret UI
// success Alert, and a Close button. The page also tries to close the window;
// one the user opened themselves can't be closed by script, and stays on this.
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Alert } from '@cardstack/pretui/components/alert';

import { Button } from '@cardstack/pretui/components/button';

import EditPage from './edit-page.gts';

interface Signature {
  Args: {
    heading: string;
    onClose: () => void;
  };
  Blocks: { default: [] };
}

const DonePage: TemplateOnlyComponent<Signature> = <template>
  <EditPage @heading={{@heading}} role='status' data-test-keys-done>
    <:default>
      <Alert @tone='success' role='none'>
        <p class='info'>{{yield}}</p>
      </Alert>
    </:default>
    <:actions>
      <Button
        @variant='primary'
        data-test-keys-done-close
        {{on 'click' @onClose}}
      >Close</Button>
    </:actions>
  </EditPage>

  <style scoped>
    .info {
      margin: 0;
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
      overflow-wrap: anywhere;
    }
  </style>
</template>;

export default DonePage;
