// What the key page says about a Google service account, under its name, from
// the key listing, as Pret UI KeyValue rows: which service account it is, the
// user it acts as and the scopes its tokens ask for. None of it is secret; the
// key file is never shown, and the listing never carries it.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { KeyValue } from '@cardstack/pretui/components/key-value';

import { eq } from '@cardstack/pretui/helpers';

import type { UserKey } from './context.ts';

interface Signature {
  Args: { key: UserKey };
}

// One row per detail; `field` says which value the row draws.
const ROWS: {
  key: string;
  value: string;
  field: 'email' | 'subject' | 'scopes';
}[] = [
  { key: 'Service account', value: '', field: 'email' },
  { key: 'Acts as', value: '', field: 'subject' },
  { key: 'Scopes', value: '', field: 'scopes' },
];

const ServiceAccountDetails: TemplateOnlyComponent<Signature> = <template>
  {{#if @key.serviceAccount}}
    <KeyValue class='details' @items={{ROWS}} data-test-service-account-details>
      <:value as |row|>
        {{#if (eq row.field 'email')}}
          <span
            class='code'
            data-test-service-account-detail='email'
          >{{@key.serviceAccount.email}}</span>
        {{else if (eq row.field 'subject')}}
          <span data-test-service-account-detail='subject'>
            {{#if @key.serviceAccount.subject}}
              <span class='code'>{{@key.serviceAccount.subject}}</span>
            {{else}}
              The service account itself
            {{/if}}
          </span>
        {{else}}
          <ul class='scopes' data-test-service-account-detail='scopes'>
            {{#each @key.serviceAccount.scopes as |scope|}}
              <li class='code' data-test-service-account-scope>{{scope}}</li>
            {{/each}}
          </ul>
        {{/if}}
      </:value>
    </KeyValue>
  {{/if}}

  <style scoped>
    .details {
      --pretui-kv-label-font-size: var(--boxel-font-size-xs);
      --pretui-kv-label-line-height: var(--boxel-line-height-xs);
      grid-template-columns: 7.5rem minmax(0, 1fr);
      column-gap: var(--boxel-sp-xs);
      row-gap: var(--boxel-sp-4xs);
      align-items: start;
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      overflow-wrap: anywhere;
    }
    .code {
      font-family: var(--boxel-monospace-font-family);
    }
    .scopes {
      list-style: none;
      margin: 0;
      padding: 0;
    }
  </style>
</template>;

export default ServiceAccountDetails;
