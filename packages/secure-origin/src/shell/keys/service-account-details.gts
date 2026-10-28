// What the key page says about a Google service account, under its name, from
// the key listing: which service account it is, the user it acts as and the
// scopes its tokens ask for. None of it is secret; the key file is never
// shown, and the listing never carries it.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { UserKey } from './context.ts';

interface Signature {
  Args: { key: UserKey };
}

const ServiceAccountDetails: TemplateOnlyComponent<Signature> = <template>
  {{#if @key.serviceAccount}}
    <dl class='details' data-test-service-account-details>
      <div class='detail'>
        <dt>Service account</dt>
        <dd
          class='code'
          data-test-service-account-detail='email'
        >{{@key.serviceAccount.email}}</dd>
      </div>
      <div class='detail'>
        <dt>Acts as</dt>
        <dd data-test-service-account-detail='subject'>
          {{#if @key.serviceAccount.subject}}
            <span class='code'>{{@key.serviceAccount.subject}}</span>
          {{else}}
            The service account itself
          {{/if}}
        </dd>
      </div>
      <div class='detail'>
        <dt>Scopes</dt>
        <dd>
          <ul class='scopes' data-test-service-account-detail='scopes'>
            {{#each @key.serviceAccount.scopes as |scope|}}
              <li class='code' data-test-service-account-scope>{{scope}}</li>
            {{/each}}
          </ul>
        </dd>
      </div>
    </dl>
  {{/if}}

  <style scoped>
    .details {
      display: grid;
      gap: var(--boxel-sp-4xs);
      margin: 0;
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      overflow-wrap: anywhere;
    }
    .detail {
      display: grid;
      grid-template-columns: 7.5rem minmax(0, 1fr);
      column-gap: var(--boxel-sp-xs);
    }
    dt {
      color: var(--muted-foreground);
    }
    dd {
      margin: 0;
      color: var(--foreground);
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
