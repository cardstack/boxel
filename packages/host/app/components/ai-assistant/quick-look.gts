import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { Button } from '@cardstack/pretui/components/button';
import { CardEmbed } from '@cardstack/pretui/components/card-embed';

import { QuickLook } from '@cardstack/pretui/components/quick-look';

import { consume } from 'ember-provide-consume-context';

import {
  type getCard,
  GetCardContextName,
  cardTypeDisplayName,
  isCardInstance,
  isFileDefInstance,
} from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type AssistantQuickLookService from '@cardstack/host/services/assistant-quick-look';
import type { QuickLookRequest } from '@cardstack/host/services/assistant-quick-look';

import type { CardDef } from '@cardstack/base/card-api';
import type { FileDef } from '@cardstack/base/file-api';
import type { CardEmbedState } from '@cardstack/pretui/components/card-embed';

/**
 * Quick Look in the assistant panel: the card or file a reader clicked in
 * the transcript, in Pret UI's QuickLook sheet over the transcript. It
 * renders whenever the quick-look service holds a request and stops when
 * it does not; it has no open or closing state of its own.
 */
export default class AssistantQuickLook extends Component {
  @service('assistant-quick-look')
  declare private quickLook: AssistantQuickLookService;

  private get request(): QuickLookRequest | null {
    return this.quickLook.current;
  }

  <template>
    {{#if this.request}}
      <QuickLookContent
        @request={{this.request}}
        @onClose={{this.quickLook.close}}
        @onOpen={{fn this.quickLook.openProperly this.request}}
        @onOpenSource={{if
          (this.quickLook.canOpenInCode this.request)
          (fn this.quickLook.openSource this.request)
        }}
      />
    {{/if}}
  </template>
}

interface ContentSignature {
  Args: {
    request: QuickLookRequest;
    onClose: () => void;
    onOpen: () => void;
    onOpenSource?: () => void;
  };
}

class QuickLookContent extends Component<ContentSignature> {
  @consume(GetCardContextName) declare private getCard: getCard;

  // The transcript has usually loaded it already (the pill or the embed
  // that was clicked holds a reference), so this reads the store's
  // instance and asks the network for nothing more; the sheet shows on
  // the first frame either way, with a loading state until it is ready.
  @cached
  private get resource(): ReturnType<getCard> {
    let { kind, id } = this.args.request;
    return this.getCard(
      this,
      () => id,
      kind === 'file' ? { type: 'file-meta' } : undefined,
    );
  }

  private get instance(): CardDef | FileDef | undefined {
    let card = this.resource?.card;
    if (isCardInstance(card) || isFileDefInstance(card)) {
      return card as CardDef | FileDef;
    }
    return undefined;
  }

  private get isFile() {
    return this.args.request.kind === 'file';
  }

  private get title(): string {
    let instance = this.instance;
    if (instance && isFileDefInstance(instance)) {
      return (instance as FileDef).name || this.fallbackTitle;
    }
    if (instance) {
      return (instance as CardDef).cardTitle || this.fallbackTitle;
    }
    return this.resource?.cardError?.meta?.cardTitle ?? this.fallbackTitle;
  }

  private get fallbackTitle(): string {
    let path = this.args.request.id.split('?')[0];
    let last = path.split('/').filter(Boolean).pop() ?? path;
    return decodeURIComponent(last);
  }

  private get kind(): string | undefined {
    let instance = this.instance;
    if (!instance) {
      return this.isFile ? 'File' : 'Card';
    }
    if (isFileDefInstance(instance)) {
      return (
        cardTypeDisplayName(instance) ||
        (instance as FileDef).contentType ||
        'File'
      );
    }
    return cardTypeDisplayName(instance) || 'Card';
  }

  private get state(): CardEmbedState {
    if (this.instance) {
      return 'ready';
    }
    if (this.resource?.cardError) {
      return this.resource.cardError.status === 404 ? 'missing' : 'error';
    }
    return 'loading';
  }

  private get error(): string | undefined {
    let error = this.resource?.cardError;
    return error ? error.title || error.message : undefined;
  }

  <template>
    <QuickLook
      @title={{this.title}}
      @kind={{this.kind}}
      @onClose={{@onClose}}
      @returnFocusTo={{@request.trigger}}
      data-test-quick-look={{@request.id}}
      data-test-quick-look-kind={{@request.kind}}
    >
      <:actions>
        {{#if this.isFile}}
          <Button
            @tone='primary'
            @appearance='accent'
            @size='s'
            data-test-quick-look-open
            {{on 'click' @onOpen}}
          >Open in code</Button>
        {{else}}
          {{#if @onOpenSource}}
            <Button
              @tone='neutral'
              @appearance='outlined'
              @size='s'
              data-test-quick-look-open-source
              {{on 'click' @onOpenSource}}
            >Open in code</Button>
          {{/if}}
          <Button
            @tone='primary'
            @appearance='accent'
            @size='s'
            data-test-quick-look-open
            {{on 'click' @onOpen}}
          >Open</Button>
        {{/if}}
      </:actions>
      <:default>
        <CardEmbed
          class='quick-look-embed'
          @format={{if this.isFile 'embedded' 'isolated'}}
          @state={{this.state}}
          @label={{this.title}}
          @kind={{this.kind}}
          @hat={{false}}
          @fill={{true}}
          @error={{this.error}}
          data-test-quick-look-body
        >
          {{#if this.instance}}
            <CardRenderer
              @card={{this.instance}}
              @format={{if this.isFile 'embedded' 'isolated'}}
              @displayContainer={{false}}
            />
          {{/if}}
        </CardEmbed>
      </:default>
    </QuickLook>
    <style scoped>
      /* the card keeps its own type and theme, on the sheet's face */
      .quick-look-embed {
        min-height: 100%;
      }
    </style>
  </template>
}
