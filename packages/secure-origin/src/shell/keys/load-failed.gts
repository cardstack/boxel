// What a key page shows when it couldn't load what it needs: the page keeps its
// own title, and shows the error as the app does, with the response's status
// and the server's own message behind Show Details. Trying again may work, so
// it offers to.
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import Button from '../../components/button.gts';
import ErrorDisplay from '../../components/error-display.gts';

import type { LoadFailure } from './context.ts';
import EditPage from './edit-page.gts';

interface Signature {
  Args: { heading: string; failure: LoadFailure; onRetry: () => void };
}

const LoadFailed: TemplateOnlyComponent<Signature> = <template>
  <EditPage @heading={{@heading}} data-test-keys-load-failed>
    <:default>
      <ErrorDisplay
        @headerText='Error'
        @message={{@failure.message}}
        @details={{@failure.details}}
      />
    </:default>
    <:actions>
      <Button @kind='secondary' data-test-keys-retry {{on 'click' @onRetry}}>Try
        again</Button>
    </:actions>
  </EditPage>
</template>;

export default LoadFailed;
