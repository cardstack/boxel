// Where a key goes, wherever the window shows one: the registrable domain in
// large type, which is who a person is dealing with, and beneath it what the
// request does there in plain words, the full host and path, then the card
// definition and realm, by name and address, the request comes from.
// Every part is the realm server's description of the operation's
// declaration. An operation's label is the author's own words and never
// stands in for the host.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { DestinationDisplay } from '../../security/keys.ts';

import { methodPhrase } from './context.ts';
import { addressOf } from './workspace-dropdown.gts';

interface Signature {
  Args: {
    destination: DestinationDisplay;
    method?: string;
    card?: string;
    realm: string;
    realmURL: string;
  };
}

const Destination: TemplateOnlyComponent<Signature> = <template>
  <div class='destination' data-test-destination>
    <div class='domain' data-test-destination-domain>
      {{@destination.registrableDomain}}
    </div>
    <div class='where' data-test-destination-where>
      {{#if @method}}<span
          class='method'
          data-test-destination-method
        >{{methodPhrase @method}}</span>{{/if}}
      <span data-test-destination-host>{{@destination.host}}</span><span
        data-test-destination-path
      >{{@destination.path}}</span>
    </div>
    <div class='from' data-test-destination-from>
      From
      {{#if @card}}
        <span class='name' data-test-destination-card>{{@card}}</span>
        in
      {{/if}}
      <span class='name' data-test-destination-realm>{{@realm}}</span>
      (<span data-test-destination-realm-address>{{addressOf @realmURL}}</span>)
    </div>
  </div>

  <style scoped>
    .destination {
      padding: var(--boxel-sp-sm) var(--boxel-sp);
      border-radius: var(--boxel-border-radius);
      background-color: var(--card, var(--background));
      box-shadow: 0 0 0 1px var(--border);
      overflow-wrap: anywhere;
    }
    .domain {
      font-size: var(--boxel-font-size-xl);
      line-height: var(--boxel-line-height-xl);
      font-weight: 600;
    }
    .where {
      margin-top: var(--boxel-sp-4xs);
      font-family: var(--boxel-monospace-font-family);
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
    }
    .method {
      font-family: var(--boxel-font-family);
      margin-inline-end: var(--boxel-sp-4xs);
    }
    .from {
      margin-top: var(--boxel-sp-xs);
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      color: var(--muted-foreground);
    }
    .name {
      font-weight: 600;
      color: var(--foreground);
    }
  </style>
</template>;

export default Destination;
