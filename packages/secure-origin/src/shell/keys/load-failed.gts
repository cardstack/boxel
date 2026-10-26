// What a key page shows when it couldn't load what it needs for a reason other
// than its not existing: the server couldn't be reached, or failed. Trying
// again may work, so it says why and offers to.
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import Button from '../../components/button.gts';

import EditPage from './edit-page.gts';

interface Signature {
  Args: { message: string; onRetry: () => void };
}

const LoadFailed: TemplateOnlyComponent<Signature> = <template>
  <EditPage @heading='This page didn’t load' data-test-keys-load-failed>
    <:intro><span role='alert'>{{@message}}</span></:intro>
    <:actions>
      <Button @kind='primary' data-test-keys-retry {{on 'click' @onRetry}}>Try
        again</Button>
    </:actions>
  </EditPage>
</template>;

export default LoadFailed;
