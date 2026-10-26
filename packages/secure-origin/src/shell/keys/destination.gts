// Where a key goes, wherever the window shows one: the registrable domain in
// large type, which is who a person is dealing with, and beneath it the full
// host and path, then the card definition and realm the request comes from.
// Every part is the realm server's description of the operation's
// declaration. An operation's label is the author's own words and never
// stands in for the host.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

export interface DestinationDisplay {
  href: string;
  host: string;
  path: string;
  registrableDomain: string;
}

interface Signature {
  Args: {
    destination: DestinationDisplay;
    method?: string;
    card?: string;
    realm: string;
  };
}

const Destination: TemplateOnlyComponent<Signature> = <template>
  <div class='destination' data-test-destination>
    <div class='domain' data-test-destination-domain>
      {{@destination.registrableDomain}}
    </div>
    <div class='where' data-test-destination-where>
      {{#if @method}}<span class='method'>{{@method}}</span>{{/if}}
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
    </div>
  </div>

  <style scoped>
    .destination {
      padding: var(--boxel-sp);
      border: 1px solid var(--panel-border);
      border-radius: var(--boxel-border-radius-lg);
      background-color: var(--panel-background);
      overflow-wrap: anywhere;
    }
    .domain {
      font: 600 var(--boxel-font-xl);
      line-height: 1.2;
    }
    .where {
      margin-top: var(--boxel-sp-4xs);
      font: var(--boxel-font-sm);
      font-family: var(--boxel-monospace-font-family);
    }
    .method {
      font-weight: 600;
      margin-inline-end: var(--boxel-sp-4xs);
    }
    .from {
      margin-top: var(--boxel-sp-xs);
      font: var(--boxel-font-xs);
      color: var(--muted-foreground);
    }
    .name {
      font-weight: 600;
      color: var(--foreground);
    }
  </style>
</template>;

export default Destination;
