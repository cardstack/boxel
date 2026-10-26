// What a key page was opened for, as the realm server describes it, in rows
// of a card's edit format: the operation and the card definition and realm it
// is on, where that request sends a key, and the reason the page that opened
// the window gave, shown as that page's own words.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import FieldContainer from '../../components/field-container.gts';
import Globe from '../../components/icons/globe.gts';
import MessageSquare from '../../components/icons/message-square.gts';
import RectangleEllipsis from '../../components/icons/rectangle-ellipsis.gts';

import type { WindowContext } from './context.ts';
import Destination from './destination.gts';

interface Signature {
  Args: {
    context: WindowContext;
    reason?: string;
  };
}

const OpenedForSummary: TemplateOnlyComponent<Signature> = <template>
  <FieldContainer
    @tag='div'
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
    </p>
  </FieldContainer>
  {{#if @context.operation.destination}}
    <FieldContainer
      @tag='div'
      @label='This request sends it to'
      @icon={{Globe}}
    >
      <Destination
        @destination={{@context.operation.destination}}
        @method={{@context.operation.method}}
        @card={{@context.card.name}}
        @realm={{@context.realm.name}}
      />
    </FieldContainer>
  {{/if}}
  {{#if @reason}}
    <FieldContainer @tag='div' @label='Reason given' @icon={{MessageSquare}}>
      <p class='value reason' data-test-opened-for-reason>
        “{{@reason}}”
        <span class='reason-label'>Written by the card that opened this window</span>
      </p>
    </FieldContainer>
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
