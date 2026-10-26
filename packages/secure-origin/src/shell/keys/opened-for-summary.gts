// What a key page was opened for, as the realm server describes it: the
// operation and the card definition and realm it is on, where it sends a key,
// and the reason the page that opened the window gave, shown as that page's
// own words.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { WindowContext } from './context.ts';
import Destination from './destination.gts';

interface Signature {
  Args: {
    context: WindowContext;
    reason?: string;
  };
}

const OpenedForSummary: TemplateOnlyComponent<Signature> = <template>
  <section class='opened-for' data-test-opened-for>
    {{#if @context.operation}}
      <p class='for'>
        For
        <span
          class='name'
          data-test-opened-for-operation
        >{{@context.operation.label}}</span>
        on
        <span
          class='name'
          data-test-opened-for-card
        >{{@context.card.name}}</span>
        in
        <span
          class='name'
          data-test-opened-for-realm
        >{{@context.realm.name}}</span>
      </p>
      {{#if @context.operation.destination}}
        <p class='sent-to'>The key will be sent only to</p>
        <Destination
          @destination={{@context.operation.destination}}
          @method={{@context.operation.method}}
          @card={{@context.card.name}}
          @realm={{@context.realm.name}}
        />
      {{/if}}
    {{else if @context.card}}
      <p class='for'>
        For
        <span
          class='name'
          data-test-opened-for-card
        >{{@context.card.name}}</span>
        in
        <span
          class='name'
          data-test-opened-for-realm
        >{{@context.realm.name}}</span>
      </p>
    {{else}}
      <p class='for'>
        For the workspace
        <span
          class='name'
          data-test-opened-for-realm
        >{{@context.realm.name}}</span>
      </p>
    {{/if}}
    {{#if @reason}}
      <p class='reason' data-test-opened-for-reason>
        <span class='reason-label'>The page that opened this window says:</span>
        “{{@reason}}”
      </p>
    {{/if}}
  </section>

  <style scoped>
    .opened-for {
      margin-bottom: var(--boxel-sp);
      overflow-wrap: anywhere;
    }
    .for,
    .sent-to {
      margin: 0 0 var(--boxel-sp-xs);
      letter-spacing: var(--boxel-lsp);
      line-height: 20px;
    }
    .name {
      font-weight: 600;
    }
    .reason {
      margin: var(--boxel-sp-xs) 0 0;
      font: var(--boxel-font-xs);
      color: var(--muted-foreground);
    }
    .reason-label {
      display: block;
    }
  </style>
</template>;

export default OpenedForSummary;
