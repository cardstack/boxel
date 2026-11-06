// What a key page shows when it couldn't load what it needs: the page keeps its
// own title, and shows the error as a warning with a general message. The
// response's status and the server's own message, or that no response came,
// wait behind Show Details, listed only once it is opened. The warning offers
// to try again only when that could go differently.
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { trackedObject } from '@ember/reactive/collections';

import { Alert } from '@cardstack/pretui/components/alert';
import { Disclosure } from '@cardstack/pretui/components/disclosure';
import { KeyValue } from '@cardstack/pretui/components/key-value';

import Button from '../../components/button.gts';

import type { LoadFailure } from './context.ts';
import EditPage from './edit-page.gts';

class ErrorDetails extends Component<{ Args: { failure: LoadFailure } }> {
  <template>
    <p class='message' data-test-error-message>{{@failure.message}}</p>
    {{#if @failure.details.length}}
      <Disclosure
        class='details'
        @size='s'
        @open={{this.state.open}}
        @onOpenChange={{this.toggle}}
        data-test-toggle-details
      >
        <:trigger>{{if
            this.state.open
            'Hide Details'
            'Show Details'
          }}</:trigger>
        <:default>
          {{#if this.state.open}}
            <KeyValue
              class='detail-list'
              @items={{this.items}}
              @layout='stacked'
              data-test-error-details
            >
              <:value as |item|><span
                  data-test-error-detail={{item.key}}
                >{{item.value}}</span></:value>
            </KeyValue>
          {{/if}}
        </:default>
      </Disclosure>
    {{/if}}

    <style scoped>
      .message {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        overflow-wrap: anywhere;
      }
      .details {
        margin-top: var(--boxel-sp-xs);
      }
      /* The details sit on the page's own ground inside the warning, so the
         warning frames them on every side. */
      .detail-list {
        --pretui-kv-label-font-size: var(--boxel-font-size-xs);
        --pretui-kv-label-line-height: var(--boxel-line-height-xs);
        --pretui-kv-label-font-weight: 600;
        margin-top: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background-color: var(--background);
        overflow-wrap: anywhere;
      }
    </style>
  </template>

  private state = trackedObject({ open: false });

  private get items() {
    return this.args.failure.details.map(({ label, value }) => ({
      key: label,
      value,
    }));
  }

  private toggle = (open: boolean) => {
    this.state.open = open;
  };
}

interface Signature {
  Args: { heading: string; failure: LoadFailure; onRetry: () => void };
}

const LoadFailed: TemplateOnlyComponent<Signature> = <template>
  <EditPage @heading={{@heading}} data-test-keys-load-failed>
    {{#if @failure.retryable}}
      <Alert
        @tone='warning'
        @title='Error'
        role='alert'
        data-test-error-display
      >
        <:default><ErrorDetails @failure={{@failure}} /></:default>
        <:action><Button
            @kind='secondary'
            @size='small'
            data-test-keys-retry
            {{on 'click' @onRetry}}
          >Try again</Button></:action>
      </Alert>
    {{else}}
      <Alert
        @tone='warning'
        @title='Error'
        role='alert'
        data-test-error-display
      >
        <ErrorDetails @failure={{@failure}} />
      </Alert>
    {{/if}}
  </EditPage>
</template>;

export default LoadFailed;
