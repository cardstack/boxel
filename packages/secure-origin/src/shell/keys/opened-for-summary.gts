// What a key page was opened for, as the realm server describes it, in rows
// of a card's edit format: the operation and the card definition and realm it
// is on, where that request sends a key, and any reason the operation that
// opened the window gave. A realm is named with its address as well as its
// name, since anyone can give a realm any name. The reason comes with the
// window's address, not from the server, so it is shown as what the operation
// (or the card) gave, not as anything the server describes.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Field } from '@cardstack/pretui/components/field';
import Globe from '@cardstack/boxel-icons/globe';
import MessageSquare from '@cardstack/boxel-icons/message-square';
import RectangleEllipsis from '@cardstack/boxel-icons/rectangle-ellipsis';

import type { WindowContext } from './context.ts';
import Destination from './destination.gts';
import { addressOf } from './workspace-dropdown.gts';

interface Signature {
  Args: {
    context: WindowContext;
    reason?: string;
  };
}

const OpenedForSummary: TemplateOnlyComponent<Signature> = <template>
  <Field
    @reserveMessage={{false}}
    @orientation='horizontal'
    @labelTag='span'
    @label='For'
    @icon={{RectangleEllipsis}}
    data-test-opened-for
  >
    <p class='value'>
      {{#if @context.operation}}
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
      {{else if @context.card}}
        <span
          class='name'
          data-test-opened-for-card
        >{{@context.card.name}}</span>
        in
      {{else}}
        The workspace
      {{/if}}
      <span
        class='name'
        data-test-opened-for-realm
      >{{@context.realm.name}}</span>
      <span class='address' data-test-opened-for-realm-address>{{addressOf
          @context.realm.url
        }}</span>
    </p>
  </Field>
  {{#if @context.operation.destination}}
    <Field
      @reserveMessage={{false}}
      @orientation='horizontal'
      @labelTag='span'
      @label='This call sends it to'
      @icon={{Globe}}
    >
      <Destination
        @destination={{@context.operation.destination}}
        @method={{@context.operation.method}}
        @card={{@context.card.name}}
        @realm={{@context.realm.name}}
        @realmURL={{@context.realm.url}}
      />
    </Field>
  {{/if}}
  {{#if @reason}}
    <Field
      @reserveMessage={{false}}
      @orientation='horizontal'
      @labelTag='span'
      @label='Why it’s needed'
      @icon={{MessageSquare}}
    >
      <p class='value reason' data-test-opened-for-reason>
        “{{@reason}}”
        <span class='reason-label' data-test-opened-for-reason-by>Given by
          {{#if @context.operation}}<strong
            >{{@context.operation.label}}</strong>
            when it opened this window{{else}}the card that opened this window{{/if}}.</span>
      </p>
    </Field>
  {{/if}}

  <style scoped>
    .value {
      margin: 0;
      padding-top: var(--boxel-sp-xs);
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
      overflow-wrap: anywhere;
    }
    .name {
      font-weight: 600;
    }
    .address {
      display: block;
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      color: var(--muted-foreground);
    }
    .reason-label {
      display: block;
      margin-top: var(--boxel-sp-4xs);
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      color: var(--muted-foreground);
    }
  </style>
</template>;

export default OpenedForSummary;
